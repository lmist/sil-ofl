/**
 * asset-url.test.ts — beads silofl-qiy.6 + .8
 *
 * Pure offline tests.  No network calls.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCdnUrl,
  buildRawUrl,
  isWellFormedAssetUrl,
  normaliseExistingUrl,
} from "@/ingest/asset-url";

// ── Real fixtures from the audit ─────────────────────────────────────────────

const CONTROL_URL =
  "https://cdn.jsdelivr.net/gh/collletttivo/apfel-grotezk@main/fonts/ApfelGrotezk-Brukt.otf";

// Raw space — curl returns 000 (refused by curl as invalid URL)
const RAW_SPACE_URL =
  "https://cdn.jsdelivr.net/gh/ryanoasis/nerd-fonts@master/src/unpatched-fonts/AnonymousPro/Bold/Anonymous Pro B.ttf";

// Encoded space → 404 (link rot confirmed; path no longer exists upstream)
const ENCODED_SPACE_URL =
  "https://cdn.jsdelivr.net/gh/ryanoasis/nerd-fonts@master/src/unpatched-fonts/AnonymousPro/Bold/Anonymous%20Pro%20B.ttf";

// Non-ASCII en-dash + colon → CDN returns 400
const NON_ASCII_URL =
  "https://cdn.jsdelivr.net/gh/arrowtype/recursive@main/docs/02c-axis_subset_permutations--jul_2020/partial-fonts/wght-300\u2013800/Rec_1.053--subset-GF_latin_basic--MONO=1_wght=300:800.woff2";

// Over-size 403
const OVERSIZE_URL =
  "https://cdn.jsdelivr.net/gh/ctrlcctrlv/TT2020@master/dist/TT2020StyleG-Regular.ttf";

// ── buildCdnUrl ──────────────────────────────────────────────────────────────

describe("buildCdnUrl", () => {
  it("builds a clean URL for a simple path (control fixture)", () => {
    const url = buildCdnUrl({
      owner: "collletttivo",
      repo: "apfel-grotezk",
      ref: "main",
      path: "fonts/ApfelGrotezk-Brukt.otf",
    });
    assert.equal(url, CONTROL_URL);
  });

  it("percent-encodes a space in a path segment", () => {
    const url = buildCdnUrl({
      owner: "ryanoasis",
      repo: "nerd-fonts",
      ref: "master",
      path: "src/unpatched-fonts/AnonymousPro/Bold/Anonymous Pro B.ttf",
    });
    assert.ok(url.includes("%20"), "space should be encoded as %20");
    assert.equal(url, ENCODED_SPACE_URL);
    assert.ok(isWellFormedAssetUrl(url), "encoded URL should be well-formed");
  });

  it("percent-encodes en-dash and colon in path segments", () => {
    const url = buildCdnUrl({
      owner: "arrowtype",
      repo: "recursive",
      ref: "main",
      path: "docs/02c-axis_subset_permutations--jul_2020/partial-fonts/wght-300\u2013800/Rec_1.053--subset-GF_latin_basic--MONO=1_wght=300:800.woff2",
    });
    // en-dash U+2013 encodes to %E2%80%93 in UTF-8
    assert.ok(url.includes("%E2%80%93"), "en-dash should be encoded");
    // colon encodes to %3A
    assert.ok(url.includes("%3A"), "colon should be encoded");
    assert.ok(isWellFormedAssetUrl(url), "encoded URL should be well-formed");
  });

  it("accepts a sha ref and produces a well-formed URL", () => {
    const sha = "a".repeat(40);
    const url = buildCdnUrl({
      owner: "acme",
      repo: "fonts",
      ref: sha,
      path: "fonts/MyFont-Regular.otf",
    });
    assert.ok(url.includes(`@${sha}/`), "sha should appear verbatim");
    assert.ok(isWellFormedAssetUrl(url));
  });

  it("strips a leading slash from path", () => {
    const url1 = buildCdnUrl({
      owner: "acme",
      repo: "fonts",
      ref: "main",
      path: "/fonts/test.otf",
    });
    const url2 = buildCdnUrl({
      owner: "acme",
      repo: "fonts",
      ref: "main",
      path: "fonts/test.otf",
    });
    assert.equal(url1, url2);
  });

  it("does not double-encode an already-encoded segment", () => {
    const url = buildCdnUrl({
      owner: "acme",
      repo: "fonts",
      ref: "main",
      path: "fonts/My%20Font.otf",
    });
    // %20 must appear exactly once, not as %2520
    assert.ok(url.includes("%20"), "encoded sequence must pass through");
    assert.ok(!url.includes("%2520"), "must not double-encode");
  });

  it("encodes a bare % that is not a valid escape", () => {
    const url = buildCdnUrl({
      owner: "acme",
      repo: "fonts",
      ref: "main",
      path: "fonts/50%.otf",
    });
    assert.ok(url.includes("%25"), "bare % must be encoded as %25");
    assert.ok(!url.includes("%2525"), "must not double-encode the encoded %");
  });

  it("encodes a unicode filename", () => {
    const url = buildCdnUrl({
      owner: "acme",
      repo: "fonts",
      ref: "main",
      path: "fonts/フォント-Regular.ttf",
    });
    assert.ok(!url.includes("フ"), "non-ASCII must be encoded");
    assert.ok(isWellFormedAssetUrl(url));
  });

  it("survives a very long path", () => {
    const segment = "a".repeat(200);
    const url = buildCdnUrl({
      owner: "acme",
      repo: "fonts",
      ref: "main",
      path: `${segment}/${segment}/${segment}.otf`,
    });
    assert.ok(isWellFormedAssetUrl(url));
  });
});

// ── buildRawUrl ──────────────────────────────────────────────────────────────

describe("buildRawUrl", () => {
  it("builds a raw GitHub URL with encoded path", () => {
    const url = buildRawUrl({
      owner: "ryanoasis",
      repo: "nerd-fonts",
      ref: "master",
      path: "src/unpatched-fonts/AnonymousPro/Bold/Anonymous Pro B.ttf",
    });
    assert.equal(
      url,
      "https://raw.githubusercontent.com/ryanoasis/nerd-fonts/master/src/unpatched-fonts/AnonymousPro/Bold/Anonymous%20Pro%20B.ttf",
    );
    assert.ok(isWellFormedAssetUrl(url));
  });

  it("uses raw.githubusercontent.com origin", () => {
    const url = buildRawUrl({
      owner: "acme",
      repo: "fonts",
      ref: "main",
      path: "test.otf",
    });
    assert.ok(url.startsWith("https://raw.githubusercontent.com/"));
  });
});

// ── isWellFormedAssetUrl ─────────────────────────────────────────────────────

describe("isWellFormedAssetUrl", () => {
  it("accepts the control fixture", () => {
    assert.ok(isWellFormedAssetUrl(CONTROL_URL));
  });

  it("accepts the over-size URL (well-formed even though CDN returns 403)", () => {
    // URL correctness and CDN delivery are separate concerns.
    assert.ok(isWellFormedAssetUrl(OVERSIZE_URL));
  });

  it("rejects a raw-space URL", () => {
    assert.equal(isWellFormedAssetUrl(RAW_SPACE_URL), false);
  });

  it("rejects a URL with a non-ASCII character (en-dash)", () => {
    assert.equal(isWellFormedAssetUrl(NON_ASCII_URL), false);
  });

  it("accepts the encoded-space URL (structurally valid; 404 is a separate problem)", () => {
    assert.ok(isWellFormedAssetUrl(ENCODED_SPACE_URL));
  });

  it("rejects an empty string", () => {
    assert.equal(isWellFormedAssetUrl(""), false);
  });

  it("rejects a URL with an unapproved origin", () => {
    assert.equal(
      isWellFormedAssetUrl("https://evil.example.com/fonts/test.otf"),
      false,
    );
  });

  it("rejects a URL with a `#` fragment in the path position", () => {
    assert.equal(
      isWellFormedAssetUrl(
        "https://cdn.jsdelivr.net/gh/acme/fonts@main/test#fragment.otf",
      ),
      false,
    );
  });

  it("rejects a URL with credentials", () => {
    assert.equal(
      isWellFormedAssetUrl(
        "https://user:pass@cdn.jsdelivr.net/gh/acme/fonts@main/test.otf",
      ),
      false,
    );
  });

  it("rejects an HTTP (non-HTTPS) URL", () => {
    assert.equal(
      isWellFormedAssetUrl(
        "http://cdn.jsdelivr.net/gh/acme/fonts@main/test.otf",
      ),
      false,
    );
  });

  it("URLs produced by buildCdnUrl always pass", () => {
    const cases: Array<{ path: string }> = [
      { path: "fonts/Regular.otf" },
      { path: "fonts/My Font.otf" },
      { path: "fonts/\u2013dash.woff2" },
      { path: "fonts/50%.otf" },
    ];
    for (const { path } of cases) {
      const url = buildCdnUrl({ owner: "acme", repo: "fonts", ref: "main", path });
      assert.ok(
        isWellFormedAssetUrl(url),
        `Expected well-formed for path: ${path}, got: ${url}`,
      );
    }
  });
});

// ── normaliseExistingUrl ─────────────────────────────────────────────────────

describe("normaliseExistingUrl", () => {
  it("returns the control URL unchanged", () => {
    assert.equal(normaliseExistingUrl(CONTROL_URL), CONTROL_URL);
  });

  it("encodes a raw-space CDN URL without throwing", () => {
    const result = normaliseExistingUrl(RAW_SPACE_URL);
    assert.ok(result !== null, "should not return null");
    assert.ok(isWellFormedAssetUrl(result!), "result should be well-formed");
    assert.ok(result!.includes("%20"), "space should be encoded");
  });

  it("normalises the non-ASCII CDN URL", () => {
    const result = normaliseExistingUrl(NON_ASCII_URL);
    assert.ok(result !== null);
    assert.ok(isWellFormedAssetUrl(result!));
    assert.ok(!result!.includes("\u2013"), "en-dash must be encoded");
  });

  it("normalises an already-encoded URL idempotently", () => {
    const encoded = buildCdnUrl({
      owner: "acme",
      repo: "fonts",
      ref: "main",
      path: "fonts/My Font.otf",
    });
    const result = normaliseExistingUrl(encoded);
    assert.equal(result, encoded, "re-normalising should be idempotent");
  });

  it("returns null for a non-CDN, non-raw URL", () => {
    assert.equal(
      normaliseExistingUrl("https://example.com/font.otf"),
      null,
    );
  });

  it("returns null for an empty string", () => {
    assert.equal(normaliseExistingUrl(""), null);
  });

  it("normalises a raw.githubusercontent.com URL", () => {
    const rawWithSpace =
      "https://raw.githubusercontent.com/acme/fonts/main/fonts/My Font.otf";
    const result = normaliseExistingUrl(rawWithSpace);
    assert.ok(result !== null);
    assert.ok(isWellFormedAssetUrl(result!));
    assert.ok(result!.includes("%20"));
  });

  it("handles a path with an already-encoded percent sequence", () => {
    // Stored as partially encoded: "My%20Font.otf"
    const url =
      "https://cdn.jsdelivr.net/gh/acme/fonts@main/fonts/My%20Font.otf";
    const result = normaliseExistingUrl(url);
    assert.ok(result !== null);
    assert.ok(isWellFormedAssetUrl(result!));
    // Must not become My%2520Font
    assert.ok(!result!.includes("%2520"), "must not double-encode");
  });

  it("handles a path segment with `..` (preserved verbatim — path traversal is not our scope)", () => {
    // We do not rewrite paths; that is the ingest pipeline's job.
    const url =
      "https://cdn.jsdelivr.net/gh/acme/fonts@main/fonts/../test.otf";
    const result = normaliseExistingUrl(url);
    // Should still produce a well-formed URL even if semantically odd
    assert.ok(result !== null);
  });

  it("handles a path with an empty segment (double-slash)", () => {
    const url =
      "https://cdn.jsdelivr.net/gh/acme/fonts@main/fonts//test.otf";
    const result = normaliseExistingUrl(url);
    assert.ok(result !== null);
  });
});
