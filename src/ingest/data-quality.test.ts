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

// ===========================================================================
// New checks — added session 2, beads silofl-qiy.19 (2026-08-02)
// ===========================================================================

// ---------------------------------------------------------------------------
// DQ-RUN-FRESHNESS
// ---------------------------------------------------------------------------
describe("DQ-RUN-FRESHNESS", () => {
  const check = getCheck("DQ-RUN-FRESHNESS");

  it("fails when no completed run exists (hours_since_completed = null)", () => {
    const outcome = check.evaluate({
      last_completed_at: null,
      hours_since_completed: null,
    });
    assert.equal(outcome.status, "fail");
  });

  it("fails when last completed run was 40h ago (beyond 36h threshold)", () => {
    const outcome = check.evaluate({
      last_completed_at: new Date(Date.now() - 40 * 3600 * 1000).toISOString(),
      hours_since_completed: 40,
    });
    assert.equal(outcome.status, "fail");
  });

  it("passes when last completed run was 10h ago", () => {
    const outcome = check.evaluate({
      last_completed_at: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
      hours_since_completed: 10,
    });
    assert.equal(outcome.status, "pass");
  });

  it("passes at exactly the threshold (boundary is exclusive)", () => {
    const outcome = check.evaluate({
      last_completed_at: new Date().toISOString(),
      hours_since_completed: 36,
    });
    assert.equal(outcome.status, "pass");
  });

  it("fails at threshold + 1 hour", () => {
    const outcome = check.evaluate({
      last_completed_at: new Date().toISOString(),
      hours_since_completed: 37,
    });
    assert.equal(outcome.status, "fail");
  });

  it("detail mentions 'no completed run' when last_completed_at is null", () => {
    const outcome = check.evaluate({
      last_completed_at: null,
      hours_since_completed: null,
    });
    assert.ok(
      outcome.detail.toLowerCase().includes("no completed") ||
        outcome.detail.toLowerCase().includes("never"),
      "detail must explain that no completed run exists",
    );
  });

  it("has no semicolon in SQL", () => {
    assert.ok(!check.sql.includes(";"));
  });

  it("SQL is read-only", () => {
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i;
    assert.ok(!forbidden.test(check.sql));
  });

  it("replicates the 2026-08-02 scenario: fails because last run has NULL outcome", () => {
    // Actual measured value: last run finished ~5718 min ago but outcome=NULL
    // The SQL selects only outcome='completed' rows, so hours_since_completed=null
    const outcome = check.evaluate({
      last_completed_at: null,
      hours_since_completed: null,
    });
    assert.equal(outcome.status, "fail");
  });
});

