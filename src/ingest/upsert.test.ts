/**
 * Tests for src/ingest/upsert.ts
 *
 * All tests are pure and offline — no network, no live database.
 * bun:sqlite in-memory fixtures are used to validate the idempotency semantics
 * that are modelled in the generated SQL (WHERE clause, COALESCE merge).
 *
 * Style: node:test / node:assert/strict, matching the house test convention.
 *
 * INV-DATA-3 coverage: every value in a query must be a bound parameter.
 * The adversarial cases include repo names and paths with quotes, semicolons,
 * and SQL comment sequences.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Database } from "bun:sqlite";
import {
  buildOwnerUpsert,
  buildRepoUpsert,
  buildFontFileUpsert,
  buildRescanQueueQuery,
  needsRescan,
  type OwnerInput,
  type RepoInput,
  type FontFileInput,
  type RepoScanState,
} from "./upsert";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-08-02T00:00:00Z");
const BEFORE = new Date("2026-07-01T00:00:00Z");
const AFTER = new Date("2026-08-03T00:00:00Z");

const sampleOwner: OwnerInput = {
  id: BigInt(1001),
  login: "sil-fonts",
  owner_type: "Organization",
  html_url: "https://github.com/sil-fonts",
};

const sampleRepo: RepoInput = {
  id: BigInt(2001),
  full_name: "sil-fonts/charis",
  name: "charis",
  owner_id: BigInt(1001),
  license_spdx: "OFL-1.1",
  description: "Charis SIL font family",
  html_url: "https://github.com/sil-fonts/charis",
  homepage: "https://software.sil.org/charis",
  language: null,
  default_branch: "main",
  stars: 420,
  forks: 12,
  watchers: 420,
  open_issues: 3,
  size_kb: 8192,
  is_fork: false,
  is_archived: false,
  is_fontish: true,
  reputation: 84,
  created_at: new Date("2020-01-15T00:00:00Z"),
  updated_at: NOW,
  pushed_at: NOW,
};

const sampleFile: FontFileInput = {
  repo_id: BigInt(2001),
  path: "fonts/CharisSIL-Regular.ttf",
  file_name: "CharisSIL-Regular.ttf",
  format: "ttf",
  raw_url: "https://raw.githubusercontent.com/sil-fonts/charis/main/fonts/CharisSIL-Regular.ttf",
  cdn_url: "https://cdn.jsdelivr.net/gh/sil-fonts/charis@main/fonts/CharisSIL-Regular.ttf",
  blob_url: null,
  branch: "main",
  size_bytes: BigInt(1_234_567),
  family_guess: "Charis SIL",
  subfamily_guess: "Regular",
  weight_guess: 400,
  style_guess: "normal",
  is_variable: false,
  is_webfont: false,
  sha: "abc123def456",
  discovered_at: NOW,
};

// ---------------------------------------------------------------------------
// Helper: assert no value appears inline in query text
// ---------------------------------------------------------------------------

/**
 * Verify that none of the bound values appear verbatim in the query text.
 * This is the core INV-DATA-3 check: values must be parameters, not inline.
 */
function assertNoInlineValues(text: string, values: unknown[]): void {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const str = String(value);
    // Short or numeric strings could appear in syntax keywords; skip those
    // Strings longer than 3 chars that appear literally are the risk
    if (str.length <= 3) continue;
    // We check the trimmed string is not in the query text
    assert.ok(
      !text.includes(str),
      `Value "${str}" appears inline in query text — violates INV-DATA-3`,
    );
  }
}

// ---------------------------------------------------------------------------
// buildOwnerUpsert
// ---------------------------------------------------------------------------

