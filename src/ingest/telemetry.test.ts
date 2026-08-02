/**
 * Pure offline unit tests for src/ingest/telemetry.ts.
 *
 * Rules:
 *  - No network. No database connections. Entirely offline.
 *  - Tests cover the pure functions: buildRunOpen, buildRunClose,
 *    buildHealthQuery, evaluateHealth, and formatHealth.
 *  - buildHealthQuery result is validated for SQL structure and self-containment.
 *  - evaluateHealth is the core logic under test — every status transition and
 *    every reason code must be exercised.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRunOpen,
  buildRunClose,
  buildHealthQuery,
  evaluateHealth,
  formatHealth,
  CRASHED_RUN_THRESHOLD_MINUTES,
  STALE_RUN_THRESHOLD_HOURS,
  ASSET_VERIFY_NON2XX_THRESHOLD,
  type HealthRow,
  type RunCounters,
} from "@/ingest/telemetry";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** A fully healthy HealthRow — all thresholds satisfied. */
function healthyRow(): HealthRow {
  return {
    last_run_id: "1",
    last_run_kind: "incremental",
    last_run_outcome: "completed",
    last_run_finished_at: new Date().toISOString(),
    mins_since_finished: 10, // well within STALE_RUN_THRESHOLD_HOURS * 60
    has_crashed_run: false,
    crashed_run_id: null,
    repos_scanned: 12617,
    repos_eligible: 12617,
    repos_with_scan_error: 0,
    verified_count: 1000,
    non2xx_count: 10, // 1% — below 5% threshold
    non2xx_rate: 0.01,
    retired_count: 0,
  };
}

const ZERO_COUNTERS: RunCounters = {
  repos_queued: 0,
  repos_scanned: 0,
  repos_failed: 0,
  files_added: 0,
  files_retired: 0,
  requests_spent: 0,
};

// ---------------------------------------------------------------------------
// buildRunOpen
// ---------------------------------------------------------------------------
describe("buildRunOpen", () => {
  it("returns a { text, values } object", () => {
    const stmt = buildRunOpen({ kind: "bulk" });
    assert.ok(typeof stmt.text === "string");
    assert.ok(Array.isArray(stmt.values));
  });

  it("inserts outcome='running'", () => {
    const stmt = buildRunOpen({ kind: "incremental" });
    assert.ok(
      stmt.text.includes("'running'"),
      "statement must insert outcome='running'",
    );
  });

  it("includes RETURNING id", () => {
    const stmt = buildRunOpen({ kind: "rescan" });
    assert.ok(
      stmt.text.toUpperCase().includes("RETURNING"),
      "must RETURNING id so caller can track the run",
    );
  });

  it("passes kind as the first parameter value", () => {
    for (const kind of ["bulk", "incremental", "rescan", "verify", "backfill"] as const) {
      const stmt = buildRunOpen({ kind });
      assert.equal(stmt.values[0], kind, `kind=${kind} not in values`);
    }
  });

  it("contains no semicolon (safe to compose)", () => {
    const stmt = buildRunOpen({ kind: "bulk" });
    assert.ok(!stmt.text.includes(";"));
  });

  it("contains no mutation other than INSERT on collection_runs", () => {
    const stmt = buildRunOpen({ kind: "bulk" });
    const upper = stmt.text.toUpperCase();
    assert.ok(upper.includes("INSERT INTO COLLECTION_RUNS"));
    assert.ok(!upper.includes("UPDATE"));
    assert.ok(!upper.includes("DELETE"));
    assert.ok(!upper.includes("DROP"));
  });
});