// ---------------------------------------------------------------------------
// DQ-RUN-CRASHED
// ---------------------------------------------------------------------------
describe("DQ-RUN-CRASHED", () => {
  const check = getCheck("DQ-RUN-CRASHED");

  it("passes when no runs are stuck in 'running' (measured: 0)", () => {
    const outcome = check.evaluate({ crashed_run_count: 0 });
    assert.equal(outcome.status, "pass");
    assert.equal(outcome.observed, 0);
  });

  it("fails when one run is stuck in 'running' past threshold", () => {
    const outcome = check.evaluate({ crashed_run_count: 1 });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, 1);
  });

  it("fails for any positive count", () => {
    for (const n of [1, 2, 10]) {
      const outcome = check.evaluate({ crashed_run_count: n });
      assert.equal(outcome.status, "fail", `should fail for crashed_run_count=${n}`);
    }
  });

  it("detail mentions the minute threshold", () => {
    const outcome = check.evaluate({ crashed_run_count: 0 });
    assert.ok(
      outcome.detail.includes("240") || outcome.detail.toLowerCase().includes("minute"),
      "detail must mention the crash threshold in minutes",
    );
  });

  it("SQL contains outcome = 'running'", () => {
    assert.ok(check.sql.includes("outcome = 'running'"));
  });

  it("SQL is read-only and has no semicolon", () => {
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i;
    assert.ok(!forbidden.test(check.sql));
    assert.ok(!check.sql.includes(";"));
  });

  it("SQL models crashed-run detection via bun:sqlite", () => {
    
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE collection_runs (
        id INTEGER PRIMARY KEY,
        outcome TEXT,
        started_at TEXT
      );
      -- A 'completed' run (not crashed)
      INSERT INTO collection_runs VALUES (1, 'completed', datetime('now', '-1 hour'));
      -- A 'running' run open for 5 hours (> 240 min threshold)
      INSERT INTO collection_runs VALUES (2, 'running', datetime('now', '-5 hours'));
      -- A 'running' run only open for 30 min (< threshold)
      INSERT INTO collection_runs VALUES (3, 'running', datetime('now', '-30 minutes'));
    `);
    const row = db.query<{ crashed_run_count: number }, []>(
      `SELECT COUNT(*) FILTER (
        WHERE outcome = 'running'
          AND (CAST((julianday('now') - julianday(started_at)) * 24 * 60 AS INTEGER)) > 240
       ) AS crashed_run_count
       FROM collection_runs`
    ).get();
    db.close();
    assert.ok(row);
    // Only run id=2 (5 hours = 300 min > 240) should be flagged
    const outcome = check.evaluate({ crashed_run_count: row.crashed_run_count });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, 1);
  });
});

// ---------------------------------------------------------------------------
// DQ-DELIVERY-CLASSIFIED
// ---------------------------------------------------------------------------
describe("DQ-DELIVERY-CLASSIFIED", () => {
  const check = getCheck("DQ-DELIVERY-CLASSIFIED");

  it("fails for measured 2026-08-02 value (35,503 null delivery)", () => {
    const outcome = check.evaluate({ null_delivery_count: 35503 });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, 35503);
  });

  it("passes when null_delivery_count = 0", () => {
    const outcome = check.evaluate({ null_delivery_count: 0 });
    assert.equal(outcome.status, "pass");
  });

  it("fails at count = 1", () => {
    const outcome = check.evaluate({ null_delivery_count: 1 });
    assert.equal(outcome.status, "fail");
  });

  it("SQL targets only non-retired renderable rows", () => {
    assert.ok(check.sql.includes("retired_at IS NULL"));
    assert.ok(check.sql.includes("delivery IS NULL"));
    assert.ok(
      check.sql.includes("'ttf'") && check.sql.includes("'otf'"),
      "SQL must restrict to renderable formats",
    );
  });

  it("SQL is read-only and has no semicolon", () => {
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i;
    assert.ok(!forbidden.test(check.sql));
    assert.ok(!check.sql.includes(";"));
  });

  it("SQL models delivery null detection via bun:sqlite", () => {
    
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE font_files (
        id INTEGER PRIMARY KEY,
        retired_at TEXT,
        format TEXT,
        delivery TEXT
      );
      INSERT INTO font_files VALUES (1, NULL, 'ttf',  NULL);     -- renderable, no delivery
      INSERT INTO font_files VALUES (2, NULL, 'otf',  'cdn');    -- renderable, classified
      INSERT INTO font_files VALUES (3, '2026-08-01', 'ttf', NULL); -- retired, ignored
      INSERT INTO font_files VALUES (4, NULL, 'png',  NULL);     -- not renderable, ignored
    `);
    const row = db.query<{ null_delivery_count: number }, []>(
      `SELECT COUNT(*) FILTER (
         WHERE retired_at IS NULL
           AND format IN ('ttf', 'otf', 'woff', 'woff2')
           AND delivery IS NULL
       ) AS null_delivery_count
       FROM font_files`
    ).get();
    db.close();
    assert.ok(row);
    const outcome = check.evaluate({ null_delivery_count: row.null_delivery_count });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, 1); // only row 1
  });
});

// ---------------------------------------------------------------------------
// DQ-ASSET-VERIFIED
// ---------------------------------------------------------------------------
describe("DQ-ASSET-VERIFIED", () => {
  const check = getCheck("DQ-ASSET-VERIFIED");

  it("passes trivially when no rows are verified (measured: 0)", () => {
    const outcome = check.evaluate({
      verified_count: 0,
      non2xx_count: 0,
      non2xx_rate: 0,
    });
    assert.equal(outcome.status, "pass");
  });

  it("passes when non-2xx rate is 3% (below 5% threshold)", () => {
    const outcome = check.evaluate({
      verified_count: 1000,
      non2xx_count: 30,
      non2xx_rate: 0.03,
    });
    assert.equal(outcome.status, "pass");
  });

  it("fails when non-2xx rate is 10% (above threshold)", () => {
    const outcome = check.evaluate({
      verified_count: 1000,
      non2xx_count: 100,
      non2xx_rate: 0.1,
    });
    assert.equal(outcome.status, "fail");
  });

  it("passes at exactly threshold (boundary is exclusive)", () => {
    const outcome = check.evaluate({
      verified_count: 100,
      non2xx_count: 5,
      non2xx_rate: 0.05,
    });
    assert.equal(outcome.status, "pass");
  });

  it("fails just above threshold (0.051)", () => {
    const outcome = check.evaluate({
      verified_count: 1000,
      non2xx_count: 51,
      non2xx_rate: 0.051,
    });
    assert.equal(outcome.status, "fail");
  });

  it("detail mentions 'no data' when verified_count = 0", () => {
    const outcome = check.evaluate({
      verified_count: 0,
      non2xx_count: 0,
      non2xx_rate: 0,
    });
    assert.ok(
      outcome.detail.toLowerCase().includes("no rows") ||
        outcome.detail.toLowerCase().includes("verified_at is null") ||
        outcome.detail.toLowerCase().includes("trivially"),
      "detail must explain that no verification data exists",
    );
  });

  it("SQL is read-only and has no semicolon", () => {
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i;
    assert.ok(!forbidden.test(check.sql));
    assert.ok(!check.sql.includes(";"));
  });

  it("SQL targets only non-retired rows", () => {
    assert.ok(check.sql.includes("retired_at IS NULL"));
  });
});

