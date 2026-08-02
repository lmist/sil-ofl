#!/usr/bin/env bun
/**
 * ingest-verify-assets.ts — beads silofl-qiy.10
 *
 * Verifies asset URLs with ranged HTTP requests and writes the results back
 * to font_files.verify_status and font_files.verified_at.
 *
 * Usage:
 *   bun --env-file=.env.local scripts/ingest-verify-assets.ts
 *   bun --env-file=.env.local scripts/ingest-verify-assets.ts --limit 500 --concurrency 8
 *   bun --env-file=.env.local scripts/ingest-verify-assets.ts --limit 500 --concurrency 8 --apply
 *
 * Flags:
 *   --limit N         Number of rows to verify. Default: 200.
 *   --concurrency N   Max concurrent requests (capped at 16). Default: 8.
 *   --apply           Write verify_status and verified_at to the database.
 *                     Without --apply, prints results but does not write.
 *
 * Row ordering: unverified rows (verified_at IS NULL) first; within that,
 * rows that have been rewritten (delivery IS NOT NULL) come before unclassified.
 * This ensures recently backfilled rows are checked first.
 *
 * Rate-limiting note: this tool makes real HTTP requests to cdn.jsdelivr.net.
 * Default concurrency (8) is deliberately conservative. Do not raise it above
 * 16 without checking with the CDN's usage policies.
 */

import { neon } from "@neondatabase/serverless";
import {
  verifySample,
  buildVerificationUpdate,
  summariseVerification,
  type VerifyRow,
  type MinimalFetch,
} from "../src/ingest/asset-verify.js";

// ── CLI parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]!, 10) : 200;

const concurrencyIdx = args.indexOf("--concurrency");
const CONCURRENCY =
  concurrencyIdx !== -1 ? parseInt(args[concurrencyIdx + 1]!, 10) : 8;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const sql = neon(DATABASE_URL);

function log(msg: string): void {
  console.log(`[verify] ${msg}`);
}

// ── Fetch rows ────────────────────────────────────────────────────────────────

log(
  `Starting verification: limit=${LIMIT}, concurrency=${CONCURRENCY}, apply=${APPLY}`,
);

// Prefer unverified rows, then rows where delivery is set (recently rewritten).
const rows = (await sql.query(
  `SELECT id, cdn_url, verified_at
   FROM font_files
   WHERE retired_at IS NULL
     AND (delivery IS NULL OR delivery != 'not_renderable')
   ORDER BY
     (verified_at IS NOT NULL),           -- unverified first (IS NULL = false = 0 = first)
     (delivery IS NULL),                  -- rows with delivery set before unclassified
     id
   LIMIT $1`,
  [String(LIMIT)],
)) as unknown as VerifyRow[];

log(`Fetched ${rows.length} rows to verify.`);

if (rows.length === 0) {
  log("No rows to verify.");
  process.exit(0);
}

// ── Run verification ──────────────────────────────────────────────────────────

// Cast global fetch to MinimalFetch — structurally compatible.
const fetchImpl: MinimalFetch = (url, init) => fetch(url as string, init);

log("Issuing ranged requests (Range: bytes=0-1)…");
const startTime = Date.now();

const results = await verifySample(fetchImpl, rows, {
  concurrency: CONCURRENCY,
  limit: LIMIT,
});

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
log(`Completed ${results.length} requests in ${elapsed}s.`);

// ── Summarise ─────────────────────────────────────────────────────────────────

const summary = summariseVerification(results);

console.log("\n── Verification Summary ──────────────────────────────────────");
console.log(`  Total checked:   ${summary.total}`);
console.log(`  Healthy (2xx):   ${summary.healthy}`);
console.log(`  Unhealthy:       ${summary.unhealthy}`);
console.log(
  `  Non-2xx rate:    ${(summary.non2xxRate * 100).toFixed(1)}%`,
);
console.log("\n  By status:");
const byStatusEntries = Object.entries(summary.byStatus).sort(
  ([a], [b]) => a.localeCompare(b),
);
for (const [status, count] of byStatusEntries) {
  console.log(`    ${status}: ${count}`);
}

// Show failures with URLs
const failures = results.filter((r) => !r.ok);
if (failures.length > 0) {
  console.log("\n  Sample failures:");
  for (const f of failures.slice(0, 10)) {
    console.log(
      `    id=${f.id} status=${f.status}${f.error ? ` error=${f.error}` : ""} url=${f.url.slice(0, 80)}`,
    );
  }
}

// ── Write back ────────────────────────────────────────────────────────────────

if (!APPLY) {
  log("\nDry run complete — add --apply to write results to database.");
  process.exit(0);
}

log("\nWriting verification results to font_files…");
let written = 0;
for (const result of results) {
  const stmt = buildVerificationUpdate(result.id, result.status);
  await sql.query(stmt.text, stmt.values as unknown[]);
  written++;
}
log(`Wrote ${written} verify_status rows.`);

// ── Read-back confirmation ────────────────────────────────────────────────────

const readback = await sql`
  SELECT
    COUNT(*) FILTER (WHERE verified_at IS NOT NULL) AS verified,
    COUNT(*) FILTER (WHERE verify_status = 206 OR verify_status = 200) AS healthy,
    COUNT(*) FILTER (WHERE verify_status IS NOT NULL AND verify_status != 206 AND verify_status != 200) AS unhealthy,
    COUNT(*) AS total
  FROM font_files
  WHERE retired_at IS NULL
`;

const rb = readback[0] as {
  verified: string;
  healthy: string;
  unhealthy: string;
  total: string;
};

console.log("\n── Database state after write ────────────────────────────────");
console.log(`  Total rows:    ${rb.total}`);
console.log(`  Verified:      ${rb.verified}`);
console.log(`  Healthy:       ${rb.healthy}`);
console.log(`  Unhealthy:     ${rb.unhealthy}`);