// ---------------------------------------------------------------------------
// buildRunClose
// ---------------------------------------------------------------------------
describe("buildRunClose", () => {
  it("returns a { text, values } object", () => {
    const stmt = buildRunClose({ id: "42", outcome: "completed", counters: ZERO_COUNTERS });
    assert.ok(typeof stmt.text === "string");
    assert.ok(Array.isArray(stmt.values));
  });

  it("passes id as first parameter, outcome as second", () => {
    const stmt = buildRunClose({ id: "99", outcome: "failed", counters: ZERO_COUNTERS });
    assert.equal(stmt.values[0], "99");
    assert.equal(stmt.values[1], "failed");
  });

  it("passes all six counters in column order", () => {
    const counters: RunCounters = {
      repos_queued: 100,
      repos_scanned: 95,
      repos_failed: 5,
      files_added: 200,
      files_retired: 3,
      requests_spent: 500,
    };
    const stmt = buildRunClose({ id: "1", outcome: "completed", counters });
    // values: [id, outcome, repos_queued, repos_scanned, repos_failed, files_added, files_retired, requests_spent]
    assert.equal(stmt.values[2], 100); // repos_queued
    assert.equal(stmt.values[3], 95);  // repos_scanned
    assert.equal(stmt.values[4], 5);   // repos_failed
    assert.equal(stmt.values[5], 200); // files_added
    assert.equal(stmt.values[6], 3);   // files_retired
    assert.equal(stmt.values[7], 500); // requests_spent
  });

  it("sets finished_at = now()", () => {
    const stmt = buildRunClose({ id: "1", outcome: "completed", counters: ZERO_COUNTERS });
    assert.ok(stmt.text.toLowerCase().includes("finished_at"));
    assert.ok(stmt.text.toLowerCase().includes("now()"));
  });

  it("is an UPDATE, not an INSERT", () => {
    const stmt = buildRunClose({ id: "1", outcome: "aborted", counters: ZERO_COUNTERS });
    assert.ok(stmt.text.toUpperCase().startsWith("UPDATE"));
  });

  it("contains no semicolon", () => {
    const stmt = buildRunClose({ id: "1", outcome: "completed", counters: ZERO_COUNTERS });
    assert.ok(!stmt.text.includes(";"));
  });

  it("accepts all three terminal outcomes", () => {
    for (const outcome of ["completed", "failed", "aborted"] as const) {
      const stmt = buildRunClose({ id: "1", outcome, counters: ZERO_COUNTERS });
      assert.equal(stmt.values[1], outcome);
    }
  });
});

// ---------------------------------------------------------------------------
// buildHealthQuery
// ---------------------------------------------------------------------------
describe("buildHealthQuery", () => {
  it("returns a { text, values } object with empty values (no parameters)", () => {
    const stmt = buildHealthQuery();
    assert.ok(typeof stmt.text === "string");
    assert.deepEqual(stmt.values, []);
  });

  it("contains no mutation keywords", () => {
    const stmt = buildHealthQuery();
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i;
    assert.ok(!forbidden.test(stmt.text), "health query must be read-only");
  });

  it("contains no semicolon", () => {
    const stmt = buildHealthQuery();
    assert.ok(!stmt.text.includes(";"));
  });

  it("references collection_runs, repos, and font_files", () => {
    const stmt = buildHealthQuery();
    assert.ok(stmt.text.includes("collection_runs"));
    assert.ok(stmt.text.includes("repos"));
    assert.ok(stmt.text.includes("font_files"));
  });

  it("embeds the crash threshold as a literal", () => {
    const stmt = buildHealthQuery();
    // The threshold must appear as a number literal in the SQL text
    assert.ok(
      stmt.text.includes(String(CRASHED_RUN_THRESHOLD_MINUTES)),
      "CRASHED_RUN_THRESHOLD_MINUTES must be embedded in health query text",
    );
  });

  it("selects the required column aliases", () => {
    const stmt = buildHealthQuery();
    const required = [
      "last_run_id",
      "last_run_outcome",
      "mins_since_finished",
      "has_crashed_run",
      "repos_scanned",
      "repos_eligible",
      "repos_with_scan_error",
      "verified_count",
      "non2xx_count",
      "non2xx_rate",
      "retired_count",
    ];
    for (const col of required) {
      assert.ok(
        stmt.text.includes(col),
        `health query must select column alias '${col}'`,
      );
    }
  });

  it("detects crashed runs via outcome='running' and age threshold", () => {
    const stmt = buildHealthQuery();
    assert.ok(stmt.text.includes("outcome = 'running'"));
    assert.ok(stmt.text.includes(String(CRASHED_RUN_THRESHOLD_MINUTES)));
  });
});