// ---------------------------------------------------------------------------
// DQ-METADATA-PROVENANCE
// ---------------------------------------------------------------------------
describe("DQ-METADATA-PROVENANCE", () => {
  const check = getCheck("DQ-METADATA-PROVENANCE");

  it("fails for measured 2026-08-02 value: all 35,509 rows have NULL metadata_source (100% > 80% threshold)", () => {
    // When all rows have null metadata_source, filename_rate = 1.0
    const outcome = check.evaluate({
      total_live: 35509,
      filename_count: 35509,
      filename_rate: 1.0,
    });
    assert.equal(outcome.status, "fail");
  });

  it("passes when filename rate is 50% (below 80% threshold)", () => {
    const outcome = check.evaluate({
      total_live: 1000,
      filename_count: 500,
      filename_rate: 0.5,
    });
    assert.equal(outcome.status, "pass");
  });

  it("passes at exactly 80% (boundary is exclusive)", () => {
    const outcome = check.evaluate({
      total_live: 100,
      filename_count: 80,
      filename_rate: 0.8,
    });
    assert.equal(outcome.status, "pass");
  });

  it("fails at 81%", () => {
    const outcome = check.evaluate({
      total_live: 100,
      filename_count: 81,
      filename_rate: 0.81,
    });
    assert.equal(outcome.status, "fail");
  });

  it("SQL counts NULL metadata_source as filename provenance", () => {
    assert.ok(
      check.sql.includes("metadata_source IS NULL") &&
        check.sql.includes("metadata_source = 'filename'"),
      "SQL must treat NULL metadata_source same as filename",
    );
  });

  it("SQL is read-only and has no semicolon", () => {
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i;
    assert.ok(!forbidden.test(check.sql));
    assert.ok(!check.sql.includes(";"));
  });

  it("SQL models provenance detection via bun:sqlite", () => {
    
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE font_files (
        id INTEGER PRIMARY KEY,
        retired_at TEXT,
        metadata_source TEXT
      );
      INSERT INTO font_files VALUES (1, NULL, NULL);        -- filename (null)
      INSERT INTO font_files VALUES (2, NULL, 'filename');  -- filename explicit
      INSERT INTO font_files VALUES (3, NULL, 'binary');    -- binary (resolved)
      INSERT INTO font_files VALUES (4, '2026-08-01', NULL); -- retired, excluded
    `);
    const row = db.query<{ total_live: number; filename_count: number; filename_rate: number }, []>(
      `SELECT
         COUNT(*) FILTER (WHERE retired_at IS NULL) AS total_live,
         COUNT(*) FILTER (
           WHERE retired_at IS NULL
             AND (metadata_source IS NULL OR metadata_source = 'filename')
         ) AS filename_count,
         CASE WHEN COUNT(*) FILTER (WHERE retired_at IS NULL) > 0
              THEN CAST(COUNT(*) FILTER (
                     WHERE retired_at IS NULL
                       AND (metadata_source IS NULL OR metadata_source = 'filename')
                   ) AS REAL)
                   / CAST(COUNT(*) FILTER (WHERE retired_at IS NULL) AS REAL)
              ELSE 0
         END AS filename_rate
       FROM font_files`
    ).get();
    db.close();
    assert.ok(row);
    // 3 live rows, 2 filename/null (rows 1 and 2) — rate = 2/3 ≈ 67% < 80% → pass
    const outcome = check.evaluate({
      total_live: row.total_live,
      filename_count: row.filename_count,
      filename_rate: row.filename_rate,
    });
    assert.equal(outcome.status, "pass");
    assert.equal(row.total_live, 3);
    assert.equal(row.filename_count, 2);
  });
});

// ---------------------------------------------------------------------------
// DQ-RETIRED-EXCLUDED
// ---------------------------------------------------------------------------
describe("DQ-RETIRED-EXCLUDED", () => {
  const check = getCheck("DQ-RETIRED-EXCLUDED");

  it("passes when no retired rows exist (measured 2026-08-02: 0)", () => {
    const outcome = check.evaluate({ retired_visible_count: 0 });
    assert.equal(outcome.status, "pass");
  });

  it("fails when one retired row is publicly visible", () => {
    const outcome = check.evaluate({ retired_visible_count: 1 });
    assert.equal(outcome.status, "fail");
  });

  it("fails for any positive count", () => {
    for (const n of [1, 5, 100]) {
      const outcome = check.evaluate({ retired_visible_count: n });
      assert.equal(outcome.status, "fail", `should fail for retired_visible_count=${n}`);
    }
  });

  it("detail explains what to do to fix the violation", () => {
    const outcome = check.evaluate({ retired_visible_count: 2 });
    assert.ok(
      outcome.detail.toLowerCase().includes("retired") &&
        (outcome.detail.toLowerCase().includes("tombstone") ||
          outcome.detail.toLowerCase().includes("exclude")),
      "detail must explain the fix",
    );
  });

  it("SQL joins font_files with repos and applies public-font-policy clauses", () => {
    assert.ok(check.sql.includes("retired_at IS NOT NULL"));
    assert.ok(check.sql.includes("is_fontish"));
    assert.ok(check.sql.includes("OFL-1.0") && check.sql.includes("OFL-1.1"));
    assert.ok(
      check.sql.includes("'ttf'") && check.sql.includes("'woff2'"),
      "SQL must restrict to renderable formats",
    );
  });

  it("SQL is read-only and has no semicolon", () => {
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i;
    assert.ok(!forbidden.test(check.sql));
    assert.ok(!check.sql.includes(";"));
  });

  it("SQL models retired-visible detection via bun:sqlite", () => {
    
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE repos (
        id INTEGER PRIMARY KEY,
        is_fontish INTEGER,
        is_fork INTEGER,
        is_archived INTEGER,
        license_spdx TEXT
      );
      CREATE TABLE font_files (
        id INTEGER PRIMARY KEY,
        repo_id INTEGER,
        retired_at TEXT,
        format TEXT
      );
      -- A public OFL repo with one live and one retired renderable row
      INSERT INTO repos VALUES (1, 1, 0, 0, 'OFL-1.1');
      INSERT INTO font_files VALUES (1, 1, NULL,          'ttf'); -- live
      INSERT INTO font_files VALUES (2, 1, '2026-08-01',  'ttf'); -- retired but visible!
      -- A private repo (fork) — should not be counted even if retired
      INSERT INTO repos VALUES (2, 1, 1, 0, 'OFL-1.1');
      INSERT INTO font_files VALUES (3, 2, '2026-08-01', 'ttf');
    `);
    const row = db.query<{ retired_visible_count: number }, []>(
      `SELECT COUNT(*) FILTER (
         WHERE ff.retired_at IS NOT NULL
           AND r.is_fontish = 1
           AND r.is_fork = 0
           AND r.is_archived = 0
           AND r.license_spdx IN ('OFL-1.0', 'OFL-1.1')
           AND ff.format IN ('ttf', 'otf', 'woff', 'woff2')
       ) AS retired_visible_count
       FROM font_files ff
       JOIN repos r ON r.id = ff.repo_id`
    ).get();
    db.close();
    assert.ok(row);
    const outcome = check.evaluate({ retired_visible_count: row.retired_visible_count });
    // Only font_files row 2 is retired + in public OFL non-fork repo
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.observed, 1);
  });
});

