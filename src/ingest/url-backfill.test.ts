/**
 * url-backfill.test.ts — beads silofl-qiy.9
 *
 * Pure, offline tests. No database, no network, no env vars.
 * Uses node:test + node:assert/strict.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  planRowRewrite,
  buildBackupStatement,
  buildRewriteStatement,
  buildRollbackStatement,
} from "./url-backfill.js";

// ── Fixtures from the real database ─────────────────────────────────────────
//   (verified against live data 2026-08-02, stored values reproduced exactly)

/** Control: a normal branch-pinned row with a clean path (nerd-fonts patched). */
const FIXTURE_NORMAL = {
  id: "147",
  cdn_url:
    "https://cdn.jsdelivr.net/gh/ryanoasis/nerd-fonts@master/patched-fonts/3270/Condensed/3270NerdFont-Condensed.ttf",
  raw_url:
    "https://raw.githubusercontent.com/ryanoasis/nerd-fonts/master/patched-fonts/3270/Condensed/3270NerdFont-Condensed.ttf",
  sha: "0c4a3204f41a4b85b19fbeeb0895192d657aa8e2",
  size_bytes: "48000",
  format: "ttf",
};

/** Raw-space row: nerd-fonts AnonymousPro Bold-Italic (id 1772). */
const FIXTURE_SPACE = {
  id: "1772",
  cdn_url:
    "https://cdn.jsdelivr.net/gh/ryanoasis/nerd-fonts@master/src/unpatched-fonts/AnonymousPro/Bold-Italic/Anonymous Pro BI.ttf",
  raw_url:
    "https://raw.githubusercontent.com/ryanoasis/nerd-fonts/master/src/unpatched-fonts/AnonymousPro/Bold-Italic/Anonymous Pro BI.ttf",
  sha: "838f2d125233f373f3b5cff30ae3fde7f1089514",
  size_bytes: "142016",
  format: "ttf",
};

/** Non-ASCII row: arrowtype/recursive en-dash in path (id 27426). */
const FIXTURE_NONASCII = {
  id: "27426",
  cdn_url:
    "https://cdn.jsdelivr.net/gh/arrowtype/recursive@main/docs/02c-axis_subset_permutations--jul_2020/partial-fonts/wght-300\u2013800/Rec_1.053--subset-GF_latin_basic--MONO=1_wght=300:800.woff2",
  raw_url:
    "https://raw.githubusercontent.com/arrowtype/recursive/main/docs/02c-axis_subset_permutations--jul_2020/partial-fonts/wght-300\u2013800/Rec_1.053--subset-GF_latin_basic--MONO=1_wght=300:800.woff2",
  sha: "78a4e15460cf7809f8265c27455208d43c10bccd",
  size_bytes: null,
  format: "woff2",
};

