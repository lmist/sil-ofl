/**
 * Run telemetry for the SIL OFL font catalog ingest pipeline.
 *
 * Builds parameterised SQL statements for opening and closing collection_runs
 * rows, a single health-query statement, and pure evaluation helpers.
 *
 * DESIGN:
 *  - No execution in this module. Every export returns { text, values } — the
 *    same shape used by @neondatabase/serverless's tagged-sql / .query() path.
 *  - The module imports nothing from the database layer, from other agents'
 *    in-flight modules, or from Node internals beyond what TypeScript resolves
 *    statically. It is side-effect-free.
 *
 * COUPLING NOTE (for orchestrator to reconcile at silofl-qiy merge):
 *  RunCounters below mirrors the counter shape that src/ingest/scan-worker.ts
 *  (landing in parallel — do not import) is expected to return. The field names
 *  match the collection_runs columns added in sql/002_ingest.sql:
 *    repos_queued / repos_scanned / repos_failed / files_added / files_retired /
 *    requests_spent
 *  If scan-worker renames or reorders its counter bag, update this type and
 *  every buildRunClose call site together.
 *
 * SCHEMA: collection_runs (from sql/002_ingest.sql)
 *   id              bigserial PRIMARY KEY
 *   started_at      timestamptz NOT NULL DEFAULT now()
 *   finished_at     timestamptz
 *   workers         int
 *   cap             int
 *   unique_count    int
 *   note            text
 *   kind            text   -- 'bulk' | 'incremental' | 'rescan' | 'verify' | 'backfill'
 *   outcome         text   -- 'running' | 'completed' | 'failed' | 'aborted'
 *   repos_queued    int
 *   repos_scanned   int
 *   repos_failed    int
 *   files_added     int
 *   files_retired   int
 *   requests_spent  int
 */

// ---------------------------------------------------------------------------
// Constants — thresholds for health evaluation
// ---------------------------------------------------------------------------

/**
 * A run that has been stuck in outcome='running' for longer than this many
 * minutes is classified as CRASHED, not running. The original one-shot run
 * lasted ~141 minutes; 240 minutes (4 h) gives headroom for a legitimate
 * large bulk run while still catching silent hangs.
 *
 * The 2026-07-28 run had outcome=NULL (crashed before schema existed).
 * Any new run stuck in 'running' past this threshold is the same problem.
 */
export const CRASHED_RUN_THRESHOLD_MINUTES = 240;

/**
 * A catalog is considered fresh if a successful run completed within this
 * many hours. Incremental runs are expected at least once per day; allow
 * 36 h to tolerate weekend gaps and one retry.
 *
 * Measured 2026-08-02: last completed run = null (no completed run ever).
 * The existing run has outcome=NULL. This check will correctly flag stale.
 */
export const STALE_RUN_THRESHOLD_HOURS = 36;

/**
 * Asset verification non-2xx rate above this fraction triggers a health
 * warning. 5% allows for transient CDN hiccups. The jsDelivr 403 problem
 * (27 oversize rows, ~0.08% of 35,509) would exceed this if verified.
 *
 * Measured 2026-08-02: verified_count = 0, so rate = 0 (no data).
 */
export const ASSET_VERIFY_NON2XX_THRESHOLD = 0.05; // 5 %

/**
 * Fraction of font_files rows with metadata_source='filename' above which
 * the pipeline is considered under-resolved. Once binary metadata is landed,
 * this should drop to near zero.
 *
 * Measured 2026-08-02: metadata_source = NULL for all 35,509 rows (pre-landing).
 * NULL rows are treated as 'filename' for threshold purposes — schema predates
 * the column so every row is effectively filename-inferred.
 */
export const METADATA_FILENAME_THRESHOLD = 0.8; // 80 % ceiling

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Accepted kind values for a collection run (mirrors sql/002_ingest.sql comment). */
export type RunKind =
  | "bulk"
  | "incremental"
  | "rescan"
  | "verify"
  | "backfill";

/** Terminal outcome values — a run opens as 'running' and closes as one of these. */
export type RunOutcome = "completed" | "failed" | "aborted";

/**
 * Counter bag returned by the scan worker (src/ingest/scan-worker.ts).
 * Structurally coupled — do not add or remove fields without updating
 * scan-worker.ts. See coupling note at top of file.
 */
export interface RunCounters {
  repos_queued: number;
  repos_scanned: number;
  repos_failed: number;
  files_added: number;
  files_retired: number;
  requests_spent: number;
}

/** Parameterised SQL statement — { text, values } pair for @neondatabase/serverless. */
export interface ParamStatement {
  text: string;
  values: unknown[];
}

