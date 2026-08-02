/**
 * Pure offline unit tests for the data-quality check registry.
 *
 * Rules:
 *  - No network. No database connections. Entirely offline.
 *  - Fixtures use the real measured values from 2026-08-02 so they serve as
 *    regression baselines.
 *  - bun:sqlite in-memory fixtures are used where a check's SQL semantics can
 *    be modelled locally (URL pattern checks, size checks).
 *  - Every test that calls evaluate() with the measured bad value asserts fail;
 *    with a clean value asserts pass; and boundary behaviour at each threshold.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Database } from "bun:sqlite";

import {
  CHECKS,
  summarise,
  formatReport,
  type CheckResult,
  type DataQualityCheck,
} from "@/ingest/data-quality";

// ---------------------------------------------------------------------------
// Measured values from 2026-08-02 (regression baseline)
// ---------------------------------------------------------------------------
const MEASURED = {
  raw_space_urls: 1909,
  non_ascii_urls: 8,
  not_sha_pinned: 35509,
  oversize_renderable: 27,
  never_scanned: 12617,
  stale_after_push: 0,
  zero_length: 1,
  unresolved_licence_candidates: 78,
  duplicate_sha_rows: 1030,
};

// ---------------------------------------------------------------------------
// Helper: find a check by id (throws if missing — catches typos)
// ---------------------------------------------------------------------------
function getCheck(id: string): DataQualityCheck {
  const check = CHECKS.find((c) => c.id === id);
  assert.ok(check, `No check with id "${id}" found in registry`);
  return check;
}

// ---------------------------------------------------------------------------
// Registry integrity
// ---------------------------------------------------------------------------
describe("CHECKS registry", () => {
  it("every check has a unique id", () => {
    const ids = CHECKS.map((c) => c.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, "Duplicate check id detected");
  });

  it("every check has a non-empty rationale", () => {
    for (const check of CHECKS) {
      assert.ok(
        check.rationale.trim().length > 0,
        `Check ${check.id} has empty rationale`,
      );
    }
  });

  it("every check has a threshold constant (validate that evaluate uses one)", () => {
    // A threshold must exist — we verify by calling evaluate with 0 and
    // confirming a structured outcome is returned (not thrown).
    for (const check of CHECKS) {
      const outcome = check.evaluate({ [Object.keys({ x: 0 })[0]!]: 0 });
      // outcome may or may not be pass; we just want no throw and a threshold
      assert.ok(
        outcome.threshold !== undefined && outcome.threshold !== null,
        `Check ${check.id} returned no threshold`,
      );
    }
  });

  it("every SQL string is read-only: no mutation keywords or statement separator", () => {
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i;
    for (const check of CHECKS) {
      assert.ok(
        !forbidden.test(check.sql),
        `Check ${check.id} SQL contains a mutation keyword`,
      );
      // No bare semicolon outside of a string literal context
      // (simple check: no ';' at all in the sql string body)
      assert.ok(
        !check.sql.includes(";"),
        `Check ${check.id} SQL contains a statement separator (;)`,
      );
    }
  });

  it("every check has a severity of error, warning, or info", () => {
    const valid = new Set(["error", "warning", "info"]);
    for (const check of CHECKS) {
      assert.ok(
        valid.has(check.severity),
        `Check ${check.id} has invalid severity "${check.severity}"`,
      );
    }
  });

  it("all expected check IDs are present", () => {
    const expected = [
      "DQ-URL-ENCODING",
      "DQ-NON-ASCII",
      "DQ-SHA-PINNED",
      "DQ-CDN-SIZE",
      "DQ-COVERAGE",
      "DQ-FRESHNESS",
      "DQ-ZERO-LENGTH",
      "DQ-LICENCE-EVIDENCE",
      "DQ-DUPLICATE-SHA",
    ];
    for (const id of expected) {
      assert.ok(
        CHECKS.some((c) => c.id === id),
        `Expected check id "${id}" is missing from registry`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// DQ-URL-ENCODING
// ---------------------------------------------------------------------------
describe("DQ-URL-ENCODING", () => {
  const check = getCheck("DQ-URL-ENCODING");

  it("fails for the 2026-08-02 measured value (1909 raw-space URLs)", () => {
    const outcome = check.evaluate({ raw_space_count: MEASURED.raw_space_urls });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, MEASURED.raw_space_urls);
    assert.equal(outcome.threshold, 0);
  });

  it("passes for zero raw-space URLs", () => {
    const outcome = check.evaluate({ raw_space_count: 0 });
    assert.equal(outcome.status, "pass");
  });

  it("fails at threshold + 1 (1 raw-space URL)", () => {
    const outcome = check.evaluate({ raw_space_count: 1 });
    assert.equal(outcome.status, "fail");
  });

  it("passes exactly at threshold (0)", () => {
    const outcome = check.evaluate({ raw_space_count: 0 });
    assert.equal(outcome.status, "pass");
  });

  it("SQL models raw-space detection correctly via bun:sqlite", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE font_files (id INTEGER PRIMARY KEY, cdn_url TEXT);
      INSERT INTO font_files VALUES (1, 'https://cdn.jsdelivr.net/gh/foo/bar@main/file.ttf');
      INSERT INTO font_files VALUES (2, 'https://cdn.jsdelivr.net/gh/foo/bar@main/my file.ttf');
      INSERT INTO font_files VALUES (3, 'https://cdn.jsdelivr.net/gh/foo/bar@main/another file.otf');
    `);
    // SQLite does not support FILTER; emulate the check's semantics with a WHERE clause
    const row = db
      .query<{ raw_space_count: number }, []>(
        "SELECT COUNT(*) AS raw_space_count FROM font_files WHERE cdn_url LIKE '% %'",
      )
      .get();
    db.close();
    assert.ok(row);
    const outcome = check.evaluate({ raw_space_count: row.raw_space_count });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, 2);
  });
});

// ---------------------------------------------------------------------------
// DQ-NON-ASCII
// ---------------------------------------------------------------------------
describe("DQ-NON-ASCII", () => {
  const check = getCheck("DQ-NON-ASCII");

  it("fails for the 2026-08-02 measured value (8 non-ASCII URLs)", () => {
    const outcome = check.evaluate({ non_ascii_count: MEASURED.non_ascii_urls });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, MEASURED.non_ascii_urls);
  });

  it("passes for zero non-ASCII URLs", () => {
    const outcome = check.evaluate({ non_ascii_count: 0 });
    assert.equal(outcome.status, "pass");
  });

  it("fails at threshold + 1 (1 non-ASCII URL)", () => {
    const outcome = check.evaluate({ non_ascii_count: 1 });
    assert.equal(outcome.status, "fail");
  });
});

// ---------------------------------------------------------------------------
// DQ-SHA-PINNED
// ---------------------------------------------------------------------------
describe("DQ-SHA-PINNED", () => {
  const check = getCheck("DQ-SHA-PINNED");

  it("fails for the 2026-08-02 measured value (35,509 not sha-pinned)", () => {
    const outcome = check.evaluate({ not_sha_pinned_count: MEASURED.not_sha_pinned });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, MEASURED.not_sha_pinned);
  });

  it("passes when all URLs are sha-pinned", () => {
    const outcome = check.evaluate({ not_sha_pinned_count: 0 });
    assert.equal(outcome.status, "pass");
  });

  it("fails at threshold + 1 (1 branch-pinned URL)", () => {
    const outcome = check.evaluate({ not_sha_pinned_count: 1 });
    assert.equal(outcome.status, "fail");
  });

  it("SQL models SHA pattern detection via bun:sqlite (GLOB approximation)", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE font_files (id INTEGER PRIMARY KEY, cdn_url TEXT);
      -- SHA-pinned: 40 lowercase hex chars after @, followed by /
      INSERT INTO font_files VALUES (1, 'https://cdn.jsdelivr.net/gh/foo/bar@a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2/file.ttf');
      -- Branch-pinned
      INSERT INTO font_files VALUES (2, 'https://cdn.jsdelivr.net/gh/foo/bar@main/file.ttf');
      INSERT INTO font_files VALUES (3, 'https://cdn.jsdelivr.net/gh/foo/bar@master/other.otf');
    `);
    // SQLite does not support PostgreSQL regex; GLOB with exactly 40 '?' approximates
    // the @[0-9a-f]{40}/ pattern. Branch names are shorter (typically 4-6 chars).
    // The GLOB '*@????????????????????????????????????????/*' matches exactly 40 chars.
    const SHA40_GLOB = '*@' + '?'.repeat(40) + '/*';
    const row = db
      .query<{ not_sha_pinned_count: number }, []>(
        `SELECT COUNT(*) AS not_sha_pinned_count FROM font_files
         WHERE cdn_url NOT GLOB '${SHA40_GLOB}'`,
      )
      .get();
    db.close();
    assert.ok(row);
    const outcome = check.evaluate({ not_sha_pinned_count: row.not_sha_pinned_count });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, 2);
  });
});

// ---------------------------------------------------------------------------
// DQ-CDN-SIZE
// ---------------------------------------------------------------------------
describe("DQ-CDN-SIZE", () => {
  const check = getCheck("DQ-CDN-SIZE");

  it("fails for the 2026-08-02 measured value (27 oversize renderable)", () => {
    const outcome = check.evaluate({ oversize_renderable_count: MEASURED.oversize_renderable });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, MEASURED.oversize_renderable);
  });

  it("passes when no renderable file exceeds 20 MiB", () => {
    const outcome = check.evaluate({ oversize_renderable_count: 0 });
    assert.equal(outcome.status, "pass");
  });

  it("fails at threshold + 1 (1 oversize renderable file)", () => {
    const outcome = check.evaluate({ oversize_renderable_count: 1 });
    assert.equal(outcome.status, "fail");
  });

  it("SQL models size filtering via bun:sqlite", () => {
    const LIMIT = 20971520; // 20 MiB
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE font_files (
        id INTEGER PRIMARY KEY,
        size_bytes INTEGER,
        format TEXT
      );
      INSERT INTO font_files VALUES (1, 1000000,  'ttf');
      INSERT INTO font_files VALUES (2, 21000000, 'otf');
      INSERT INTO font_files VALUES (3, 99000000, 'woff2');
      INSERT INTO font_files VALUES (4, 99000000, 'zip');  -- non-renderable, excluded
    `);
    const row = db
      .query<{ oversize_renderable_count: number }, [number]>(
        `SELECT COUNT(*) AS oversize_renderable_count
         FROM font_files
         WHERE format IN ('ttf','otf','woff','woff2')
           AND size_bytes > ?`,
      )
      .get(LIMIT);
    db.close();
    assert.ok(row);
    const outcome = check.evaluate({ oversize_renderable_count: row.oversize_renderable_count });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, 2);
  });
});

// ---------------------------------------------------------------------------
// DQ-COVERAGE
// ---------------------------------------------------------------------------
describe("DQ-COVERAGE", () => {
  const check = getCheck("DQ-COVERAGE");

  it("fails for the 2026-08-02 measured value (12,617 never scanned)", () => {
    const outcome = check.evaluate({ never_scanned_count: MEASURED.never_scanned });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, MEASURED.never_scanned);
  });

  it("passes when all repos have been scanned", () => {
    const outcome = check.evaluate({ never_scanned_count: 0 });
    assert.equal(outcome.status, "pass");
  });

  it("fails at threshold + 1 (1 unscanned repo)", () => {
    const outcome = check.evaluate({ never_scanned_count: 1 });
    assert.equal(outcome.status, "fail");
  });

  it("SQL models NULL scan date via bun:sqlite", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE repos (id INTEGER PRIMARY KEY, fonts_scanned_at TEXT);
      INSERT INTO repos VALUES (1, '2026-07-29T03:44:34Z');
      INSERT INTO repos VALUES (2, NULL);
      INSERT INTO repos VALUES (3, NULL);
    `);
    const row = db
      .query<{ never_scanned_count: number }, []>(
        "SELECT COUNT(*) AS never_scanned_count FROM repos WHERE fonts_scanned_at IS NULL",
      )
      .get();
    db.close();
    assert.ok(row);
    const outcome = check.evaluate({ never_scanned_count: row.never_scanned_count });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, 2);
  });
});

// ---------------------------------------------------------------------------
// DQ-FRESHNESS
// ---------------------------------------------------------------------------
describe("DQ-FRESHNESS", () => {
  const check = getCheck("DQ-FRESHNESS");

  it("passes for the 2026-08-02 measured value (0 stale repos)", () => {
    const outcome = check.evaluate({ stale_after_push_count: MEASURED.stale_after_push });
    assert.equal(outcome.status, "pass");
    assert.equal(outcome.observed, 0);
  });

  it("fails when repos have been pushed after scan", () => {
    const outcome = check.evaluate({ stale_after_push_count: 1 });
    assert.equal(outcome.status, "fail");
  });

  it("fails at threshold + 1 (1 stale repo)", () => {
    const outcome = check.evaluate({ stale_after_push_count: 1 });
    assert.equal(outcome.status, "fail");
  });
});

// ---------------------------------------------------------------------------
// DQ-ZERO-LENGTH
// ---------------------------------------------------------------------------
describe("DQ-ZERO-LENGTH", () => {
  const check = getCheck("DQ-ZERO-LENGTH");

  it("fails for the 2026-08-02 measured value (1 zero-length row)", () => {
    const outcome = check.evaluate({ zero_length_count: MEASURED.zero_length });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, MEASURED.zero_length);
  });

  it("passes when no files have size_bytes = 0", () => {
    const outcome = check.evaluate({ zero_length_count: 0 });
    assert.equal(outcome.status, "pass");
  });

  it("fails at threshold + 1 (1 zero-length file)", () => {
    const outcome = check.evaluate({ zero_length_count: 1 });
    assert.equal(outcome.status, "fail");
  });

  it("SQL models zero-length filter via bun:sqlite", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE font_files (id INTEGER PRIMARY KEY, size_bytes INTEGER);
      INSERT INTO font_files VALUES (1, 12345);
      INSERT INTO font_files VALUES (2, 0);
      INSERT INTO font_files VALUES (3, 67890);
    `);
    const row = db
      .query<{ zero_length_count: number }, []>(
        "SELECT COUNT(*) AS zero_length_count FROM font_files WHERE size_bytes = 0",
      )
      .get();
    db.close();
    assert.ok(row);
    const outcome = check.evaluate({ zero_length_count: row.zero_length_count });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, 1);
  });
});

// ---------------------------------------------------------------------------
// DQ-LICENCE-EVIDENCE
// ---------------------------------------------------------------------------
describe("DQ-LICENCE-EVIDENCE", () => {
  const check = getCheck("DQ-LICENCE-EVIDENCE");

  it("fails for the 2026-08-02 measured value (78 unresolved candidates)", () => {
    const outcome = check.evaluate({ unresolved_candidates_count: MEASURED.unresolved_licence_candidates });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, MEASURED.unresolved_licence_candidates);
  });

  it("passes when no fontish repos have unresolved licence", () => {
    const outcome = check.evaluate({ unresolved_candidates_count: 0 });
    assert.equal(outcome.status, "pass");
  });

  it("fails at threshold + 1 (1 unresolved candidate)", () => {
    const outcome = check.evaluate({ unresolved_candidates_count: 1 });
    assert.equal(outcome.status, "fail");
  });

  it("SQL models licence filtering via bun:sqlite", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE repos (
        id INTEGER PRIMARY KEY,
        license_spdx TEXT,
        is_fontish INTEGER,
        is_fork INTEGER,
        is_archived INTEGER
      );
      -- Unresolved candidate: should be counted
      INSERT INTO repos VALUES (1, NULL,          1, 0, 0);
      INSERT INTO repos VALUES (2, 'NOASSERTION', 1, 0, 0);
      -- Not a candidate: fork or archived
      INSERT INTO repos VALUES (3, NULL,          1, 1, 0);
      INSERT INTO repos VALUES (4, NULL,          1, 0, 1);
      -- Has a licence: fine
      INSERT INTO repos VALUES (5, 'OFL-1.1',    1, 0, 0);
      -- Not fontish: irrelevant
      INSERT INTO repos VALUES (6, NULL,          0, 0, 0);
    `);
    const row = db
      .query<{ unresolved_candidates_count: number }, []>(
        `SELECT COUNT(*) AS unresolved_candidates_count
         FROM repos
         WHERE (license_spdx IS NULL OR license_spdx = 'NOASSERTION')
           AND is_fontish = 1
           AND is_fork = 0
           AND is_archived = 0`,
      )
      .get();
    db.close();
    assert.ok(row);
    const outcome = check.evaluate({ unresolved_candidates_count: row.unresolved_candidates_count });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, 2);
  });
});

// ---------------------------------------------------------------------------
// DQ-DUPLICATE-SHA
// ---------------------------------------------------------------------------
describe("DQ-DUPLICATE-SHA", () => {
  const check = getCheck("DQ-DUPLICATE-SHA");

  it("fails for the 2026-08-02 measured value (1,030 duplicate rows)", () => {
    const outcome = check.evaluate({ duplicate_rows_count: MEASURED.duplicate_sha_rows });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, MEASURED.duplicate_sha_rows);
  });

  it("passes when there are no duplicate SHA rows", () => {
    const outcome = check.evaluate({ duplicate_rows_count: 0 });
    assert.equal(outcome.status, "pass");
  });

  it("fails at threshold + 1 (1 duplicate row)", () => {
    const outcome = check.evaluate({ duplicate_rows_count: 1 });
    assert.equal(outcome.status, "fail");
  });

  it("SQL models SHA deduplication via bun:sqlite", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE font_files (id INTEGER PRIMARY KEY, sha TEXT);
      INSERT INTO font_files VALUES (1, 'aabbcc');
      INSERT INTO font_files VALUES (2, 'aabbcc');  -- duplicate of row 1
      INSERT INTO font_files VALUES (3, 'aabbcc');  -- duplicate of row 1
      INSERT INTO font_files VALUES (4, 'ddeeff');  -- unique
      INSERT INTO font_files VALUES (5, NULL);      -- NULL sha is excluded
    `);
    const row = db
      .query<{ duplicate_rows_count: number }, []>(
        `SELECT COALESCE(SUM(n), 0) AS duplicate_rows_count
         FROM (
           SELECT COUNT(*) AS n
           FROM font_files
           WHERE sha IS NOT NULL
           GROUP BY sha
           HAVING COUNT(*) > 1
         ) t`,
      )
      .get();
    db.close();
    assert.ok(row);
    // 3 rows share sha 'aabbcc'
    const outcome = check.evaluate({ duplicate_rows_count: row.duplicate_rows_count });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, 3);
  });
});

// ---------------------------------------------------------------------------
// summarise()
// ---------------------------------------------------------------------------
describe("summarise()", () => {
  function makeResult(
    id: string,
    severity: "error" | "warning" | "info",
    status: "pass" | "fail",
  ): CheckResult {
    const check = CHECKS.find((c) => c.id === id) ?? {
      id,
      title: id,
      severity,
      rationale: "test",
      sql: "SELECT 1",
      evaluate: () => ({ status, observed: 0, threshold: 0, detail: "" }),
    };
    return {
      check: { ...check, severity },
      outcome: { status, observed: 0, threshold: 0, detail: "" },
    };
  }

  it("ok=true when no error-severity checks fail", () => {
    const results: CheckResult[] = [
      makeResult("DQ-URL-ENCODING", "error", "pass"),
      makeResult("DQ-ZERO-LENGTH", "warning", "fail"),
    ];
    const summary = summarise(results);
    assert.equal(summary.ok, true);
    assert.equal(summary.errors, 0);
    assert.equal(summary.warnings, 1);
    assert.equal(summary.passed, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.total, 2);
  });

  it("ok=false when any error-severity check fails", () => {
    const results: CheckResult[] = [
      makeResult("DQ-URL-ENCODING", "error", "fail"),
      makeResult("DQ-ZERO-LENGTH", "warning", "pass"),
    ];
    const summary = summarise(results);
    assert.equal(summary.ok, false);
    assert.equal(summary.errors, 1);
  });

  it("ok=true for empty results", () => {
    const summary = summarise([]);
    assert.equal(summary.ok, true);
    assert.equal(summary.total, 0);
  });

  it("counts all pass/fail/error/warning correctly", () => {
    const results: CheckResult[] = [
      makeResult("a", "error", "pass"),
      makeResult("b", "error", "fail"),
      makeResult("c", "warning", "fail"),
      makeResult("d", "info", "pass"),
    ];
    const summary = summarise(results);
    assert.equal(summary.total, 4);
    assert.equal(summary.passed, 2);
    assert.equal(summary.failed, 2);
    assert.equal(summary.errors, 1);
    assert.equal(summary.warnings, 1);
    assert.equal(summary.ok, false);
  });
});

// ---------------------------------------------------------------------------
// formatReport()
// ---------------------------------------------------------------------------
describe("formatReport()", () => {
  it("includes the report header", () => {
    const report = formatReport([]);
    assert.ok(report.includes("SIL OFL Ingest Data-Quality Report"));
  });

  it("shows ✓ for passing checks", () => {
    const check = getCheck("DQ-ZERO-LENGTH");
    const result: CheckResult = {
      check,
      outcome: { status: "pass", observed: 0, threshold: 0, detail: "" },
    };
    const report = formatReport([result]);
    assert.ok(report.includes("✓"));
    assert.ok(!report.includes("✗"));
  });

  it("shows ✗ and detail for failing checks", () => {
    const check = getCheck("DQ-ZERO-LENGTH");
    const result: CheckResult = {
      check,
      outcome: {
        status: "fail",
        observed: 1,
        threshold: 0,
        detail: "1 zero-length file",
      },
    };
    const report = formatReport([result]);
    assert.ok(report.includes("✗"));
    assert.ok(report.includes("1 zero-length file"));
  });

  it("includes FAIL in summary when errors exist", () => {
    const check = getCheck("DQ-URL-ENCODING");
    const result: CheckResult = {
      check,
      outcome: { status: "fail", observed: 1909, threshold: 0, detail: "bad" },
    };
    const report = formatReport([result]);
    assert.ok(report.includes("FAIL"));
  });

  it("includes OK in summary when no errors", () => {
    const check = getCheck("DQ-ZERO-LENGTH"); // severity=warning
    const result: CheckResult = {
      check,
      outcome: { status: "fail", observed: 1, threshold: 0, detail: "warn" },
    };
    const report = formatReport([result]);
    assert.ok(report.includes("OK"));
  });
});