// ---------------------------------------------------------------------------
// evaluateHealth — status: healthy
// ---------------------------------------------------------------------------
describe("evaluateHealth — healthy", () => {
  it("returns healthy when all checks pass", () => {
    const ev = evaluateHealth(healthyRow());
    assert.equal(ev.status, "healthy");
    assert.deepEqual(ev.reasons, []);
  });

  it("healthy when verified_count=0 and non2xx_rate=null (no data yet)", () => {
    const row = healthyRow();
    row.verified_count = 0;
    row.non2xx_count = 0;
    row.non2xx_rate = null;
    const ev = evaluateHealth(row);
    // Should NOT flag HIGH_NON2XX_RATE when no verification data exists
    assert.ok(!ev.reasons.some((r) => r.code === "HIGH_NON2XX_RATE"));
  });
});

// ---------------------------------------------------------------------------
// evaluateHealth — status: crashed
// ---------------------------------------------------------------------------
describe("evaluateHealth — crashed", () => {
  it("returns crashed when has_crashed_run=true", () => {
    const row = healthyRow();
    row.has_crashed_run = true;
    row.crashed_run_id = "7";
    const ev = evaluateHealth(row);
    assert.equal(ev.status, "crashed");
    assert.ok(ev.reasons.some((r) => r.code === "CRASHED_RUN"));
  });

  it("CRASHED_RUN reason message includes the run id", () => {
    const row = healthyRow();
    row.has_crashed_run = true;
    row.crashed_run_id = "99";
    const ev = evaluateHealth(row);
    const reason = ev.reasons.find((r) => r.code === "CRASHED_RUN");
    assert.ok(reason?.message.includes("99"));
  });

  it("returns crashed when last run has NULL outcome (the 2026-07-28 scenario)", () => {
    const row = healthyRow();
    row.last_run_outcome = null;
    row.has_crashed_run = false; // outcome column did not exist yet
    const ev = evaluateHealth(row);
    assert.equal(ev.status, "crashed");
    assert.ok(ev.reasons.some((r) => r.code === "NULL_OUTCOME_RUN"));
  });

  it("crashed outranks stale", () => {
    const row = healthyRow();
    row.has_crashed_run = true;
    row.crashed_run_id = "3";
    row.mins_since_finished = STALE_RUN_THRESHOLD_HOURS * 60 + 1;
    const ev = evaluateHealth(row);
    assert.equal(ev.status, "crashed"); // crashed wins
  });
});

// ---------------------------------------------------------------------------
// evaluateHealth — status: stale
// ---------------------------------------------------------------------------
describe("evaluateHealth — stale", () => {
  it("returns stale when mins_since_finished exceeds threshold", () => {
    const row = healthyRow();
    row.mins_since_finished = STALE_RUN_THRESHOLD_HOURS * 60 + 1;
    const ev = evaluateHealth(row);
    assert.equal(ev.status, "stale");
    assert.ok(ev.reasons.some((r) => r.code === "STALE_RUN"));
  });

  it("returns stale when last run outcome is not 'completed'", () => {
    const row = healthyRow();
    row.last_run_outcome = "failed";
    row.mins_since_finished = 5; // recent but not completed
    const ev = evaluateHealth(row);
    assert.equal(ev.status, "stale");
    assert.ok(ev.reasons.some((r) => r.code === "STALE_RUN"));
  });

  it("returns stale when mins_since_finished is null (no run ever completed)", () => {
    const row = healthyRow();
    row.mins_since_finished = null;
    row.last_run_outcome = null;
    row.has_crashed_run = false;
    const ev = evaluateHealth(row);
    assert.ok(ev.reasons.some((r) => r.code === "STALE_RUN"));
  });

  it("passes freshness at exactly the threshold boundary", () => {
    const row = healthyRow();
    // exactly at threshold — still within window (strict >, not >=)
    row.mins_since_finished = STALE_RUN_THRESHOLD_HOURS * 60;
    const ev = evaluateHealth(row);
    assert.ok(!ev.reasons.some((r) => r.code === "STALE_RUN"));
  });

  it("stale reason message mentions the STALE_RUN_THRESHOLD_HOURS", () => {
    const row = healthyRow();
    row.mins_since_finished = STALE_RUN_THRESHOLD_HOURS * 60 + 10;
    const ev = evaluateHealth(row);
    const reason = ev.reasons.find((r) => r.code === "STALE_RUN");
    assert.ok(
      reason?.message.includes(String(STALE_RUN_THRESHOLD_HOURS)),
      "stale reason must mention the threshold",
    );
  });
});