/** Result row shape returned by buildHealthQuery(). */
export interface HealthRow {
  last_run_id: string | null;
  last_run_kind: string | null;
  last_run_outcome: string | null;
  last_run_finished_at: string | null;
  mins_since_finished: number | null;
  /** True when a row with outcome='running' has been open past the crash threshold. */
  has_crashed_run: boolean;
  crashed_run_id: string | null;
  /** Repos scanned / eligible (non-fork, non-archived, fontish with accepted licence). */
  repos_scanned: number;
  repos_eligible: number;
  /** Error-class breakdown for unresolved failures (fonts_scan_error). */
  repos_with_scan_error: number;
  /** Asset verification statistics. */
  verified_count: number;
  non2xx_count: number;
  non2xx_rate: number | null;
  /** Tombstone count. */
  retired_count: number;
}

/** Overall health status returned by evaluateHealth(). */
export type HealthStatus = "healthy" | "degraded" | "crashed" | "stale";

export interface HealthReason {
  code: string;
  message: string;
}

export interface HealthEvaluation {
  status: HealthStatus;
  reasons: HealthReason[];
}

// ---------------------------------------------------------------------------
// buildRunOpen
// ---------------------------------------------------------------------------

/**
 * Returns a parameterised INSERT statement that opens a new collection run
 * with outcome='running'. The caller must execute it and capture the returned
 * id to pass to buildRunClose.
 *
 * Usage:
 *   const stmt = buildRunOpen({ kind: 'incremental' });
 *   const [row] = await sql.query(stmt.text, stmt.values);
 *   const runId: string = row.id;
 */
export function buildRunOpen({ kind }: { kind: RunKind }): ParamStatement {
  return {
    text: `
INSERT INTO collection_runs (kind, outcome, started_at)
VALUES ($1, 'running', now())
RETURNING id
    `.trim(),
    values: [kind],
  };
}

// ---------------------------------------------------------------------------
// buildRunClose
// ---------------------------------------------------------------------------

/**
 * Returns a parameterised UPDATE statement that closes a collection run with
 * a terminal outcome and its counter bag. Must be called exactly once per run,
 * even on failure or abort — a run left in outcome='running' is indistinguishable
 * from a crash. Callers should wrap the entire run body in try/finally.
 *
 * Usage:
 *   const stmt = buildRunClose({
 *     id: runId,
 *     outcome: 'completed',
 *     counters: { repos_queued: 42, repos_scanned: 40, ... },
 *   });
 *   await sql.query(stmt.text, stmt.values);
 */
export function buildRunClose({
  id,
  outcome,
  counters,
}: {
  id: string;
  outcome: RunOutcome;
  counters: RunCounters;
}): ParamStatement {
  return {
    text: `
UPDATE collection_runs
SET
  outcome        = $2,
  finished_at    = now(),
  repos_queued   = $3,
  repos_scanned  = $4,
  repos_failed   = $5,
  files_added    = $6,
  files_retired  = $7,
  requests_spent = $8
WHERE id = $1
    `.trim(),
    values: [
      id,
      outcome,
      counters.repos_queued,
      counters.repos_scanned,
      counters.repos_failed,
      counters.files_added,
      counters.files_retired,
      counters.requests_spent,
    ],
  };
}

// ---------------------------------------------------------------------------
// buildHealthQuery
// ---------------------------------------------------------------------------

/**
 * Returns a single read-only SQL statement that answers "is ingest healthy?"
 * in one round-trip. The result is one row; pass it to evaluateHealth().
 *
 * Columns returned:
 *   last_run_id           — id of the most recent run (any outcome)
 *   last_run_kind         — kind of the most recent run
 *   last_run_outcome      — outcome of the most recent run (may be NULL = crashed)
 *   last_run_finished_at  — finished_at of the most recent run
 *   mins_since_finished   — minutes since the most recent run finished (NULL if never)
 *   has_crashed_run       — true when a 'running' row has been open > threshold
 *   crashed_run_id        — id of the crashed run (NULL if none)
 *   repos_scanned         — repos with fonts_scanned_at IS NOT NULL
 *   repos_eligible        — non-fork, non-archived, fontish, accepted-licence repos
 *   repos_with_scan_error — repos whose fonts_scan_error IS NOT NULL
 *   verified_count        — font_files rows with verified_at IS NOT NULL
 *   non2xx_count          — of those, rows with verify_status >= 300
 *   non2xx_rate           — non2xx_count / verified_count (NULL when verified=0)
 *   retired_count         — font_files rows with retired_at IS NOT NULL
 *
 * The crashed-run detection uses CRASHED_RUN_THRESHOLD_MINUTES embedded as a
 * literal so the query is self-contained. If the threshold changes, regenerate.
 *
 * IMPORTANT: this statement has no parameters and returns exactly one row.
 * It is safe to call on a read replica.
 */
