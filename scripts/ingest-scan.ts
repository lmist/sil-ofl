/**
 * scripts/ingest-scan.ts — font-scan runner
 *
 * Usage:
 *   bun --env-file=.env.local scripts/ingest-scan.ts [options]
 *
 * Flags:
 *   --limit <n>       Max repos to scan per run (default: 25)
 *   --apply           Actually write to the database (default: dry-run)
 *   --repo <name>     Scan a single repo by full_name (e.g. "owner/repo")
 *
 * Default is --dry-run. You must pass --apply to write.
 *
 * Examples:
 *   # Dry-run: shows what would happen, no writes
 *   bun --env-file=.env.local scripts/ingest-scan.ts
 *
 *   # Apply to 25 repos:
 *   bun --env-file=.env.local scripts/ingest-scan.ts --apply --limit 25
 *
 *   # Scan one specific repo:
 *   bun --env-file=.env.local scripts/ingest-scan.ts --apply --repo dharmatype/Sometype-Mono
 */

import { GitHubClient } from "@/ingest/github-client";
import { makeNeonExecutor, runScanBatch, scanRepo, type DbExecutor } from "@/ingest/scan-worker";
import { buildFontFileUpsert, needsRescan } from "@/ingest/upsert";
import {
  markObservationComplete,
  reconcileFiles,
  buildRetireQuery,
  buildLoadStoredFilesQuery,
  buildUnretireQuery,
} from "@/ingest/reconcile";
import { serialiseScanError, nextRetryDelayMs } from "@/ingest/scan-errors";
import {
  buildRunOpen,
  buildRunClose,
  type RunCounters,
} from "@/ingest/telemetry";
import type { FontFileInput } from "@/ingest/upsert";

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  limit: number;
  apply: boolean;
  repo: string | null;
} {
  let limit = 25;
  let apply = false;
  let repo: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--dry-run") {
      apply = false;
    } else if (arg === "--limit") {
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) {
        limit = parseInt(next, 10);
        i++;
      } else {
        console.error("--limit requires a positive integer");
        process.exit(1);
      }
    } else if (arg === "--repo") {
      const next = argv[i + 1];
      if (next && next.includes("/")) {
        repo = next;
        i++;
      } else {
        console.error("--repo requires a full_name like owner/repo");
        process.exit(1);
      }
    }
  }

  return { limit, apply, repo };
}

// ---------------------------------------------------------------------------
// Counter bridge
// ScanBatchSummary uses camelCase; RunCounters uses snake_case.
// Bridge here so telemetry.ts and scan-worker.ts stay decoupled.
// ---------------------------------------------------------------------------

function summaryToCounters(summary: {
  reposQueued: number;
  reposScanned: number;
  reposFailed: number;
  filesAdded: number;
  filesRetired: number;
  requestsSpent: number;
}): RunCounters {
  return {
    repos_queued: summary.reposQueued,
    repos_scanned: summary.reposScanned,
    repos_failed: summary.reposFailed,
    files_added: summary.filesAdded,
    files_retired: summary.filesRetired,
    requests_spent: summary.requestsSpent,
  };
}

// ---------------------------------------------------------------------------
// Single-repo mode
// ---------------------------------------------------------------------------