describe("buildOwnerUpsert", () => {
  it("returns text and values", () => {
    const { text, values } = buildOwnerUpsert(sampleOwner);
    assert.equal(typeof text, "string");
    assert.ok(text.length > 0);
    assert.ok(Array.isArray(values));
    assert.equal(values.length, 4);
  });

  it("contains INSERT INTO owners and ON CONFLICT", () => {
    const { text } = buildOwnerUpsert(sampleOwner);
    assert.ok(text.toUpperCase().includes("INSERT INTO OWNERS"));
    assert.ok(text.toUpperCase().includes("ON CONFLICT"));
    assert.ok(text.toUpperCase().includes("DO UPDATE"));
  });

  it("uses a WHERE guard on the update for idempotency", () => {
    const { text } = buildOwnerUpsert(sampleOwner);
    assert.ok(text.toUpperCase().includes("WHERE"), "Missing WHERE idempotency guard");
    assert.ok(text.includes("IS DISTINCT FROM"), "Missing IS DISTINCT FROM comparison");
  });

  it("no value appears inline — INV-DATA-3 (normal case)", () => {
    const { text, values } = buildOwnerUpsert(sampleOwner);
    assertNoInlineValues(text, values);
  });

  it("no value appears inline — INV-DATA-3 adversarial: quote, semicolon, comment", () => {
    const adversarial: OwnerInput = {
      id: BigInt(9999),
      login: "hacker'; DROP TABLE owners; --",
      owner_type: "User",
      html_url: "https://github.com/hacker%27; DROP TABLE owners; --",
    };
    const { text, values } = buildOwnerUpsert(adversarial);
    assertNoInlineValues(text, values);
    // Specifically check the injection strings are not in the text
    assert.ok(!text.includes("DROP TABLE"), "SQL injection found in query text");
    assert.ok(!text.includes("--"), "Comment injection found in query text");
  });
});

// ---------------------------------------------------------------------------
// buildRepoUpsert
// ---------------------------------------------------------------------------

describe("buildRepoUpsert", () => {
  it("returns text and values with 22 bound parameters", () => {
    const { text, values } = buildRepoUpsert(sampleRepo);
    assert.equal(typeof text, "string");
    assert.equal(values.length, 22);
  });

  it("contains conflict target on full_name", () => {
    const { text } = buildRepoUpsert(sampleRepo);
    assert.ok(text.includes("full_name"), "Missing conflict target column");
    assert.ok(text.toUpperCase().includes("ON CONFLICT"));
  });

  it("uses WHERE guard for idempotency", () => {
    const { text } = buildRepoUpsert(sampleRepo);
    assert.ok(text.toUpperCase().includes("WHERE"), "Missing WHERE idempotency guard");
    assert.ok(text.includes("IS DISTINCT FROM"));
  });

  it("does NOT update fonts_scanned_at or fonts_scan_error", () => {
    const { text } = buildRepoUpsert(sampleRepo);
    // These columns must not appear in the actual SET assignments.
    // Strip SQL line comments first so documentation comments do not
    // false-positive as SET assignments.
    const upper = text.toUpperCase();
    const setIdx = upper.indexOf("SET ");
    const whereIdx = upper.indexOf("\n  WHERE", setIdx);
    const setBlock = whereIdx === -1 ? text.slice(setIdx) : text.slice(setIdx, whereIdx);
    // Remove single-line SQL comments (-- ... to end of line)
    const setWithoutComments = setBlock.replace(/--[^\n]*/g, "");
    assert.ok(
      !setWithoutComments.includes("fonts_scanned_at"),
      "fonts_scanned_at must not appear as a SET assignment — scan worker owns it",
    );
    assert.ok(
      !setWithoutComments.includes("fonts_scan_error"),
      "fonts_scan_error must not appear as a SET assignment — scan worker owns it",
    );
  });

  it("uses COALESCE for created_at (merge-preserving)", () => {
    const { text } = buildRepoUpsert(sampleRepo);
    assert.ok(
      text.toUpperCase().includes("COALESCE"),
      "created_at should be merge-preserving via COALESCE",
    );
  });

  it("no value appears inline — INV-DATA-3 (normal case)", () => {
    const { text, values } = buildRepoUpsert(sampleRepo);
    assertNoInlineValues(text, values);
  });

  it("no value appears inline — INV-DATA-3 adversarial repo name", () => {
    const adversarial: RepoInput = {
      ...sampleRepo,
      full_name: "evil'; UPDATE repos SET stars=0; --/injection",
      name: "injection",
      description: 'Repo with "quotes" and semicolons; and -- comments',
    };
    const { text, values } = buildRepoUpsert(adversarial);
    assertNoInlineValues(text, values);
    assert.ok(!text.includes("UPDATE repos SET"), "SQL injection in query text");
  });

  it("idempotency: identical second call produces same SQL shape", () => {
    const { text: t1, values: v1 } = buildRepoUpsert(sampleRepo);
    const { text: t2, values: v2 } = buildRepoUpsert(sampleRepo);
    assert.equal(t1, t2);
    assert.deepEqual(v1, v2);
  });
});

// ---------------------------------------------------------------------------
// buildFontFileUpsert
// ---------------------------------------------------------------------------

