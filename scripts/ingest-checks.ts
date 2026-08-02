/**
 * Live data-quality runner for the SIL OFL font catalog.
 *
 *   bun --env-file=.env.local scripts/ingest-checks.ts
 *   bun --env-file=.env.local scripts/ingest-checks.ts --json
 *
 * Read-only. Never writes. Safe to run against production.
 * Exits non-zero when any check with severity=error has status=fail.
 *
 * Uses @neondatabase/serverless (already a dependency).
 * SQL execution follows the same .query() pattern as scripts/ingest-audit.ts.
 */
import { neon } from "@neondatabase/serverless";
import {
  CHECKS,
  formatReport,
  summarise,
  type CheckResult,
} from "@/ingest/data-quality";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example -> .env.local.");
  process.exit(1);
}

const sql = neon(url);
const asJson = process.argv.includes("--json");

// Execute each check sequentially. Reads only — safe against production.
const results: CheckResult[] = [];
for (const check of CHECKS) {
  const rows = (await sql.query(check.sql)) as Record<string, unknown>[];
  const row = rows[0] ?? {};
  const outcome = check.evaluate(row);
  results.push({ check, outcome });
}

if (asJson) {
  const output = {
    results: results.map(({ check, outcome }) => ({
      id: check.id,
      title: check.title,
      severity: check.severity,
      status: outcome.status,
      observed: outcome.observed,
      threshold: outcome.threshold,
      detail: outcome.detail,
    })),
    summary: summarise(results),
  };
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(formatReport(results));
}

const summary = summarise(results);
if (!summary.ok) {
  process.exit(1);
}
