/**
 * cdn-policy.test.ts — beads silofl-qiy.7 + .11
 *
 * Pure offline tests.  No network calls.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  JSDELIVR_MAX_BYTES,
  classifyDelivery,
  isRenderableFormat,
  parseRenderableFormatsFromClause,
} from "@/ingest/cdn-policy";
import { PUBLIC_RENDERABLE_FONT_CLAUSE } from "@/graphql/schema/public-font-policy";

// ── JSDELIVR_MAX_BYTES ────────────────────────────────────────────────────────

describe("JSDELIVR_MAX_BYTES", () => {
  it("is exactly 20 MiB", () => {
    assert.equal(JSDELIVR_MAX_BYTES, 20 * 1024 * 1024);
    assert.equal(JSDELIVR_MAX_BYTES, 20_971_520);
  });
});

// ── isRenderableFormat ────────────────────────────────────────────────────────

describe("isRenderableFormat", () => {
  it("accepts ttf", () => assert.ok(isRenderableFormat("ttf")));
  it("accepts otf", () => assert.ok(isRenderableFormat("otf")));
  it("accepts woff", () => assert.ok(isRenderableFormat("woff")));
  it("accepts woff2", () => assert.ok(isRenderableFormat("woff2")));

  it("rejects ttc — browsers cannot deterministically load a collection face via @font-face", () => {
    // Decision record: silofl-qiy.11 — see cdn-policy.ts header.
    assert.equal(isRenderableFormat("ttc"), false);
  });

  it("rejects eot", () => assert.equal(isRenderableFormat("eot"), false));
  it("rejects svg", () => assert.equal(isRenderableFormat("svg"), false));
  it("rejects null", () => assert.equal(isRenderableFormat(null), false));
  it("rejects undefined", () => assert.equal(isRenderableFormat(undefined), false));
  it("rejects empty string", () => assert.equal(isRenderableFormat(""), false));

  it("is case-insensitive (accepts TTF, OTF)", () => {
    assert.ok(isRenderableFormat("TTF"));
    assert.ok(isRenderableFormat("OTF"));
    assert.ok(isRenderableFormat("WOFF2"));
  });
});

// ── Policy drift guard — INV-DATA-2 ──────────────────────────────────────────
//
// If PUBLIC_RENDERABLE_FONT_CLAUSE ever changes, this test fails immediately.
// That forces the author to also update RENDERABLE_FORMATS in cdn-policy.ts.

describe("renderable format alignment with public-font-policy.ts", () => {
  it("isRenderableFormat agrees exactly with PUBLIC_RENDERABLE_FONT_CLAUSE", () => {
    const clauseFormats = parseRenderableFormatsFromClause(
      PUBLIC_RENDERABLE_FONT_CLAUSE,
    );

    const knownFormats = ["ttf", "otf", "woff", "woff2", "ttc", "eot", "svg"];

    for (const fmt of knownFormats) {
      const fromPolicy = clauseFormats.has(fmt);
      const fromFunction = isRenderableFormat(fmt);
      assert.equal(
        fromFunction,
        fromPolicy,
        `Drift detected for format "${fmt}": ` +
          `public-font-policy says ${fromPolicy}, isRenderableFormat says ${fromFunction}. ` +
          `Update cdn-policy.ts RENDERABLE_FORMATS to match.`,
      );
    }

    // Also verify every format in the clause is accepted by our function
    for (const fmt of clauseFormats) {
      assert.ok(
        isRenderableFormat(fmt),
        `Format "${fmt}" is in PUBLIC_RENDERABLE_FONT_CLAUSE but isRenderableFormat rejects it`,
      );
    }
  });
});

// ── classifyDelivery ──────────────────────────────────────────────────────────

describe("classifyDelivery — format exclusion", () => {
  it("classifies ttc as not_renderable", () => {
    const result = classifyDelivery({ sizeBytes: 100, format: "ttc" });
    assert.equal(result.kind, "not_renderable");
    if (result.kind === "not_renderable") {
      assert.equal(result.reason, "NOT_RENDERABLE_FORMAT");
    }
  });

  it("classifies ttc as not_renderable even when also over the size limit", () => {
    // The one ttc row that is also over the CDN limit — format exclusion wins.
    const result = classifyDelivery({
      sizeBytes: JSDELIVR_MAX_BYTES + 1,
      format: "ttc",
    });
    assert.equal(result.kind, "not_renderable");
    if (result.kind === "not_renderable") {
      assert.equal(result.reason, "NOT_RENDERABLE_FORMAT");
    }
  });

  it("classifies null format as not_renderable", () => {
    const result = classifyDelivery({ sizeBytes: 100, format: null });
    assert.equal(result.kind, "not_renderable");
  });

  it("classifies eot as not_renderable", () => {
    const result = classifyDelivery({ sizeBytes: 100, format: "eot" });
    assert.equal(result.kind, "not_renderable");
    if (result.kind === "not_renderable") {
      assert.equal(result.reason, "NOT_RENDERABLE_FORMAT");
    }
  });
});

describe("classifyDelivery — CDN size boundary", () => {
  it("classifies a renderable file exactly at the limit as cdn-servable", () => {
    const result = classifyDelivery({
      sizeBytes: JSDELIVR_MAX_BYTES,
      format: "otf",
    });
    assert.equal(result.kind, "cdn");
  });

  it("classifies a renderable file one byte under the limit as cdn-servable", () => {
    const result = classifyDelivery({
      sizeBytes: JSDELIVR_MAX_BYTES - 1,
      format: "otf",
    });
    assert.equal(result.kind, "cdn");
  });

  it("classifies a renderable file one byte over the limit as raw_fallback", () => {
    const result = classifyDelivery({
      sizeBytes: JSDELIVR_MAX_BYTES + 1,
      format: "otf",
    });
    assert.equal(result.kind, "raw_fallback");
    if (result.kind === "raw_fallback") {
      assert.equal(result.reason, "EXCEEDS_CDN_SIZE_LIMIT");
    }
  });

  it("classifies the 99,759,400-byte TT2020 file as raw_fallback", () => {
    // Real fixture: TT2020StyleG-Regular.ttf — CDN returns 403.
    const result = classifyDelivery({
      sizeBytes: 99_759_400,
      format: "ttf",
    });
    assert.equal(result.kind, "raw_fallback");
    if (result.kind === "raw_fallback") {
      assert.equal(result.reason, "EXCEEDS_CDN_SIZE_LIMIT");
    }
  });
});

describe("classifyDelivery — null and zero sizeBytes", () => {
  it("classifies null size as cdn (size unknown → optimistic)", () => {
    // Null size rows were imported before size was populated; they pass through
    // to CDN and are reclassified by the health-check sweep if they 403.
    const result = classifyDelivery({ sizeBytes: null, format: "woff2" });
    assert.equal(result.kind, "cdn");
  });

  it("classifies size_bytes = 0 as cdn (one real row; treated as unknown)", () => {
    const result = classifyDelivery({ sizeBytes: 0, format: "woff" });
    assert.equal(result.kind, "cdn");
  });
});

describe("classifyDelivery — all four renderable formats with normal size", () => {
  const normalSize = 500_000; // 500 KiB, well under limit

  for (const fmt of ["ttf", "otf", "woff", "woff2"]) {
    it(`classifies ${fmt} at normal size as cdn`, () => {
      const result = classifyDelivery({ sizeBytes: normalSize, format: fmt });
      assert.equal(result.kind, "cdn");
    });
  }
});