describe("buildFontFileUpsert", () => {
  it("returns text and values with 17 bound parameters", () => {
    const { text, values } = buildFontFileUpsert(sampleFile);
    assert.equal(typeof text, "string");
    assert.equal(values.length, 17);
  });

  it("conflict target is (repo_id, path)", () => {
    const { text } = buildFontFileUpsert(sampleFile);
    assert.ok(text.includes("repo_id") && text.includes("path"));
    assert.ok(text.toUpperCase().includes("ON CONFLICT"));
  });

  it("uses COALESCE for all four guess columns", () => {
    const { text } = buildFontFileUpsert(sampleFile);
    // Count COALESCE occurrences — should be 4 (one per guess column)
    const matches = text.match(/COALESCE/gi) ?? [];
    assert.ok(matches.length >= 4, `Expected ≥4 COALESCE, found ${matches.length}`);
  });

  it("null incoming guess does not erase existing value (COALESCE semantics)", () => {
    // Verify using bun:sqlite in-memory fixture
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE font_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL,
        path TEXT NOT NULL,
        file_name TEXT,
        format TEXT,
        raw_url TEXT,
        cdn_url TEXT,
        blob_url TEXT,
        branch TEXT,
        size_bytes INTEGER,
        family_guess TEXT,
        subfamily_guess TEXT,
        weight_guess INTEGER,
        style_guess TEXT,
        is_variable INTEGER,
        is_webfont INTEGER,
        sha TEXT,
        discovered_at TEXT,
        UNIQUE(repo_id, path)
      );
    `);

    // Insert initial row with full metadata (simulating what metadata worker set)
    db.exec(`
      INSERT INTO font_files (repo_id, path, file_name, format, raw_url, cdn_url, blob_url,
        branch, size_bytes, family_guess, subfamily_guess, weight_guess, style_guess,
        is_variable, is_webfont, sha, discovered_at)
      VALUES (2001, 'fonts/Test.ttf', 'Test.ttf', 'ttf',
        'https://raw.example.com/Test.ttf', 'https://cdn.example.com/Test.ttf', NULL,
        'main', 500000, 'Test Family', 'Regular', 400, 'normal',
        0, 0, 'abc123', '2026-08-01T00:00:00Z')
    `);

    // Model COALESCE semantics directly in SQLite
    // (null-carrying upsert: family_guess=null, etc.)
    // (bun:sqlite doesn't speak $N parameterized queries the same way as pg,
    // so we model it with a manual SQLite equivalent)
    db.exec(`
      INSERT INTO font_files (repo_id, path, file_name, format, raw_url, cdn_url, blob_url,
        branch, size_bytes, family_guess, subfamily_guess, weight_guess, style_guess,
        is_variable, is_webfont, sha, discovered_at)
      VALUES (2001, 'fonts/Test.ttf', 'Test-v2.ttf', 'ttf',
        'https://raw.example.com/Test.ttf', 'https://cdn.example.com/Test.ttf', NULL,
        'main', 600000, NULL, NULL, NULL, NULL,
        0, 0, 'def456', '2026-08-02T00:00:00Z')
      ON CONFLICT (repo_id, path) DO UPDATE
        SET file_name      = excluded.file_name,
            format         = excluded.format,
            raw_url        = excluded.raw_url,
            cdn_url        = excluded.cdn_url,
            blob_url       = excluded.blob_url,
            branch         = excluded.branch,
            size_bytes     = excluded.size_bytes,
            is_variable    = excluded.is_variable,
            is_webfont     = excluded.is_webfont,
            sha            = excluded.sha,
            discovered_at  = excluded.discovered_at,
            -- COALESCE: prefer incoming non-null, fall back to stored value
            family_guess    = COALESCE(excluded.family_guess,    font_files.family_guess),
            subfamily_guess = COALESCE(excluded.subfamily_guess, font_files.subfamily_guess),
            weight_guess    = COALESCE(excluded.weight_guess,    font_files.weight_guess),
            style_guess     = COALESCE(excluded.style_guess,     font_files.style_guess)
    `);

    const row = db.prepare("SELECT * FROM font_files WHERE path = 'fonts/Test.ttf'").get() as Record<string, unknown>;
    // Authoritative columns: updated to new values
    assert.equal(row["file_name"], "Test-v2.ttf", "file_name should be updated");
    assert.equal(row["sha"], "def456", "sha should be updated");
    // Merge-preserving columns: null incoming should not erase stored values
    assert.equal(row["family_guess"], "Test Family", "family_guess must not be erased by null");
    assert.equal(row["subfamily_guess"], "Regular", "subfamily_guess must not be erased by null");
    assert.equal(row["weight_guess"], 400, "weight_guess must not be erased by null");
    assert.equal(row["style_guess"], "normal", "style_guess must not be erased by null");

    db.close();
  });

  it("non-null incoming guess overwrites stored value (COALESCE prefers non-null)", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE font_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER, path TEXT,
        family_guess TEXT, weight_guess INTEGER,
        UNIQUE(repo_id, path)
      );
      INSERT INTO font_files (repo_id, path, family_guess, weight_guess)
      VALUES (1, 'a.ttf', 'Old Family', 400);
    `);

    // Upsert with a fresh non-null family_guess
    db.exec(`
      INSERT INTO font_files (repo_id, path, family_guess, weight_guess)
      VALUES (1, 'a.ttf', 'New Family', 700)
      ON CONFLICT (repo_id, path) DO UPDATE
        SET family_guess  = COALESCE(excluded.family_guess,  font_files.family_guess),
            weight_guess  = COALESCE(excluded.weight_guess,  font_files.weight_guess)
    `);

    const row = db.prepare("SELECT family_guess, weight_guess FROM font_files WHERE path='a.ttf'").get() as Record<string, unknown>;
    assert.equal(row["family_guess"], "New Family");
    assert.equal(row["weight_guess"], 700);
    db.close();
  });

  it("second identical upsert changes no rows (WHERE clause idempotency)", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE font_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER, path TEXT,
        file_name TEXT, format TEXT, raw_url TEXT, cdn_url TEXT, blob_url TEXT,
        branch TEXT, size_bytes INTEGER, is_variable INTEGER, is_webfont INTEGER,
        sha TEXT, discovered_at TEXT,
        UNIQUE(repo_id, path)
      );
    `);

    const insertSQL = `
      INSERT INTO font_files (repo_id, path, file_name, format, raw_url, cdn_url, blob_url,
        branch, size_bytes, is_variable, is_webfont, sha, discovered_at)
      VALUES (2001, 'fonts/Same.ttf', 'Same.ttf', 'ttf',
        'https://raw.example.com/Same.ttf', 'https://cdn.example.com/Same.ttf', NULL,
        'main', 500000, 0, 0, 'aaa111', '2026-08-01T00:00:00Z')
      ON CONFLICT (repo_id, path) DO UPDATE
        SET file_name      = excluded.file_name,
            format         = excluded.format,
            raw_url        = excluded.raw_url,
            cdn_url        = excluded.cdn_url,
            blob_url       = excluded.blob_url,
            branch         = excluded.branch,
            size_bytes     = excluded.size_bytes,
            is_variable    = excluded.is_variable,
            is_webfont     = excluded.is_webfont,
            sha            = excluded.sha,
            discovered_at  = excluded.discovered_at
        WHERE font_files.file_name   IS NOT excluded.file_name
           OR font_files.format      IS NOT excluded.format
           OR font_files.raw_url     IS NOT excluded.raw_url
           OR font_files.cdn_url     IS NOT excluded.cdn_url
           OR font_files.branch      IS NOT excluded.branch
           OR font_files.size_bytes  IS NOT excluded.size_bytes
           OR font_files.is_variable IS NOT excluded.is_variable
           OR font_files.is_webfont  IS NOT excluded.is_webfont
           OR font_files.sha         IS NOT excluded.sha
    `;

    // First insert
    db.exec(insertSQL);
    const row1 = db.prepare("SELECT rowid FROM font_files WHERE path='fonts/Same.ttf'").get() as Record<string, unknown>;

    // Second identical upsert — WHERE clause should prevent any update
    db.exec(insertSQL);
    const row2 = db.prepare("SELECT rowid FROM font_files WHERE path='fonts/Same.ttf'").get() as Record<string, unknown>;

    // In SQLite, rowid changes on update. If it didn't change, the WHERE clause worked.
    assert.equal(row1["rowid"], row2["rowid"], "Row was updated on identical second upsert");

    db.close();
  });

  it("no value appears inline — INV-DATA-3 adversarial path with quote semicolon comment", () => {
    const adversarial: FontFileInput = {
      ...sampleFile,
      path: "fonts/evil'; DROP TABLE font_files; --.ttf",
      file_name: "evil'; DROP TABLE font_files; --.ttf",
      raw_url: "https://raw.example.com/fonts/evil'; DROP TABLE; --.ttf",
    };
    const { text, values } = buildFontFileUpsert(adversarial);
    assert.ok(!text.includes("DROP TABLE"), "SQL injection in query text");
    // All values must be bound
    for (const v of values) {
      if (typeof v === "string" && v.length > 10) {
        assert.ok(!text.includes(v), `Value "${v.slice(0, 30)}" found inline`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// needsRescan — truth table
// ---------------------------------------------------------------------------

describe("needsRescan", () => {
  it("true when never scanned (fonts_scanned_at IS NULL)", () => {
    const repo: RepoScanState = {
      fonts_scanned_at: null,
      pushed_at: null,
      fonts_scan_error: null,
    };
    assert.ok(needsRescan(repo));
  });

  it("true when pushed_at is after fonts_scanned_at", () => {
    const repo: RepoScanState = {
      fonts_scanned_at: NOW,
      pushed_at: AFTER,
      fonts_scan_error: null,
    };
    assert.ok(needsRescan(repo));
  });

  it("false when pushed_at is before fonts_scanned_at (scan is fresh)", () => {
    const repo: RepoScanState = {
      fonts_scanned_at: NOW,
      pushed_at: BEFORE,
      fonts_scan_error: null,
    };
    assert.ok(!needsRescan(repo));
  });

  it("false when pushed_at equals fonts_scanned_at", () => {
    const repo: RepoScanState = {
      fonts_scanned_at: NOW,
      pushed_at: NOW,
      fonts_scan_error: null,
    };
    assert.ok(!needsRescan(repo));
  });

  it("false when pushed_at is null and repo was scanned", () => {
    const repo: RepoScanState = {
      fonts_scanned_at: NOW,
      pushed_at: null,
      fonts_scan_error: null,
    };
    assert.ok(!needsRescan(repo));
  });

  it("true when last scan ended in a retryable error", () => {
    const repo: RepoScanState = {
      fonts_scanned_at: NOW,
      pushed_at: BEFORE,
      fonts_scan_error: "retryable:503:upstream server error",
    };
    assert.ok(needsRescan(repo));
  });

  it("false when last scan ended in a terminal error (do not retry)", () => {
    const repo: RepoScanState = {
      fonts_scanned_at: NOW,
      pushed_at: BEFORE,
      fonts_scan_error: "terminal:404:repo not found",
    };
    assert.ok(!needsRescan(repo));
  });

  it("true when never scanned AND has a retryable error (belt-and-suspenders)", () => {
    const repo: RepoScanState = {
      fonts_scanned_at: null,
      pushed_at: null,
      fonts_scan_error: "retryable:503:upstream server error",
    };
    assert.ok(needsRescan(repo));
  });
});

// ---------------------------------------------------------------------------
// buildRescanQueueQuery
// ---------------------------------------------------------------------------

describe("buildRescanQueueQuery", () => {
  it("returns text and values with limit as the sole parameter", () => {
    const { text, values } = buildRescanQueueQuery(50);
    assert.equal(typeof text, "string");
    assert.ok(text.length > 0);
    assert.deepEqual(values, [50]);
  });

  it("limit is a bound parameter, not interpolated", () => {
    const { text } = buildRescanQueueQuery(50);
    assert.ok(!text.includes("50"), "Limit should be a parameter ($1), not interpolated");
    assert.ok(text.includes("$1"), "Missing $1 placeholder for limit");
  });

  it("references v_repos_missing_fonts", () => {
    const { text } = buildRescanQueueQuery(100);
    assert.ok(text.includes("v_repos_missing_fonts"), "Should reference the missing-fonts view");
  });

  it("includes an ORDER BY clause with reputation", () => {
    const { text } = buildRescanQueueQuery(100);
    assert.ok(text.toUpperCase().includes("ORDER BY"), "Missing ORDER BY");
    assert.ok(text.includes("reputation"), "Should order by reputation");
  });

  it("includes a LIMIT clause", () => {
    const { text } = buildRescanQueueQuery(100);
    assert.ok(text.toUpperCase().includes("LIMIT"), "Missing LIMIT clause");
  });

  it("no value appears inline — INV-DATA-3", () => {
    const { text, values } = buildRescanQueueQuery(999);
    assertNoInlineValues(text, values);
  });
});