export function buildHealthQuery(): ParamStatement {
  // Embed the threshold as a literal so the statement is self-contained.
  const crashedThresholdMinutes = CRASHED_RUN_THRESHOLD_MINUTES;

  const text = `
WITH
  last_run AS (
    SELECT
      id,
      kind,
      outcome,
      finished_at,
      EXTRACT(EPOCH FROM (now() - finished_at)) / 60 AS mins_since_finished
    FROM collection_runs
    ORDER BY started_at DESC
    LIMIT 1
  ),
  crashed_run AS (
    SELECT id
    FROM collection_runs
    WHERE outcome = 'running'
      AND EXTRACT(EPOCH FROM (now() - started_at)) / 60 > ${crashedThresholdMinutes}
    ORDER BY started_at DESC
    LIMIT 1
  ),
  coverage AS (
    SELECT
      COUNT(*) FILTER (WHERE fonts_scanned_at IS NOT NULL)                  AS repos_scanned,
      COUNT(*) FILTER (
        WHERE NOT is_fork
          AND NOT is_archived
          AND is_fontish
          AND license_spdx IN ('OFL-1.0', 'OFL-1.1')
      )                                                                      AS repos_eligible,
      COUNT(*) FILTER (WHERE fonts_scan_error IS NOT NULL)                  AS repos_with_scan_error
    FROM repos
  ),
  asset_health AS (
    SELECT
      COUNT(*) FILTER (WHERE verified_at IS NOT NULL)                       AS verified_count,
      COUNT(*) FILTER (WHERE verified_at IS NOT NULL AND verify_status >= 300) AS non2xx_count
    FROM font_files
  ),
  tombstones AS (
    SELECT COUNT(*) FILTER (WHERE retired_at IS NOT NULL)                   AS retired_count
    FROM font_files
  )
SELECT
  lr.id                                                                     AS last_run_id,
  lr.kind                                                                   AS last_run_kind,
  lr.outcome                                                                AS last_run_outcome,
  lr.finished_at                                                            AS last_run_finished_at,
  lr.mins_since_finished                                                    AS mins_since_finished,
  (cr.id IS NOT NULL)                                                       AS has_crashed_run,
  cr.id                                                                     AS crashed_run_id,
  c.repos_scanned,
  c.repos_eligible,
  c.repos_with_scan_error,
  a.verified_count,
  a.non2xx_count,
  CASE WHEN a.verified_count > 0
       THEN a.non2xx_count::numeric / a.verified_count::numeric
       ELSE NULL
  END                                                                       AS non2xx_rate,
  t.retired_count
FROM last_run lr
CROSS JOIN coverage c
CROSS JOIN asset_health a
CROSS JOIN tombstones t
LEFT JOIN crashed_run cr ON true
  `.trim();

  return { text, values: [] };
}

// ---------------------------------------------------------------------------
// evaluateHealth
// ---------------------------------------------------------------------------

/**
 * Pure function: given the single row returned by buildHealthQuery(), return
 * a structured health evaluation.
 *
 * Status ladder (worst wins):
 *   crashed  — a run is stuck in 'running' past CRASHED_RUN_THRESHOLD_MINUTES,
 *               or the last (and only) run has outcome=NULL (crashed before
 *               the outcome column existed).
 *   stale    — no completed run within STALE_RUN_THRESHOLD_HOURS.
 *   degraded — a run completed but asset verification non-2xx rate exceeds
 *               ASSET_VERIFY_NON2XX_THRESHOLD, or metadata is unresolved.
 *   healthy  — all checks pass.
 *
 * Every reason has a stable code for programmatic use and a human message.
 */
