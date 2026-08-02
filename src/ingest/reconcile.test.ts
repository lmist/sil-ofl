/**
 * reconcile.test.ts — offline tests for reconcile.ts
 *
 * No database. No network. Pure logic tests.
 * Uses node:test + node:assert/strict.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  markObservationComplete,
  reconcileFiles,
  buildRetireQuery,
  buildUnretireQuery,
  buildLoadStoredFilesQuery,
  type StoredFontFile,
} from "@/ingest/reconcile";
import type { FontFileInput } from "@/ingest/upsert";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFont(path: string, sha = "abc123"): FontFileInput {
  return {
    repo_id: BigInt(1),
    path,
    file_name: path.split("/").pop()!,
    format: "ttf",
    raw_url: `https://raw.githubusercontent.com/owner/repo/sha/${path}`,
    cdn_url: `https://cdn.jsdelivr.net/gh/owner/repo@sha/${path}`,
    blob_url: null,
    branch: "main",
    size_bytes: 50000,
    family_guess: null,
    subfamily_guess: null,
    weight_guess: null,
    style_guess: null,
    is_variable: false,
    is_webfont: false,
    sha,
    discovered_at: new Date("2026-01-01"),
  };
}

function makeStored(id: number | bigint, path: string, retired = false): StoredFontFile {
  return {
    id: BigInt(id),
    path,
    retired_at: retired ? new Date("2025-01-01") : null,
  };
}

// ---------------------------------------------------------------------------
// markObservationComplete
// ---------------------------------------------------------------------------

describe("markObservationComplete", () => {
  it("wraps font array in a complete observation token", () => {
    const fonts = [makeFont("fonts/A.ttf")];
    const obs = markObservationComplete(fonts);
    // The token exposes the fonts array
    assert.equal(obs.fonts.length, 1);
    assert.equal(obs.fonts[0]!.path, "fonts/A.ttf");
  });

  it("is the only way to construct a CompleteObservation", () => {
    // TypeScript enforces this at compile time; at runtime we verify the
    // shape is correct so no ad-hoc object can be passed.
    const obs = markObservationComplete([]);
    assert.ok("fonts" in obs);
    assert.ok(Array.isArray(obs.fonts));
  });
});

// ---------------------------------------------------------------------------
// reconcileFiles
// ---------------------------------------------------------------------------

describe("reconcileFiles", () => {
  it("upserts all observed fonts when there are no stored rows", () => {
    const observed = markObservationComplete([
      makeFont("fonts/A.ttf"),
      makeFont("fonts/B.woff2"),
    ]);
    const { toUpsert, toRetire, unchanged } = reconcileFiles({ observed, stored: [] });
    assert.equal(toUpsert.length, 2);
    assert.equal(toRetire.length, 0);
    assert.equal(unchanged.length, 0);
  });

  it("retires stored non-retired rows absent from the observation", () => {
    const observed = markObservationComplete([makeFont("fonts/A.ttf")]);
    const stored = [
      makeStored(1, "fonts/A.ttf"),
      makeStored(2, "fonts/B.ttf"), // present in store, absent from observation
    ];
    const { toUpsert, toRetire } = reconcileFiles({ observed, stored });
    assert.equal(toUpsert.length, 1);
    assert.equal(toRetire.length, 1);
    assert.equal(toRetire[0]!.path, "fonts/B.ttf");
  });

  it("does NOT retire already-retired rows", () => {
    const observed = markObservationComplete([]); // nothing observed
    const stored = [
      makeStored(1, "fonts/AlreadyGone.ttf", true), // already retired
    ];
    const { toRetire } = reconcileFiles({ observed, stored });
    assert.equal(toRetire.length, 0);
  });

  it("includes reappeared retired paths in toUpsert (not toRetire)", () => {
    const observed = markObservationComplete([makeFont("fonts/ReturningPath.ttf")]);
    const stored = [
      makeStored(99, "fonts/ReturningPath.ttf", true), // was retired
    ];
    const { toUpsert, toRetire } = reconcileFiles({ observed, stored });
    assert.equal(toUpsert.length, 1);
    assert.equal(toUpsert[0]!.path, "fonts/ReturningPath.ttf");
    assert.equal(toRetire.length, 0);
  });

  it("handles empty observation and empty stored gracefully", () => {
    const observed = markObservationComplete([]);
    const { toUpsert, toRetire, unchanged } = reconcileFiles({ observed, stored: [] });
    assert.equal(toUpsert.length, 0);
    assert.equal(toRetire.length, 0);
    assert.equal(unchanged.length, 0);
  });

  it("marks existing non-retired rows as unchanged", () => {
    const observed = markObservationComplete([makeFont("fonts/A.ttf")]);
    const stored = [makeStored(1, "fonts/A.ttf")]; // non-retired, same path
    const { unchanged } = reconcileFiles({ observed, stored });
    assert.equal(unchanged.length, 1);
    assert.equal(unchanged[0]!.path, "fonts/A.ttf");
  });

  it("correctly handles mixed scenario", () => {
    const observed = markObservationComplete([
      makeFont("fonts/Kept.ttf"),
      makeFont("fonts/New.otf"),
      makeFont("fonts/Returned.woff2"), // was retired
    ]);
    const stored = [
      makeStored(1, "fonts/Kept.ttf"),          // stays
      makeStored(2, "fonts/Gone.ttf"),           // will be retired
      makeStored(3, "fonts/Returned.woff2", true), // was retired, now back
      makeStored(4, "fonts/AlsoGone.otf", true),  // retired and still gone — no-op
    ];
    const { toUpsert, toRetire } = reconcileFiles({ observed, stored });
    assert.equal(toUpsert.length, 3); // Kept, New, Returned
    assert.equal(toRetire.length, 1); // Gone
    assert.equal(toRetire[0]!.path, "fonts/Gone.ttf");
  });
});

// ---------------------------------------------------------------------------
// buildRetireQuery
// ---------------------------------------------------------------------------

describe("buildRetireQuery", () => {
  it("produces a parameterised UPDATE with id and reason", () => {
    const q = buildRetireQuery(BigInt(42));
    assert.ok(q.text.includes("UPDATE font_files"));
    assert.ok(q.text.includes("retired_at"));
    assert.ok(q.text.includes("retired_reason"));
    assert.ok(q.text.includes("$1"));
    assert.ok(q.text.includes("$2"));
    assert.equal(q.values[0], BigInt(42));
    assert.equal(q.values[1], "path-not-observed");
  });

  it("accepts a custom reason", () => {
    const q = buildRetireQuery(BigInt(1), "dmca-takedown");
    assert.equal(q.values[1], "dmca-takedown");
  });

  it("guards with retired_at IS NULL to prevent double-retire", () => {
    const q = buildRetireQuery(BigInt(1));
    assert.ok(q.text.includes("retired_at IS NULL"));
  });

  it("never issues a DELETE — only UPDATE", () => {
    const q = buildRetireQuery(BigInt(1));
    assert.ok(!q.text.toUpperCase().includes("DELETE"));
  });
});

// ---------------------------------------------------------------------------
// buildUnretireQuery
// ---------------------------------------------------------------------------

describe("buildUnretireQuery", () => {
  it("produces an UPDATE that clears retired_at and retired_reason", () => {
    const q = buildUnretireQuery(BigInt(7));
    assert.ok(q.text.includes("UPDATE font_files"));
    assert.ok(q.text.includes("retired_at     = NULL"));
    assert.ok(q.text.includes("retired_reason = NULL"));
    assert.equal(q.values[0], BigInt(7));
  });

  it("guards with retired_at IS NOT NULL to avoid no-op double-unretire", () => {
    const q = buildUnretireQuery(BigInt(7));
    assert.ok(q.text.includes("retired_at IS NOT NULL"));
  });
});

// ---------------------------------------------------------------------------
// buildLoadStoredFilesQuery
// ---------------------------------------------------------------------------

describe("buildLoadStoredFilesQuery", () => {
  it("selects id, path, retired_at for the given repo_id", () => {
    const q = buildLoadStoredFilesQuery(BigInt(123));
    assert.ok(q.text.includes("SELECT"));
    assert.ok(q.text.includes("id"));
    assert.ok(q.text.includes("path"));
    assert.ok(q.text.includes("retired_at"));
    assert.ok(q.text.includes("repo_id = $1"));
    assert.equal(q.values[0], BigInt(123));
  });
});