async function runSingleRepo(
  client: GitHubClient,
  db: DbExecutor,
  fullName: string,
  apply: boolean,
): Promise<void> {
  console.log(`\n── Single-repo scan: ${fullName} ──`);

  // Look up repo from database
  const repoResult = await db(
    "SELECT id, full_name, default_branch, fonts_scanned_at, pushed_at, fonts_scan_error, scan_attempts FROM repos WHERE full_name = $1",
    [fullName],
  );

  if (repoResult.rows.length === 0) {
    console.error(`  ✗ Repo not found in database: ${fullName}`);
    process.exit(1);
  }

  const row = repoResult.rows[0] as {
    id: string;
    full_name: string;
    default_branch: string | null;
    fonts_scanned_at: string | null;
    pushed_at: string | null;
    fonts_scan_error: string | null;
    scan_attempts: string | number;
  };

  const repoId = BigInt(row.id);
  const scanState = {
    fonts_scanned_at: row.fonts_scanned_at ? new Date(row.fonts_scanned_at) : null,
    pushed_at: row.pushed_at ? new Date(row.pushed_at) : null,
    fonts_scan_error: row.fonts_scan_error,
  };

  if (!needsRescan(scanState)) {
    console.log(`  ⊙ Skipping — does not need rescan`);
    console.log(`    fonts_scanned_at: ${scanState.fonts_scanned_at?.toISOString() ?? "never"}`);
    console.log(`    pushed_at:        ${scanState.pushed_at?.toISOString() ?? "unknown"}`);
    return;
  }

  const scanResult = await scanRepo(client, {
    id: repoId,
    full_name: fullName,
    default_branch: row.default_branch,
  });

  console.log(`  Requests spent: ${scanResult.requestsSpent}`);
  console.log(
    `  Rate limit remaining: ${scanResult.rateLimit.remaining ?? "unknown"}`,
  );

  if (!scanResult.ok) {
    console.log(`  ✗ Error: ${scanResult.error.cls} (${scanResult.error.code}): ${scanResult.error.detail}`);
    if (apply) {
      const errStr = serialiseScanError(scanResult.error);
      const attempts = Number(row.scan_attempts ?? 0) + 1;
      const delayMs = nextRetryDelayMs(attempts, scanResult.error);
      const nextScanAfter = delayMs !== null ? new Date(Date.now() + delayMs) : null;
      await db(
        `UPDATE repos SET fonts_scanned_at = $2, fonts_scan_error = $3, scan_attempts = $4, next_scan_after = $5 WHERE id = $1`,
        [repoId, new Date(), errStr, attempts, nextScanAfter],
      );
      console.log(`  ✓ Error checkpointed to DB`);
    }
    return;
  }

  const { fonts, commitSha } = scanResult;
  console.log(`  Commit sha:  ${commitSha}`);
  console.log(`  Font files:  ${fonts.length}`);

  // Show sample
  if (fonts.length > 0) {
    console.log(`  Sample cdn_url: ${fonts[0]!.cdn_url}`);
    console.log(`  (sha pinned: ${fonts[0]!.cdn_url.includes(commitSha) ? "YES ✓" : "NO ✗"})`);
  }

  if (!apply) {
    console.log(`  [dry-run] Would upsert ${fonts.length} font files — pass --apply to write`);
    return;
  }

  // Load stored for reconciliation
  const loadQuery = buildLoadStoredFilesQuery(repoId);
  const loadResult = await db(loadQuery.text, loadQuery.values);
  const storedFiles = (loadResult.rows as Array<{ id: string | bigint; path: string; retired_at: string | null }>).map((r) => ({
    id: BigInt(String(r.id)),
    path: r.path,
    retired_at: r.retired_at ? new Date(r.retired_at) : null,
  }));
  console.log(`  Stored rows: ${storedFiles.length}`);

  const observation = markObservationComplete(fonts);
  const { toUpsert, toRetire } = reconcileFiles({ observed: observation, stored: storedFiles });
  console.log(`  To upsert: ${toUpsert.length}  To retire: ${toRetire.length}`);

  // Write
  for (const file of toUpsert) {
    const upsertQuery = buildFontFileUpsert(file);
    await db(upsertQuery.text, upsertQuery.values);

    // Write delivery columns
    const extFile = file as FontFileInput & { _delivery?: string; _delivery_reason?: string | null };
    if (extFile._delivery) {
      await db(
        `UPDATE font_files SET delivery = $2, delivery_reason = $3 WHERE repo_id = $1 AND path = $4`,
        [file.repo_id, extFile._delivery, extFile._delivery_reason ?? null, file.path],
      );
    }

    // Un-retire if needed
    const wasRetired = storedFiles.find((s) => s.path === file.path && s.retired_at !== null);
    if (wasRetired) {
      const unretireQuery = buildUnretireQuery(wasRetired.id);
      await db(unretireQuery.text, unretireQuery.values);
    }
  }

  for (const row2 of toRetire) {
    const retireQuery = buildRetireQuery(row2.id);
    await db(retireQuery.text, retireQuery.values);
  }

  // Checkpoint
  await db(
    `UPDATE repos SET fonts_scanned_at = $2, fonts_scan_error = NULL, scan_attempts = 0, next_scan_after = NULL WHERE id = $1`,
    [repoId, new Date()],
  );

  console.log(`  ✓ Upserted ${toUpsert.length} files, retired ${toRetire.length}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  const githubToken = process.env.GITHUB_TOKEN;

  if (!databaseUrl) {
    console.error("DATABASE_URL not set. Run with: bun --env-file=.env.local scripts/ingest-scan.ts");
    process.exit(1);
  }

  if (!githubToken) {
    console.error("GITHUB_TOKEN not set.");
    process.exit(1);
  }

  const db = makeNeonExecutor(databaseUrl);
  const client = new GitHubClient({ token: githubToken });

  console.log(`SIL OFL Font Ingest`);
  console.log(`Mode:     ${args.apply ? "APPLY (writes to DB)" : "DRY-RUN (no writes)"}`);
  console.log(`Limit:    ${args.repo ? "N/A (single repo)" : args.limit}`);
  console.log(`Target:   ${args.repo ?? "queue (v_repos_missing_fonts)"}`);
  console.log();

  // Single-repo mode short-circuits the queue. Used to force a rescan of a
  // known-changed repository, which is how tombstone reconciliation is proven.
  if (args.repo) {
    await runSingleRepo(client, db, args.repo, args.apply);
    return;
  }

  if (args.repo) {
    // Single-repo mode: open a telemetry run, execute, close it.
    // We track minimal counters for this mode (single repo = 1 queued).
    let runId: string | null = null;
    let singleRepoFilesAdded = 0;
    let singleRepoFilesRetired = 0;
    let singleRepoRequestsSpent = 0;
    let singleRepoFailed = 0;

    if (args.apply) {
      const openStmt = buildRunOpen({ kind: "rescan" });
      const openResult = await db(openStmt.text, openStmt.values);
      const openRow = openResult.rows[0] as { id: string };
      runId = openRow.id;
      console.log(`  collection_runs id: ${runId} (outcome=running)`);
    }

    try {
      // Temporarily patch runSingleRepo to capture counters — we use a
      // lightweight wrapper rather than threading counters through the fn signature.
      const repoResult = await db(
        "SELECT id, full_name, default_branch, fonts_scanned_at, pushed_at, fonts_scan_error, scan_attempts FROM repos WHERE full_name = $1",
        [args.repo],
      );
      if (repoResult.rows.length === 0) {
        console.error(`  ✗ Repo not found in database: ${args.repo}`);
        singleRepoFailed = 1;
        process.exitCode = 1;
        return;
      }

      const row = repoResult.rows[0] as {
        id: string;
        full_name: string;
        default_branch: string | null;
        fonts_scanned_at: string | null;
        pushed_at: string | null;
        fonts_scan_error: string | null;
        scan_attempts: string | number;
      };
      const repoId = BigInt(row.id);
      const scanState = {
        fonts_scanned_at: row.fonts_scanned_at ? new Date(row.fonts_scanned_at) : null,
        pushed_at: row.pushed_at ? new Date(row.pushed_at) : null,
        fonts_scan_error: row.fonts_scan_error,
      };

      if (!needsRescan(scanState)) {
        console.log(`\n── Single-repo scan: ${args.repo} ──`);
        console.log(`  ⊙ Skipping — does not need rescan`);
        console.log(`    fonts_scanned_at: ${scanState.fonts_scanned_at?.toISOString() ?? "never"}`);
        console.log(`    pushed_at:        ${scanState.pushed_at?.toISOString() ?? "unknown"}`);
        console.log("\nDone.");
        return;
      }

      console.log(`\n── Single-repo scan: ${args.repo} ──`);
      const scanResult = await scanRepo(client, {
        id: repoId,
        full_name: args.repo,
        default_branch: row.default_branch,
      });

      singleRepoRequestsSpent = scanResult.requestsSpent;
      console.log(`  Requests spent: ${scanResult.requestsSpent}`);
      console.log(`  Rate limit remaining: ${scanResult.rateLimit.remaining ?? "unknown"}`);

      if (!scanResult.ok) {
        console.log(`  ✗ Error: ${scanResult.error.cls} (${scanResult.error.code}): ${scanResult.error.detail}`);
        singleRepoFailed = 1;
        if (args.apply) {
          const errStr = serialiseScanError(scanResult.error);
          const attempts = Number(row.scan_attempts ?? 0) + 1;
          const delayMs = nextRetryDelayMs(attempts, scanResult.error);
          const nextScanAfter = delayMs !== null ? new Date(Date.now() + delayMs) : null;
          await db(
            `UPDATE repos SET fonts_scanned_at = $2, fonts_scan_error = $3, scan_attempts = $4, next_scan_after = $5 WHERE id = $1`,
            [repoId, new Date(), errStr, attempts, nextScanAfter],
          );
          console.log(`  ✓ Error checkpointed to DB`);
        }
      } else {
        const { fonts, commitSha } = scanResult;
        console.log(`  Commit sha:  ${commitSha}`);
        console.log(`  Font files:  ${fonts.length}`);
        if (fonts.length > 0) {
          console.log(`  Sample cdn_url: ${fonts[0]!.cdn_url}`);
          console.log(`  (sha pinned: ${fonts[0]!.cdn_url.includes(commitSha) ? "YES ✓" : "NO ✗"})`);
        }

        if (!args.apply) {
          console.log(`  [dry-run] Would upsert ${fonts.length} font files — pass --apply to write`);
        } else {
          const loadQuery = buildLoadStoredFilesQuery(repoId);
          const loadResult = await db(loadQuery.text, loadQuery.values);
          const storedFiles = (loadResult.rows as Array<{ id: string | bigint; path: string; retired_at: string | null }>).map((r) => ({
            id: BigInt(String(r.id)),
            path: r.path,
            retired_at: r.retired_at ? new Date(r.retired_at) : null,
          }));
          console.log(`  Stored rows: ${storedFiles.length}`);

          const observation = markObservationComplete(fonts);
          const { toUpsert, toRetire } = reconcileFiles({ observed: observation, stored: storedFiles });
          console.log(`  To upsert: ${toUpsert.length}  To retire: ${toRetire.length}`);

          for (const file of toUpsert) {
            const upsertQuery = buildFontFileUpsert(file);
            await db(upsertQuery.text, upsertQuery.values);

            const extFile = file as FontFileInput & { _delivery?: string; _delivery_reason?: string | null };
            if (extFile._delivery) {
              await db(
                `UPDATE font_files SET delivery = $2, delivery_reason = $3 WHERE repo_id = $1 AND path = $4`,
                [file.repo_id, extFile._delivery, extFile._delivery_reason ?? null, file.path],
              );
            }

            const wasRetired = storedFiles.find((s) => s.path === file.path && s.retired_at !== null);
            if (wasRetired) {
              const unretireQuery = buildUnretireQuery(wasRetired.id);
              await db(unretireQuery.text, unretireQuery.values);
            }
          }

          for (const row2 of toRetire) {
            const retireQuery = buildRetireQuery(row2.id);
            await db(retireQuery.text, retireQuery.values);
          }

          await db(
            `UPDATE repos SET fonts_scanned_at = $2, fonts_scan_error = NULL, scan_attempts = 0, next_scan_after = NULL WHERE id = $1`,
            [repoId, new Date()],
          );

          singleRepoFilesAdded = toUpsert.length;
          singleRepoFilesRetired = toRetire.length;
          console.log(`  ✓ Upserted ${toUpsert.length} files, retired ${toRetire.length}`);
        }
      }
    } finally {
      if (args.apply && runId !== null) {
        const outcome = singleRepoFailed > 0 ? "failed" : "completed";
        const closeStmt = buildRunClose({
          id: runId,
          outcome,
          counters: {
            repos_queued: 1,
            repos_scanned: singleRepoFailed > 0 ? 0 : 1,
            repos_failed: singleRepoFailed,
            files_added: singleRepoFilesAdded,
            files_retired: singleRepoFilesRetired,
            requests_spent: singleRepoRequestsSpent,
          },
        });
        await db(closeStmt.text, closeStmt.values);
        console.log(`\n  collection_runs id=${runId} closed → outcome=${outcome}`);
      }
    }

    console.log("\nDone.");
    return;
  }

  // ---------------------------------------------------------------------------
  // Batch mode — open telemetry run before work, close in finally
  // ---------------------------------------------------------------------------
  let runId: string | null = null;

  if (args.apply) {
    const openStmt = buildRunOpen({ kind: "rescan" });
    const openResult = await db(openStmt.text, openStmt.values);
    const openRow = openResult.rows[0] as { id: string };
    runId = openRow.id;
    console.log(`collection_runs id: ${runId} opened (outcome=running)`);
    console.log();
  }

  let summary: Awaited<ReturnType<typeof runScanBatch>>;

  try {
    summary = await runScanBatch({
      client,
      db,
      limit: args.limit,
      dryRun: !args.apply,
    });
  } finally {
    // Close the run even if runScanBatch throws — leaves outcome='running'
    // only if this finally block itself throws (extremely unlikely).
    if (args.apply && runId !== null) {
      // summary may be undefined if runScanBatch threw before returning;
      // use zero counters in that case so we still get a closed row.
      const s = (typeof summary! !== "undefined") ? summary : {
        reposQueued: 0,
        reposScanned: 0,
        reposFailed: 0,
        filesAdded: 0,
        filesRetired: 0,
        requestsSpent: 0,
        outcome: "failed" as const,
      };
      const outcome =
        s.outcome === "completed" || s.outcome === "empty_queue" ? "completed" : "failed";
      // rate_limit_stop is a partial success — still record as completed
      // so health checks know a run finished (not crashed).
      const finalOutcome =
        s.outcome === "rate_limit_stop" ? "completed" : outcome;
      const closeStmt = buildRunClose({
        id: runId,
        outcome: finalOutcome,
        counters: summaryToCounters(s),
      });
      await db(closeStmt.text, closeStmt.values);
      console.log();
      console.log(`collection_runs id=${runId} closed → outcome=${finalOutcome}`);
    }
  }

  // Per-repo output
  for (const outcome of summary!.repos) {
    const icon =
      outcome.status === "success" ? "✓" :
      outcome.status === "skipped" ? "⊙" : "✗";
    let line = `  ${icon} ${outcome.fullName}`;
    if (outcome.status === "success") {
      line += ` (+${outcome.filesAdded} files, -${outcome.filesRetired} retired, ${outcome.requestsSpent} req)`;
    } else if (outcome.status === "error") {
      line += ` — ${outcome.error?.cls ?? "error"}: ${outcome.error?.detail ?? ""}`;
    } else {
      line += ` — skipped (no rescan needed)`;
    }
    console.log(line);
  }

  // Summary
  console.log();
  console.log("── Run Summary ──────────────────────────");
  console.log(`Outcome:       ${summary!.outcome}`);
  console.log(`Repos queued:  ${summary!.reposQueued}`);
  console.log(`Repos scanned: ${summary!.reposScanned}`);
  console.log(`Repos failed:  ${summary!.reposFailed}`);
  console.log(`Files added:   ${summary!.filesAdded}`);
  console.log(`Files retired: ${summary!.filesRetired}`);
  console.log(`Requests spent:${summary!.requestsSpent}`);
  if (summary!.rateLimit) {
    const resetDate = summary!.rateLimit.resetAt
      ? new Date(summary!.rateLimit.resetAt * 1000).toISOString()
      : "unknown";
    console.log(`Rate limit:    ${summary!.rateLimit.remaining ?? "?"} remaining (resets ${resetDate})`);

    if (summary!.outcome === "rate_limit_stop") {
      console.log();
      console.log("⚠  Rate limit reached. Re-run after the reset time.");
      if (summary!.rateLimit.resetAt) {
        const waitMs = summary!.rateLimit.resetAt * 1000 - Date.now();
        const waitMins = Math.ceil(waitMs / 60_000);
        console.log(`   Wait approximately ${waitMins} minutes.`);
      }
    }
  }
  console.log("─────────────────────────────────────────");

  if (!args.apply && summary!.outcome !== "empty_queue") {
    console.log();
    console.log("Dry-run complete. Pass --apply to write to the database.");
    console.log(`Example: bun --env-file=.env.local scripts/ingest-scan.ts --apply --limit ${args.limit}`);
  }
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