export function evaluateHealth(row: HealthRow): HealthEvaluation {
  const reasons: HealthReason[] = [];

  // 1. Crashed run — a run stuck in 'running' past the threshold.
  if (row.has_crashed_run) {
    reasons.push({
      code: "CRASHED_RUN",
      message: `Run ${row.crashed_run_id} has been in outcome='running' for more than ${CRASHED_RUN_THRESHOLD_MINUTES} minutes — it crashed without recording a terminal outcome.`,
    });
  }

  // 2. Last run has NULL outcome — pipeline crashed before outcome column existed,
  //    or the run finished_at exists but outcome was never written.
  //    This is the exact failure mode that made the 2026-07-28 outage invisible.
  if (
    row.last_run_id !== null &&
    row.last_run_outcome === null &&
    !row.has_crashed_run // already flagged above
  ) {
    reasons.push({
      code: "NULL_OUTCOME_RUN",
      message: `The most recent run (id=${row.last_run_id}) has no outcome recorded. It may have crashed before outcome='running' could be closed. Treat as crashed.`,
    });
  }

  // 3. Stale — no completed run within the threshold.
  const minsThreshold = STALE_RUN_THRESHOLD_HOURS * 60;
  const isStale =
    row.mins_since_finished === null ||
    row.last_run_outcome !== "completed" ||
    row.mins_since_finished > minsThreshold;

  if (isStale) {
    const age =
      row.mins_since_finished === null
        ? "never"
        : `${Math.round(row.mins_since_finished)} minutes ago`;
    reasons.push({
      code: "STALE_RUN",
      message: `No completed run found within ${STALE_RUN_THRESHOLD_HOURS}h. Last run finished ${age} with outcome=${row.last_run_outcome ?? "NULL"}.`,
    });
  }

  // 4. Asset non-2xx rate.
  if (
    row.non2xx_rate !== null &&
    row.non2xx_rate > ASSET_VERIFY_NON2XX_THRESHOLD
  ) {
    const pct = (row.non2xx_rate * 100).toFixed(1);
    const thPct = (ASSET_VERIFY_NON2XX_THRESHOLD * 100).toFixed(0);
    reasons.push({
      code: "HIGH_NON2XX_RATE",
      message: `Asset verification non-2xx rate is ${pct}% (threshold ${thPct}%). ${row.non2xx_count} of ${row.verified_count} verified rows returned non-2xx.`,
    });
  }

  // Determine overall status.
  const hasCrash = reasons.some(
    (r) => r.code === "CRASHED_RUN" || r.code === "NULL_OUTCOME_RUN",
  );
  const hasStale = reasons.some((r) => r.code === "STALE_RUN");
  const hasDegraded = reasons.some((r) => r.code === "HIGH_NON2XX_RATE");

  let status: HealthStatus;
  if (hasCrash) {
    status = "crashed";
  } else if (hasStale) {
    status = "stale";
  } else if (hasDegraded) {
    status = "degraded";
  } else {
    status = "healthy";
  }

  return { status, reasons };
}

// ---------------------------------------------------------------------------
// formatHealth
// ---------------------------------------------------------------------------

/**
 * Format a health evaluation for terminal output.
 * Includes the raw HealthRow numbers so an operator can read the query in one
 * pass without running additional SQL.
 */
export function formatHealth(
  evaluation: HealthEvaluation,
  row: HealthRow,
): string {
  const lines: string[] = [];
  const icon =
    evaluation.status === "healthy"
      ? "✓"
      : evaluation.status === "degraded"
        ? "⚠"
        : "✗";

  lines.push(`=== Ingest Health: ${icon} ${evaluation.status.toUpperCase()} ===`);
  lines.push("");

  // Last run summary.
  lines.push("Last run:");
  lines.push(`  id:       ${row.last_run_id ?? "none"}`);
  lines.push(`  kind:     ${row.last_run_kind ?? "null"}`);
  lines.push(`  outcome:  ${row.last_run_outcome ?? "NULL  ← crashed / missing"}`);
  lines.push(`  finished: ${row.last_run_finished_at ?? "null"}`);
  if (row.mins_since_finished !== null) {
    const h = Math.floor(row.mins_since_finished / 60);
    const m = Math.round(row.mins_since_finished % 60);
    lines.push(`  age:      ${h}h ${m}m`);
  } else {
    lines.push("  age:      unknown");
  }
  lines.push("");

  // Coverage.
  const covPct =
    row.repos_eligible > 0
      ? ((row.repos_scanned / row.repos_eligible) * 100).toFixed(1)
      : "n/a";
  lines.push(
    `Coverage:    ${row.repos_scanned} / ${row.repos_eligible} eligible repos scanned (${covPct}%)`,
  );
  lines.push(`Scan errors: ${row.repos_with_scan_error} repos with recorded errors`);
  lines.push("");

  // Asset health.
  const ratePct =
    row.non2xx_rate !== null
      ? `${(row.non2xx_rate * 100).toFixed(1)}%`
      : "n/a (none verified)";
  lines.push(
    `Assets:  ${row.verified_count} verified, ${row.non2xx_count} non-2xx (rate: ${ratePct})`,
  );
  lines.push(`Retired: ${row.retired_count} tombstoned rows`);
  lines.push("");

  // Reasons.
  if (evaluation.reasons.length === 0) {
    lines.push("No issues found.");
  } else {
    lines.push("Issues:");
    for (const r of evaluation.reasons) {
      lines.push(`  [${r.code}] ${r.message}`);
    }
  }

  return lines.join("\n");
}
