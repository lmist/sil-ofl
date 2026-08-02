/**
 * Data-quality check registry for the SIL OFL font catalog ingest pipeline.
 *
 * Design:
 *  - Each check is self-contained: id, title, severity, rationale, sql, evaluate.
 *  - sql is a read-only statement with no dynamic interpolation. The runner
 *    supplies the database; this module imports no DB driver.
 *  - evaluate is a pure function from a query result row to a structured outcome.
 *  - Thresholds are named constants with a comment showing today's measured value
 *    so a future reader can track progress without diffing history.
 *
 * Measured 2026-08-02 against the live catalog database. Several checks fail
 * today by design — a check that passes on broken data is worthless.
 *
 * See docs/INGEST_RESILIENCE.md for the full audit narrative.
 */

// ---------------------------------------------------------------------------
// Threshold constants — TODAY'S measured value is noted next to each.
// The target is ≤ 0 (or the named limit) once the pipeline is fixed.
// ---------------------------------------------------------------------------

/** Measured: 1,909 cdn_url values contain a raw unencoded space. Target: 0. */
const THRESHOLD_RAW_SPACE_URLS = 0;

/** Measured: 8 cdn_url values contain non-ASCII characters. Target: 0. */
const THRESHOLD_NON_ASCII_URLS = 0;

/** Measured: 35,509 — every single row is branch-pinned, none sha-pinned. Target: 0. */
const THRESHOLD_NOT_SHA_PINNED = 0;

/** Measured: 27 renderable (ttf/otf/woff/woff2) rows exceed the jsDelivr 20 MiB limit. Target: 0. */
const THRESHOLD_OVERSIZE_RENDERABLE = 0;

/** Measured: 12,617 repos have never been font-scanned (fonts_scanned_at IS NULL). Target: 0. */
const THRESHOLD_NEVER_SCANNED = 0;

/** Measured: 1 font_files row has size_bytes = 0 (empty git blob). Target: 0. */
const THRESHOLD_ZERO_LENGTH = 0;

/**
 * Measured: 78 repos are fontish, non-fork, non-archived but have
 * NULL or NOASSERTION licence — plausible OFL fonts dropped on recall. Target: 0.
 */
const THRESHOLD_UNRESOLVED_LICENCE_CANDIDATES = 0;

/**
 * Measured: 1,030 rows share a SHA with at least one other row (503 groups).
 * Target: 0 (every binary blob should appear exactly once per repo path).
 */
const THRESHOLD_DUPLICATE_SHA_ROWS = 0;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Severity = "error" | "warning" | "info";

export type CheckStatus = "pass" | "fail";

export interface CheckOutcome {
  status: CheckStatus;
  /** The value actually observed from the database row. */
  observed: number | string;
  /** The acceptable threshold (upper bound unless noted otherwise). */
  threshold: number | string;
  /** Human-readable explanation of what was found. */
  detail: string;
}

export interface DataQualityCheck {
  /** Stable, greppable identifier. Never reuse a retired id. */
  id: string;
  /** Short human-readable title shown in terminal output. */
  title: string;
  /**
   * CI gate level.
   * error   — exit non-zero; blocks publication.
   * warning — logged but does not fail CI.
   * info    — informational only.
   */
  severity: Severity;
  /**
   * Why this check matters. Must explain the failure mode it prevents,
   * not just restate the title. Referenced by INV-INGEST-* invariants.
   */
  rationale: string;
  /**
   * Read-only SQL that returns exactly one row.
   * No dynamic interpolation. No user input. No statement separator (;).
   * The runner executes this and passes the result to evaluate().
   */
  sql: string;
  /**
   * Pure function from the query result row to a structured outcome.
   * Must have no side effects and no imports from DB drivers.
   */
  evaluate(row: Record<string, unknown>): CheckOutcome;
}

export interface CheckResult {
  check: DataQualityCheck;
  outcome: CheckOutcome;
}

export interface Summary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  warnings: number;
  /** true when every check with severity=error has status=pass */
  ok: boolean;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function num(row: Record<string, unknown>, key: string): number {
  const v = row[key];
  if (v === null || v === undefined) return 0;
  return Number(v);
}

// ---------------------------------------------------------------------------
// Check registry
// ---------------------------------------------------------------------------