/** Other-branch row: adobe source-code-pro @release (id 2578). */
const FIXTURE_RELEASE_BRANCH = {
  id: "2578",
  cdn_url:
    "https://cdn.jsdelivr.net/gh/adobe-fonts/source-code-pro@release/OTF/SourceCodePro-Black.otf",
  raw_url:
    "https://raw.githubusercontent.com/adobe-fonts/source-code-pro/release/OTF/SourceCodePro-Black.otf",
  sha: "fb6858c6ee854ca0046ebad31c9f358f2d06ac5f",
  size_bytes: "89000",
  format: "otf",
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("planRowRewrite", () => {
  // font_files.sha is a git BLOB sha, not a commit sha. Verified against the
  // live CDN on 2026-08-02: the branch ref returns 206, the same path with the
  // blob sha as ref returns 404, and GitHub's commit API does not recognise the
  // value as a commit object. jsDelivr resolves @<ref> only for a commit-ish.
  // So this backfill fixes encoding and classifies delivery; immutable pinning
  // is produced by the scan worker, which resolves the repo's commit sha.
  it("preserves the original ref and never substitutes the blob sha", () => {
    const plan = planRowRewrite(FIXTURE_NORMAL);
    assert.ok(plan.ok, `expected ok plan, got ${JSON.stringify(plan)}`);
    assert.ok(
      plan.newCdnUrl.includes("@master/"),
      `CDN URL should keep the branch ref, got ${plan.newCdnUrl}`,
    );
    assert.ok(
      !plan.newCdnUrl.includes(FIXTURE_NORMAL.sha),
      "the blob sha must never appear as a CDN ref — it 404s",
    );
    assert.ok(
      !plan.newRawUrl.includes(FIXTURE_NORMAL.sha),
      "the blob sha must never appear as a raw ref — it 404s",
    );
    assert.equal(
      plan.newCdnUrl,
      FIXTURE_NORMAL.cdn_url,
      "an already well-formed URL is left byte-identical",
    );
    assert.equal(plan.changes, false);
    assert.equal(plan.delivery, "cdn");
    assert.equal(plan.delivery_reason, null);
  });

  it("encodes spaces in the raw-space nerd-fonts row", () => {
    const plan = planRowRewrite(FIXTURE_SPACE);
    assert.ok(plan.ok, `expected ok plan, got ${JSON.stringify(plan)}`);
    // Space should now be %20-encoded
    assert.ok(
      !plan.newCdnUrl.includes(" "),
      `CDN URL must not contain literal space`,
    );
    assert.ok(
      !plan.newRawUrl.includes(" "),
      `raw URL must not contain literal space`,
    );
    assert.ok(
      plan.newCdnUrl.includes("%20"),
      `CDN URL should contain %20, got ${plan.newCdnUrl}`,
    );
    // Ref is preserved; the blob sha is never used (see note above).
    assert.ok(plan.newCdnUrl.includes("@master/"));
    assert.ok(!plan.newCdnUrl.includes(FIXTURE_SPACE.sha));
    assert.ok(plan.changes, "encoding a raw space is a real change");
  });

  it("encodes en-dash (non-ASCII) in the recursive row", () => {
    const plan = planRowRewrite(FIXTURE_NONASCII);
    assert.ok(plan.ok, `expected ok plan, got ${JSON.stringify(plan)}`);
    // En-dash U+2013 → %E2%80%93
    assert.ok(
      plan.newCdnUrl.includes("%E2%80%93"),
      `CDN URL should encode en-dash as %E2%80%93, got ${plan.newCdnUrl}`,
    );
    assert.ok(
      !plan.newCdnUrl.includes("\u2013"),
      "CDN URL must not contain raw en-dash",
    );
    assert.ok(!plan.newCdnUrl.includes(FIXTURE_NONASCII.sha));
    assert.ok(plan.changes, "encoding an en-dash is a real change");
  });

  it("preserves a non-default branch ref such as @release", () => {
    const plan = planRowRewrite(FIXTURE_RELEASE_BRANCH);
    assert.ok(plan.ok);
    assert.ok(
      plan.newCdnUrl.includes("@release/"),
      `should keep @release, got ${plan.newCdnUrl}`,
    );
    assert.ok(!plan.newCdnUrl.includes(FIXTURE_RELEASE_BRANCH.sha));
    assert.equal(plan.delivery, "cdn");
    assert.equal(plan.changes, false);
  });

  it("returns MISSING_SHA failure when sha is null", () => {
    const row = { ...FIXTURE_NORMAL, sha: null };
    const plan = planRowRewrite(row);
    assert.ok(!plan.ok);
    assert.equal(plan.reason, "MISSING_SHA");
  });

  it("returns MISSING_SHA failure when sha is empty string", () => {
    const row = { ...FIXTURE_NORMAL, sha: "" };
    const plan = planRowRewrite(row);
    assert.ok(!plan.ok);
    assert.equal(plan.reason, "MISSING_SHA");
  });

  it("returns UNPARSEABLE_CDN_URL when the CDN path is completely malformed", () => {
    const row = {
      ...FIXTURE_NORMAL,
      cdn_url:
        "https://cdn.jsdelivr.net/gh/nodots_or_slash_so_no_repo_or_path",
    };
    const plan = planRowRewrite(row);
    assert.ok(!plan.ok);
    assert.equal(plan.reason, "UNPARSEABLE_CDN_URL");
  });

  it("returns UNRECOGNISED_CDN_HOST when cdn_url is not jsDelivr", () => {
    const row = {
      ...FIXTURE_NORMAL,
      cdn_url: "https://example.com/fonts/something.ttf",
    };
    const plan = planRowRewrite(row);
    assert.ok(!plan.ok);
    assert.equal(plan.reason, "UNRECOGNISED_CDN_HOST");
  });

  it("returns UNRECOGNISED_RAW_HOST when raw_url is not raw.githubusercontent.com", () => {
    const row = {
      ...FIXTURE_NORMAL,
      raw_url: "https://example.com/fonts/something.ttf",
    };
    const plan = planRowRewrite(row);
    assert.ok(!plan.ok);
    assert.equal(plan.reason, "UNRECOGNISED_RAW_HOST");
  });

  it("classifies an oversized row as raw_fallback", () => {
    const row = {
      ...FIXTURE_NORMAL,
      size_bytes: String(21 * 1024 * 1024), // 22 MiB > 20 MiB limit
    };
    const plan = planRowRewrite(row);
    assert.ok(plan.ok);
    assert.equal(plan.delivery, "raw_fallback");
    assert.equal(plan.delivery_reason, "EXCEEDS_CDN_SIZE_LIMIT");
  });

  it("classifies a non-renderable format as not_renderable", () => {
    const row = { ...FIXTURE_NORMAL, format: "ttc" };
    const plan = planRowRewrite(row);
    assert.ok(plan.ok);
    assert.equal(plan.delivery, "not_renderable");
    assert.equal(plan.delivery_reason, "NOT_RENDERABLE_FORMAT");
  });

  it("reports changes=false when URLs are already sha-pinned and encoded", () => {
    // Build a row that is already rewritten
    const firstPlan = planRowRewrite(FIXTURE_NORMAL);
    assert.ok(firstPlan.ok);
    const alreadyRewritten = {
      ...FIXTURE_NORMAL,
      cdn_url: firstPlan.newCdnUrl,
      raw_url: firstPlan.newRawUrl,
    };
    const secondPlan = planRowRewrite(alreadyRewritten);
    assert.ok(secondPlan.ok);
    assert.equal(
      secondPlan.changes,
      false,
      "already-rewritten row should report changes=false",
    );
    assert.equal(secondPlan.newCdnUrl, firstPlan.newCdnUrl);
    assert.equal(secondPlan.newRawUrl, firstPlan.newRawUrl);
  });
});

// ── buildBackupStatement ─────────────────────────────────────────────────────

describe("buildBackupStatement", () => {
  it("produces parameterised INSERT with ON CONFLICT DO NOTHING", () => {
    const stmt = buildBackupStatement([
      {
        id: "1",
        cdn_url: "https://cdn.jsdelivr.net/gh/a/b@main/f.ttf",
        raw_url: "https://raw.githubusercontent.com/a/b/main/f.ttf",
      },
    ]);
    assert.ok(
      stmt.text.includes("ON CONFLICT (font_file_id) DO NOTHING"),
      "must be idempotent",
    );
    assert.equal(stmt.values.length, 3);
    assert.equal(stmt.values[0], "1");
  });

  it("handles multiple rows with correct parameter numbering", () => {
    const stmt = buildBackupStatement([
      {
        id: "1",
        cdn_url: "https://cdn.jsdelivr.net/gh/a/b@main/f.ttf",
        raw_url: "https://raw.githubusercontent.com/a/b/main/f.ttf",
      },
      {
        id: "2",
        cdn_url: "https://cdn.jsdelivr.net/gh/a/c@main/g.ttf",
        raw_url: "https://raw.githubusercontent.com/a/c/main/g.ttf",
      },
    ]);
    assert.equal(stmt.values.length, 6);
    assert.ok(stmt.text.includes("$4"), "second row should use $4");
  });

  it("returns a no-op for an empty array", () => {
    const stmt = buildBackupStatement([]);
    assert.ok(stmt.text.startsWith("SELECT"), "empty array → no-op SELECT");
    assert.equal(stmt.values.length, 0);
  });

  /**
   * Core idempotency test: ON CONFLICT DO NOTHING means running the backup
   * twice does not change the stored originals.  We verify this structurally —
   * the SQL text must contain the conflict clause.
   */
  it("idempotency: ON CONFLICT clause is present so second run cannot overwrite originals", () => {
    const stmt = buildBackupStatement([
      {
        id: "99",
        cdn_url: "https://cdn.jsdelivr.net/gh/o/r@master/orig.ttf",
        raw_url: "https://raw.githubusercontent.com/o/r/master/orig.ttf",
      },
    ]);
    assert.ok(
      stmt.text.toUpperCase().includes("ON CONFLICT"),
      "backup statement must have ON CONFLICT clause",
    );
    assert.ok(
      stmt.text.toUpperCase().includes("DO NOTHING"),
      "backup statement must have DO NOTHING clause",
    );
    // Values reflect the original (pre-rewrite) state
    assert.equal(
      stmt.values[1],
      "https://cdn.jsdelivr.net/gh/o/r@master/orig.ttf",
    );
  });
});

// ── buildRewriteStatement ────────────────────────────────────────────────────

describe("buildRewriteStatement", () => {
  it("builds a parameterised UPDATE for a single plan", () => {
    const plan = planRowRewrite(FIXTURE_NORMAL);
    assert.ok(plan.ok);
    const stmt = buildRewriteStatement([plan]);
    assert.ok(stmt.text.includes("UPDATE font_files"));
    assert.ok(stmt.text.includes("delivery"));
    assert.equal(stmt.values.length, 5);
  });

  it("returns a no-op for an empty array", () => {
    const stmt = buildRewriteStatement([]);
    assert.ok(stmt.text.startsWith("SELECT"));
  });
});

// ── buildRollbackStatement ───────────────────────────────────────────────────

describe("buildRollbackStatement", () => {
  it("builds an UPDATE...FROM font_files_url_backup with no parameters", () => {
    const stmt = buildRollbackStatement();
    assert.ok(stmt.text.includes("UPDATE font_files"));
    assert.ok(stmt.text.includes("font_files_url_backup"));
    assert.equal(stmt.values.length, 0);
  });

  it("NULLs delivery and delivery_reason on rollback", () => {
    const stmt = buildRollbackStatement();
    assert.ok(
      stmt.text.includes("delivery") && stmt.text.includes("NULL"),
      "rollback should clear delivery columns",
    );
  });
});

// ── Round-trip: backup → rewrite → rollback ──────────────────────────────────
//
// We cannot run SQL here (pure/offline), but we can verify that the three
// statements together form a reversible cycle:
//   1. backup captures the original values
//   2. rewrite changes them
//   3. rollback restores from backup
//
// The property we assert: the backup statement captures the ORIGINAL strings
// from the row, and the rollback statement references font_files_url_backup
// (not any rewritten values), so the restore is always the genuine original.

describe("round-trip correctness (structural)", () => {
  it("backup captures originals, rollback restores from backup — structural proof", () => {
    const originalCdn = FIXTURE_SPACE.cdn_url;
    const originalRaw = FIXTURE_SPACE.raw_url;

    // Step 1: backup — values must be the originals
    const backupStmt = buildBackupStatement([
      { id: FIXTURE_SPACE.id, cdn_url: originalCdn, raw_url: originalRaw },
    ]);
    assert.equal(backupStmt.values[1], originalCdn, "backup captures original cdn_url");
    assert.equal(backupStmt.values[2], originalRaw, "backup captures original raw_url");

    // Step 2: rewrite — values must be sha-pinned & encoded
    const plan = planRowRewrite(FIXTURE_SPACE);
    assert.ok(plan.ok);
    const rewriteStmt = buildRewriteStatement([plan]);
    // The rewritten CDN URL must differ from the original (has %20 instead of space)
    assert.notEqual(
      rewriteStmt.values[1],
      originalCdn,
      "rewrite must produce a different cdn_url",
    );
    assert.ok(
      (rewriteStmt.values[1] as string).includes("%20"),
      "rewritten cdn_url must have %20",
    );

    // Step 3: rollback — references font_files_url_backup, not the rewritten value
    const rollbackStmt = buildRollbackStatement();
    assert.ok(
      rollbackStmt.text.includes("font_files_url_backup"),
      "rollback must reference the backup table",
    );
    // The rollback statement has no values — it is a pure UPDATE...FROM join
    assert.equal(
      rollbackStmt.values.length,
      0,
      "rollback statement needs no parameters",
    );

    // Idempotency guarantee: backup ON CONFLICT means the original is safe
    // even if the script is re-run after a partial rewrite.
    assert.ok(
      backupStmt.text.includes("ON CONFLICT"),
      "backup is idempotent — original survives re-run",
    );
  });
});
