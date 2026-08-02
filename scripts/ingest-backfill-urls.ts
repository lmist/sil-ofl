#!/usr/bin/env bun
/**
 * ingest-backfill-urls.ts — beads silofl-qiy.9
 *
 * Rewrites all branch-pinned, space-containing, and non-ASCII URLs in
 * font_files to sha-pinned, correctly percent-encoded equivalents.
 *
 * Usage:
 *   bun --env-file=.env.local scripts/ingest-backfill-urls.ts             # dry-run (safe)
 *   bun --env-file=.env.local scripts/ingest-backfill-urls.ts --apply --limit 50
 *   bun --env-file=.env.local scripts/ingest-backfill-urls.ts --apply
 *   bun --env-file=.env.local scripts/ingest-backfill-urls.ts --rollback
 *
 * Flags:
 *   --dry-run   (default true) Print the plan without touching the database.
 *   --apply     Write to the database. Requires backup → verify → rewrite sequence.
 *   --limit N   Process at most N rows. Useful for smoke-testing.
 *   --rollback  Restore all rows from font_files_url_backup (no --limit).
 *
 * Safety invariant: this script NEVER overwrites font_files_url_backup rows
 * that already exist (ON CONFLICT DO NOTHING), so the genuine originals are
 * safe even if the script is re-run after a partial rewrite.
 */

import { neon } from "@neondatabase/serverless";
import {
  planRowRewrite,
  buildBackupStatement,
  buildRewriteStatement,
  buildRollbackStatement,
  type BackfillRow,
  type RowPlan,
  type RowPlanFailure,
} from "../src/ingest/url-backfill.js";

// ── CLI parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const DRY_RUN = !APPLY && !ROLLBACK;
const LIMIT_IDX = args.indexOf("--limit");
const LIMIT: number | null =
  LIMIT_IDX !== -1 ? parseInt(args[LIMIT_IDX + 1]!, 10) : null;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Run: bun --env-file=.env.local scripts/ingest-backfill-urls.ts",
  );
  process.exit(1);
}
const sql = neon(DATABASE_URL);