export const CHECKS: readonly DataQualityCheck[] = [
  // -------------------------------------------------------------------------
  // DQ-URL-ENCODING — raw unencoded spaces in CDN URLs
  // -------------------------------------------------------------------------
  {
    id: "DQ-URL-ENCODING",
    title: "CDN URLs contain no raw spaces",
    severity: "error",
    rationale:
      "A URL with a literal space character is not a valid URL per RFC 3986 and " +
      "will be rejected by curl and most HTTP clients before the request is sent. " +
      "1,909 rows were measured with this defect on 2026-08-02. These files cannot " +
      "be served until the URL is percent-encoded. Prevents INV-INGEST-URL-VALIDITY.",
    sql:
      "SELECT COUNT(*) FILTER (WHERE cdn_url LIKE '% %')::int AS raw_space_count\n" +
      "FROM font_files",
    evaluate(row) {
      const observed = num(row, "raw_space_count");
      const threshold = THRESHOLD_RAW_SPACE_URLS;
      return {
        status: observed <= threshold ? "pass" : "fail",
        observed,
        threshold,
        detail:
          observed === 0
            ? "No CDN URLs contain unencoded spaces."
            : `${observed} CDN URL(s) contain a raw unencoded space and are not valid URLs.`,
      };
    },
  },

  // -------------------------------------------------------------------------
  // DQ-NON-ASCII — non-ASCII bytes in CDN URLs
  // -------------------------------------------------------------------------
  {
    id: "DQ-NON-ASCII",
    title: "CDN URLs contain only ASCII characters",
    severity: "error",
    rationale:
      "Non-ASCII bytes in a URL (en-dashes, colons stored as their literal UTF-8 " +
      "codepoints, etc.) cause HTTP 400 responses from jsDelivr. 8 such rows were " +
      "measured on 2026-08-02. Prevents INV-INGEST-URL-VALIDITY.",
    sql:
      "SELECT COUNT(*) FILTER (WHERE cdn_url ~ '[^\\x20-\\x7E]')::int AS non_ascii_count\n" +
      "FROM font_files",
    evaluate(row) {
      const observed = num(row, "non_ascii_count");
      const threshold = THRESHOLD_NON_ASCII_URLS;
      return {
        status: observed <= threshold ? "pass" : "fail",
        observed,
        threshold,
        detail:
          observed === 0
            ? "No CDN URLs contain non-ASCII characters."
            : `${observed} CDN URL(s) contain non-ASCII characters and will receive HTTP 400.`,
      };
    },
  },

  // -------------------------------------------------------------------------
  // DQ-SHA-PINNED — CDN URLs must reference a commit SHA, not a branch
  // -------------------------------------------------------------------------
  {
    id: "DQ-SHA-PINNED",
    title: "CDN URLs are pinned to a commit SHA",
    severity: "error",
    rationale:
      "Branch-pinned CDN URLs silently serve stale or rotted content when the " +
      "upstream repository restructures. All 35,509 rows are branch-pinned on " +
      "2026-08-02; one confirmed 404 was traced to a branch-pinned path that no " +
      "longer exists one month after load. Every font_files row has a populated " +
      "sha column that should be used instead. Prevents INV-INGEST-URL-VALIDITY.",
    sql:
      "SELECT COUNT(*) FILTER (WHERE cdn_url !~ '@[0-9a-f]{40}/')::int AS not_sha_pinned_count\n" +
      "FROM font_files",
    evaluate(row) {
      const observed = num(row, "not_sha_pinned_count");
      const threshold = THRESHOLD_NOT_SHA_PINNED;
      return {
        status: observed <= threshold ? "pass" : "fail",
        observed,
        threshold,
        detail:
          observed === 0
            ? "All CDN URLs are pinned to a commit SHA."
            : `${observed} CDN URL(s) are branch-pinned rather than SHA-pinned and may silently rot.`,
      };
    },
  },

  // -------------------------------------------------------------------------
  // DQ-CDN-SIZE — renderable files must not exceed the jsDelivr 20 MiB limit
  // -------------------------------------------------------------------------
  {
    id: "DQ-CDN-SIZE",
    title: "No renderable file exceeds the jsDelivr 20 MiB size limit",
    severity: "error",
    rationale:
      "jsDelivr returns HTTP 403 for any file over 20 MiB (20,971,520 bytes). " +
      "27 rows in renderable formats (ttf/otf/woff/woff2) exceed this limit as of " +
      "2026-08-02, with the largest at ~95 MiB. These rows are served to the public " +
      "catalog but cannot actually be loaded by any browser. " +
      "Prevents INV-INGEST-RENDERABLE-HEALTH.",
    sql:
      "SELECT COUNT(*) FILTER (WHERE size_bytes > 20971520)::int AS oversize_renderable_count\n" +
      "FROM font_files\n" +
      "WHERE format IN ('ttf', 'otf', 'woff', 'woff2')",
    evaluate(row) {
      const observed = num(row, "oversize_renderable_count");
      const threshold = THRESHOLD_OVERSIZE_RENDERABLE;
      return {
        status: observed <= threshold ? "pass" : "fail",
        observed,
        threshold,
        detail:
          observed === 0
            ? "All renderable font files are within the 20 MiB jsDelivr limit."
            : `${observed} renderable font file(s) exceed 20 MiB and will return HTTP 403 from jsDelivr.`,
      };
    },
  },

  // -------------------------------------------------------------------------
  // DQ-COVERAGE — unscanned repos must reach zero
  // -------------------------------------------------------------------------
  {
    id: "DQ-COVERAGE",
    title: "Scan coverage: repos with fonts_scanned_at IS NULL",
    severity: "error",
    rationale:
      "12,617 of 12,782 repos (98.7%) have never been font-scanned as of " +
      "2026-08-02. The catalog effectively covers only 140 repos. " +
      "This check counts unscanned repos; the target is 0. " +
      "Prevents INV-INGEST-COVERAGE.",
    sql:
      "SELECT COUNT(*) FILTER (WHERE fonts_scanned_at IS NULL)::int AS never_scanned_count\n" +
      "FROM repos",
    evaluate(row) {
      const observed = num(row, "never_scanned_count");
      const threshold = THRESHOLD_NEVER_SCANNED;
      return {
        status: observed <= threshold ? "pass" : "fail",
        observed,
        threshold,
        detail:
          observed === 0
            ? "All repos have been font-scanned."
            : `${observed} repo(s) have never been font-scanned (fonts_scanned_at IS NULL).`,
      };
    },
  },

  // -------------------------------------------------------------------------
  // DQ-FRESHNESS — freshness: repos pushed after their scan date
  // -------------------------------------------------------------------------
  {
    id: "DQ-FRESHNESS",
    title: "No scanned repos have upstream pushes after their scan date",
    severity: "warning",
    rationale:
      "A repo that was pushed after its last fonts_scanned_at timestamp may have " +
      "new, removed, or renamed font files that the catalog does not reflect. " +
      "Measured at 0 on 2026-08-02 (the single scan is so recent that no repos " +
      "have been pushed since). This will degrade as the repo ages without re-scanning. " +
      "Prevents INV-INGEST-FRESHNESS.",
    sql:
      "SELECT COUNT(*) FILTER (WHERE pushed_at > fonts_scanned_at)::int AS stale_after_push_count\n" +
      "FROM repos\n" +
      "WHERE fonts_scanned_at IS NOT NULL",
    evaluate(row) {
      // Today's baseline: 0. We tolerate up to 50 stale repos before warning
      // becomes an error; for now severity=warning to avoid noise while the
      // pipeline is being built.
      const FRESHNESS_THRESHOLD = 0; // measured 2026-08-02: 0
      const observed = num(row, "stale_after_push_count");
      const threshold = FRESHNESS_THRESHOLD;
      return {
        status: observed <= threshold ? "pass" : "fail",
        observed,
        threshold,
        detail:
          observed === 0
            ? "No scanned repos have been pushed upstream since their last scan."
            : `${observed} scanned repo(s) have upstream commits newer than their fonts_scanned_at timestamp.`,
      };
    },
  },

  // -------------------------------------------------------------------------
  // DQ-ZERO-LENGTH — no font_files row may have size_bytes = 0
  // -------------------------------------------------------------------------
  {
    id: "DQ-ZERO-LENGTH",
    title: "No font file has size_bytes = 0",
    severity: "warning",
    rationale:
      "A row with size_bytes = 0 signals an empty git blob " +
      "(SHA e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 is the well-known empty blob). " +
      "One such row was confirmed on 2026-08-02: undercasetype/Fraunces, " +
      "path 'documentation/proofs/200112/Document fonts/Fraunces_Italic-Light_OpMax_GoofyMin.otf'. " +
      "The CDN returns HTTP 200 for the percent-encoded URL but the file is " +
      "genuinely empty upstream — not a recording error. These rows should be " +
      "excluded from the catalog rather than served as renderable fonts. " +
      "Prevents INV-INGEST-RENDERABLE-HEALTH.",
    sql:
      "SELECT COUNT(*) FILTER (WHERE size_bytes = 0)::int AS zero_length_count\n" +
      "FROM font_files",
    evaluate(row) {
      const observed = num(row, "zero_length_count");
      const threshold = THRESHOLD_ZERO_LENGTH;
      return {
        status: observed <= threshold ? "pass" : "fail",
        observed,
        threshold,
        detail:
          observed === 0
            ? "No font files have size_bytes = 0."
            : `${observed} font file(s) have size_bytes = 0 (empty git blob); these are not renderable.`,
      };
    },
  },

  // -------------------------------------------------------------------------
  // DQ-LICENCE-EVIDENCE — plausible OFL repos must not be dropped on NULL licence
  // -------------------------------------------------------------------------
  {
    id: "DQ-LICENCE-EVIDENCE",
    title: "No fontish non-fork non-archived repos have unresolved licence",
    severity: "error",
    rationale:
      "78 repos are fontish, non-fork, non-archived but carry NULL or NOASSERTION " +
      "for license_spdx as of 2026-08-02. GitHub classifies OFL.txt as NOASSERTION " +
      "frequently; these repos are almost certainly OFL but are excluded from the " +
      "public catalog. Reading the licence text from the repo is the fix. " +
      "Prevents INV-INGEST-LICENCE-EVIDENCE.",
    sql:
      "SELECT COUNT(*) FILTER (\n" +
      "  WHERE (license_spdx IS NULL OR license_spdx = 'NOASSERTION')\n" +
      "    AND is_fontish\n" +
      "    AND NOT is_fork\n" +
      "    AND NOT is_archived\n" +
      ")::int AS unresolved_candidates_count\n" +
      "FROM repos",
    evaluate(row) {
      const observed = num(row, "unresolved_candidates_count");
      const threshold = THRESHOLD_UNRESOLVED_LICENCE_CANDIDATES;
      return {
        status: observed <= threshold ? "pass" : "fail",
        observed,
        threshold,
        detail:
          observed === 0
            ? "No fontish non-fork non-archived repos have unresolved licence."
            : `${observed} fontish non-fork non-archived repo(s) have NULL or NOASSERTION licence and are excluded from the catalog.`,
      };
    },
  },

  // -------------------------------------------------------------------------
  // DQ-DUPLICATE-SHA — no binary blob should appear in more than one row
  // -------------------------------------------------------------------------
  {
    id: "DQ-DUPLICATE-SHA",
    title: "No font binary appears in multiple rows (duplicate SHA check)",
    severity: "warning",
    rationale:
      "1,030 rows share a SHA with at least one other row (503 duplicate groups) " +
      "as of 2026-08-02. Duplicates bloat the catalog, inflate file counts, and " +
      "can cause the same font to appear multiple times in search results. " +
      "The UNIQUE(repo_id, path) constraint allows cross-repo duplicates; " +
      "SHA deduplication is a separate step. Prevents INV-INGEST-IDEMPOTENCY.",
    sql:
      "SELECT COALESCE(SUM(n), 0)::int AS duplicate_rows_count\n" +
      "FROM (\n" +
      "  SELECT COUNT(*) AS n\n" +
      "  FROM font_files\n" +
      "  WHERE sha IS NOT NULL\n" +
      "  GROUP BY sha\n" +
      "  HAVING COUNT(*) > 1\n" +
      ") t",
    evaluate(row) {
      const observed = num(row, "duplicate_rows_count");
      const threshold = THRESHOLD_DUPLICATE_SHA_ROWS;
      return {
        status: observed <= threshold ? "pass" : "fail",
        observed,
        threshold,
        detail:
          observed === 0
            ? "No duplicate SHA rows found."
            : `${observed} font_files row(s) share a SHA with at least one other row.`,
      };
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Summarise and format
// ---------------------------------------------------------------------------

/**
 * Summarise an array of check results into aggregate pass/fail counts.
 * ok is true only when every error-severity check passes.
 */
export function summarise(results: CheckResult[]): Summary {
  let passed = 0;
  let failed = 0;
  let errors = 0;
  let warnings = 0;

  for (const { check, outcome } of results) {
    if (outcome.status === "pass") {
      passed++;
    } else {
      failed++;
      if (check.severity === "error") errors++;
      if (check.severity === "warning") warnings++;
    }
  }

  return {
    total: results.length,
    passed,
    failed,
    errors,
    warnings,
    ok: errors === 0,
  };
}

/**
 * Format check results for terminal output.
 * Prints each check with pass/fail status and detail, then a summary line.
 */
export function formatReport(results: CheckResult[]): string {
  const lines: string[] = [];
  lines.push("=== SIL OFL Ingest Data-Quality Report ===");
  lines.push("");

  for (const { check, outcome } of results) {
    const icon = outcome.status === "pass" ? "✓" : "✗";
    const sev =
      check.severity === "error"
        ? "[ERROR]"
        : check.severity === "warning"
          ? "[WARN] "
          : "[INFO] ";
    lines.push(`${icon} ${sev} ${check.id.padEnd(24)} ${check.title}`);
    if (outcome.status === "fail") {
      lines.push(
        `       observed=${outcome.observed}  threshold=${outcome.threshold}`,
      );
      lines.push(`       ${outcome.detail}`);
    }
  }

  const summary = summarise(results);
  lines.push("");
  lines.push(
    `Summary: ${summary.passed}/${summary.total} passed` +
      (summary.errors > 0 ? `  — ${summary.errors} error(s)` : "") +
      (summary.warnings > 0 ? `  — ${summary.warnings} warning(s)` : "") +
      (summary.ok ? "  — OK" : "  — FAIL"),
  );

  return lines.join("\n");
}