// ---------------------------------------------------------------------------
// evaluateHealth — status: degraded
// ---------------------------------------------------------------------------
describe("evaluateHealth — degraded", () => {
  it("returns degraded when non2xx rate exceeds threshold", () => {
    const row = healthyRow();
    row.non2xx_count = 60;
    row.verified_count = 100;
    row.non2xx_rate = 0.6; // 60% — well above 5% threshold
    const ev = evaluateHealth(row);
    assert.equal(ev.status, "degraded");
    assert.ok(ev.reasons.some((r) => r.code === "HIGH_NON2XX_RATE"));
  });

  it("passes at exactly the threshold (threshold is exclusive)", () => {
    const row = healthyRow();
    row.non2xx_rate = ASSET_VERIFY_NON2XX_THRESHOLD; // 0.05 exactly
    const ev = evaluateHealth(row);
    assert.ok(!ev.reasons.some((r) => r.code === "HIGH_NON2XX_RATE"));
  });

  it("fails at threshold + epsilon", () => {
    const row = healthyRow();
    row.non2xx_rate = ASSET_VERIFY_NON2XX_THRESHOLD + 0.001;
    const ev = evaluateHealth(row);
    assert.ok(ev.reasons.some((r) => r.code === "HIGH_NON2XX_RATE"));
  });

  it("HIGH_NON2XX_RATE reason includes percentage and counts", () => {
    const row = healthyRow();
    row.non2xx_count = 100;
    row.verified_count = 500;
    row.non2xx_rate = 0.2; // 20%
    const ev = evaluateHealth(row);
    const reason = ev.reasons.find((r) => r.code === "HIGH_NON2XX_RATE");
    assert.ok(reason?.message.includes("100"), "reason must include non2xx_count");
    assert.ok(reason?.message.includes("500"), "reason must include verified_count");
  });
});

// ---------------------------------------------------------------------------
// evaluateHealth — the 2026-07-28 scenario (what made the outage invisible)
// ---------------------------------------------------------------------------
describe("evaluateHealth — 2026-07-28 scenario", () => {
  it("detects the exact conditions that made the pipeline outage invisible", () => {
    // The actual live state: one run, outcome=NULL, finished 5718 minutes ago,
    // no crashed_run (outcome='running' was never written), no completed run ever.
    const row: HealthRow = {
      last_run_id: "1",
      last_run_kind: null,
      last_run_outcome: null, // outcome column did not exist; NULL = crashed
      last_run_finished_at: "2026-07-29T01:32:08.619Z",
      mins_since_finished: 5718,
      has_crashed_run: false,  // outcome was never 'running' either
      crashed_run_id: null,
      repos_scanned: 165,
      repos_eligible: 12617,
      repos_with_scan_error: 0,
      verified_count: 0,
      non2xx_count: 0,
      non2xx_rate: null,
      retired_count: 0,
    };
    const ev = evaluateHealth(row);
    // Must not be healthy — this exact scenario was the silent failure
    assert.notEqual(ev.status, "healthy", "2026-07-28 state MUST NOT be healthy");
    // Must flag the null-outcome crash and the staleness
    assert.ok(ev.reasons.some((r) => r.code === "NULL_OUTCOME_RUN"), "must flag NULL_OUTCOME_RUN");
    assert.ok(ev.reasons.some((r) => r.code === "STALE_RUN"), "must flag STALE_RUN");
    // Crash outranks stale
    assert.equal(ev.status, "crashed");
  });
});