// ── Batch size for DB writes ─────────────────────────────────────────────────
const BATCH_SIZE = 500;

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[backfill] ${msg}`);
}

function logSection(title: string): void {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// ── Rollback path ─────────────────────────────────────────────────────────────

async function runRollback(): Promise<void> {
  logSection("ROLLBACK — restore originals from font_files_url_backup");

  const countResult = await sql`SELECT COUNT(*) AS n FROM font_files_url_backup`;
  const backupCount = Number((countResult[0] as { n: string }).n);

  if (backupCount === 0) {
    log("font_files_url_backup is empty — nothing to roll back.");
    return;
  }
  log(`Backup table contains ${backupCount} rows.`);

  const stmt = buildRollbackStatement();
  // Rollback statement has no parameters — safe to use as tagged template
  await sql`
    UPDATE font_files AS ff
    SET
      cdn_url         = b.cdn_url,
      raw_url         = b.raw_url,
      delivery        = NULL,
      delivery_reason = NULL
    FROM font_files_url_backup b
    WHERE ff.id = b.font_file_id
  `;
  void stmt; // stmt is available for reference/documentation; execution above is equivalent
  log(`Rollback complete. ${backupCount} rows restored from backup.`);
}

// ── Main backfill path ────────────────────────────────────────────────────────

async function runBackfill(): Promise<void> {
  logSection(DRY_RUN ? "DRY RUN (no writes)" : `APPLY (writing to database)`);

  // ── Step 0: Fetch rows in scope ──────────────────────────────────────────
  log("Fetching rows from font_files…");

  let rows: BackfillRow[];
  if (LIMIT !== null) {
    rows = (await sql.query(
      `SELECT id, cdn_url, raw_url, sha, size_bytes, format
       FROM font_files
       WHERE retired_at IS NULL
       ORDER BY id
       LIMIT $1`,
      [String(LIMIT)],
    )) as unknown as BackfillRow[];
  } else {
    rows = (await sql`
      SELECT id, cdn_url, raw_url, sha, size_bytes, format
      FROM font_files
      WHERE retired_at IS NULL
      ORDER BY id
    `) as unknown as BackfillRow[];
  }

  log(`Fetched ${rows.length} rows${LIMIT !== null ? ` (limit ${LIMIT})` : " (all)"}.`);

  // ── Step 1: Plan all rewrites ────────────────────────────────────────────
  const plans: RowPlan[] = [];
  const failures: RowPlanFailure[] = [];
  let noChangeCount = 0;

  for (const row of rows) {
    const result = planRowRewrite(row);
    if (result.ok) {
      if (result.changes) {
        plans.push(result);
      } else {
        noChangeCount++;
      }
    } else {
      failures.push(result);
    }
  }

  log(`Plan: ${plans.length} rows to rewrite, ${noChangeCount} already correct, ${failures.length} cannot plan.`);

  // Report failures
  if (failures.length > 0) {
    console.log("\nRows that cannot be planned:");
    const grouped: Record<string, number> = {};
    for (const f of failures) {
      grouped[f.reason] = (grouped[f.reason] ?? 0) + 1;
    }
    for (const [reason, count] of Object.entries(grouped)) {
      console.log(`  ${reason}: ${count}`);
    }
    // Show first 5 examples
    for (const f of failures.slice(0, 5)) {
      console.log(`  Example: ${f.detail}`);
    }
  }

  if (DRY_RUN) {
    // Show a sample of the rewrite plan
    log("\nSample rewrites (dry-run):");
    for (const plan of plans.slice(0, 5)) {
      console.log(`  id=${plan.id}`);
      console.log(`    cdn → ${plan.newCdnUrl.slice(0, 100)}`);
      console.log(`    raw → ${plan.newRawUrl.slice(0, 100)}`);
      console.log(`    delivery=${plan.delivery} reason=${plan.delivery_reason ?? "null"}`);
    }
    log("\nRun with --apply to write changes.");
    return;
  }

  if (plans.length === 0) {
    log("No rows need rewriting. Exiting.");
    return;
  }

  // ── Step 1 (apply): Backup originals ────────────────────────────────────
  logSection("Step 1: Backup originals into font_files_url_backup");

  // Build backup rows from the plans (using the ORIGINAL cdn_url/raw_url)
  // We need to look up originals from the fetched rows.
  const planIdSet = new Set(plans.map((p) => String(p.id)));
  const backupRows = rows
    .filter((r) => planIdSet.has(String(r.id)))
    .map((r) => ({ id: r.id, cdn_url: r.cdn_url, raw_url: r.raw_url }));

  let backedUpTotal = 0;
  for (let i = 0; i < backupRows.length; i += BATCH_SIZE) {
    const batch = backupRows.slice(i, i + BATCH_SIZE);
    const stmt = buildBackupStatement(batch);
    await sql.query(stmt.text, stmt.values as unknown[]);
    backedUpTotal += batch.length;
    if (backupRows.length > BATCH_SIZE) {
      process.stdout.write(`\r  Backed up ${backedUpTotal}/${backupRows.length}…`);
    }
  }
  if (backupRows.length > BATCH_SIZE) process.stdout.write("\n");
  log(`Backed up ${backedUpTotal} rows.`);

  // ── Step 2: Verify backup count ──────────────────────────────────────────
  logSection("Step 2: Verify backup count");

  const idList = plans.map((p) => String(p.id));
  const backupCountResult = await sql.query(
    `SELECT COUNT(*) AS n FROM font_files_url_backup WHERE font_file_id = ANY($1::bigint[])`,
    [idList],
  );
  const backupCount = Number((backupCountResult[0] as { n: string }).n);

  log(`Expected ${plans.length} backup rows, found ${backupCount}.`);

  if (backupCount < plans.length) {
    log(
      `ERROR: Backup count (${backupCount}) < scope count (${plans.length}). ABORTING.`,
    );
    log("The backup table may have rows from a previous run that conflict.");
    log("Check font_files_url_backup for the affected IDs.");
    process.exit(1);
  }

  log("Backup verified. Proceeding to rewrite.");

  // ── Step 3: Rewrite cdn_url, raw_url, delivery, delivery_reason ──────────
  logSection("Step 3: Rewrite URLs");

  let rewrittenTotal = 0;
  for (let i = 0; i < plans.length; i += BATCH_SIZE) {
    const batch = plans.slice(i, i + BATCH_SIZE);
    const stmt = buildRewriteStatement(batch);
    await sql.query(stmt.text, stmt.values as unknown[]);
    rewrittenTotal += batch.length;
    if (plans.length > BATCH_SIZE) {
      process.stdout.write(`\r  Rewrote ${rewrittenTotal}/${plans.length}…`);
    }
  }
  if (plans.length > BATCH_SIZE) process.stdout.write("\n");
  log(`Rewrote ${rewrittenTotal} rows.`);

  // ── Step 4: Read back and report ─────────────────────────────────────────
  logSection("Step 4: Read-back verification");

  const verification = await sql`
    SELECT 
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE cdn_url LIKE '% %' OR raw_url LIKE '% %') AS still_has_space,
      COUNT(*) FILTER (WHERE cdn_url LIKE '%@main/%' OR cdn_url LIKE '%@master/%') AS still_branch_pinned,
      COUNT(*) FILTER (WHERE delivery IS NOT NULL) AS has_delivery
    FROM font_files
    WHERE retired_at IS NULL
  `;

  const v = verification[0] as {
    total: string;
    still_has_space: string;
    still_branch_pinned: string;
    has_delivery: string;
  };

  console.log("\nPost-backfill state (all rows, not just scope):");
  console.log(`  Total rows:            ${v.total}`);
  console.log(`  Still has raw space:   ${v.still_has_space}`);
  console.log(`  Still branch-pinned:   ${v.still_branch_pinned}`);
  console.log(`  Has delivery value:    ${v.has_delivery}`);
  console.log(`  Rows changed:          ${rewrittenTotal}`);
  console.log(`  Could not plan:        ${failures.length}`);

  logSection("Done");
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (ROLLBACK) {
  await runRollback();
} else {
  await runBackfill();
}