// ---------------------------------------------------------------------------
// Registry integrity — re-check after new checks are added
// ---------------------------------------------------------------------------
describe("CHECKS registry integrity (post-session-2)", () => {
  it("registry now has 15 checks", () => {
    assert.equal(CHECKS.length, 15);
  });

  it("all new check ids are present", () => {
    const ids = new Set(CHECKS.map((c) => c.id));
    for (const id of [
      "DQ-RUN-FRESHNESS",
      "DQ-RUN-CRASHED",
      "DQ-DELIVERY-CLASSIFIED",
      "DQ-ASSET-VERIFIED",
      "DQ-METADATA-PROVENANCE",
      "DQ-RETIRED-EXCLUDED",
    ]) {
      assert.ok(ids.has(id), `Missing check: ${id}`);
    }
  });

  it("no duplicate check ids across old and new checks", () => {
    const ids = CHECKS.map((c) => c.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length);
  });

  it("all new checks have error severity", () => {
    const newCheckIds = [
      "DQ-RUN-FRESHNESS",
      "DQ-RUN-CRASHED",
      "DQ-DELIVERY-CLASSIFIED",
      "DQ-ASSET-VERIFIED",
      "DQ-METADATA-PROVENANCE",
      "DQ-RETIRED-EXCLUDED",
    ];
    for (const id of newCheckIds) {
      const check = CHECKS.find((c) => c.id === id);
      assert.ok(check, `Check ${id} not found`);
      assert.equal(check.severity, "error", `Check ${id} should be error severity`);
    }
  });
});