// ---------------------------------------------------------------------------
// formatHealth
// ---------------------------------------------------------------------------
describe("formatHealth", () => {
  it("includes the status word in the header", () => {
    const ev = evaluateHealth(healthyRow());
    const out = formatHealth(ev, healthyRow());
    assert.ok(out.includes("HEALTHY") || out.includes("healthy"));
  });

  it("shows CRASHED in header for crashed status", () => {
    const row = healthyRow();
    row.has_crashed_run = true;
    row.crashed_run_id = "5";
    const ev = evaluateHealth(row);
    const out = formatHealth(ev, row);
    assert.ok(out.includes("CRASHED") || out.includes("crashed"));
  });

  it("includes reason messages in output", () => {
    const row = healthyRow();
    row.has_crashed_run = true;
    row.crashed_run_id = "42";
    const ev = evaluateHealth(row);
    const out = formatHealth(ev, row);
    assert.ok(
      out.includes("CRASHED_RUN"),
      "formatHealth must include reason code CRASHED_RUN",
    );
  });

  it("includes coverage fraction", () => {
    const row = healthyRow();
    row.repos_scanned = 165;
    row.repos_eligible = 12617;
    const out = formatHealth(evaluateHealth(row), row);
    assert.ok(out.includes("165"));
    assert.ok(out.includes("12617"));
  });

  it("shows 'No issues found.' for healthy", () => {
    const ev = evaluateHealth(healthyRow());
    const out = formatHealth(ev, healthyRow());
    assert.ok(out.includes("No issues found."));
  });

  it("shows last_run_id in output", () => {
    const row = healthyRow();
    row.last_run_id = "999";
    const out = formatHealth(evaluateHealth(row), row);
    assert.ok(out.includes("999"));
  });

  it("handles null last_run_id gracefully (no runs yet)", () => {
    const row: HealthRow = {
      last_run_id: null,
      last_run_kind: null,
      last_run_outcome: null,
      last_run_finished_at: null,
      mins_since_finished: null,
      has_crashed_run: false,
      crashed_run_id: null,
      repos_scanned: 0,
      repos_eligible: 0,
      repos_with_scan_error: 0,
      verified_count: 0,
      non2xx_count: 0,
      non2xx_rate: null,
      retired_count: 0,
    };
    const ev = evaluateHealth(row);
    // Should not throw
    const out = formatHealth(ev, row);
    assert.ok(typeof out === "string");
    assert.ok(out.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Constants are exported and usable by the check registry
// ---------------------------------------------------------------------------
describe("exported constants", () => {
  it("CRASHED_RUN_THRESHOLD_MINUTES is a positive number", () => {
    assert.ok(
      typeof CRASHED_RUN_THRESHOLD_MINUTES === "number" &&
        CRASHED_RUN_THRESHOLD_MINUTES > 0,
    );
  });

  it("STALE_RUN_THRESHOLD_HOURS is a positive number", () => {
    assert.ok(
      typeof STALE_RUN_THRESHOLD_HOURS === "number" &&
        STALE_RUN_THRESHOLD_HOURS > 0,
    );
  });

  it("ASSET_VERIFY_NON2XX_THRESHOLD is between 0 and 1", () => {
    assert.ok(
      typeof ASSET_VERIFY_NON2XX_THRESHOLD === "number" &&
        ASSET_VERIFY_NON2XX_THRESHOLD > 0 &&
        ASSET_VERIFY_NON2XX_THRESHOLD < 1,
    );
  });
});
