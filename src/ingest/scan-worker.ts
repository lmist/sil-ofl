/**
 * scan-worker.ts — beads silofl-qiy.1
 *
 * The resumable drain. `scanRepo` handles one repo; `runScanBatch` drains a
 * batch with per-repo checkpointing so an interrupted run loses one repo, not
 * a whole batch.
 *
 * Rate-limit contract:
 *  - Every GitHubClient call returns the current remaining budget.
 *  - If remaining drops to RATE_LIMIT_STOP_AT or below, the batch stops
 *    cleanly and reports `rate_limit_stop` in its summary.
 *  - The runner then waits until `rateLimit.resetAt` before re-queuing.
 *
 * Telemetry return shape is designed so the orchestrator's collection_runs
 * writer can consume it directly.
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { buildCdnUrl, buildRawUrl } from "@/ingest/asset-url";
import { classifyDelivery } from "@/ingest/cdn-policy";
import {
  serialiseScanError,
  nextRetryDelayMs,
  type ScanError,
} from "@/ingest/scan-errors";
import {
  buildFontFileUpsert,
  needsRescan,
  type FontFileInput,
  type RepoScanState,
} from "@/ingest/upsert";
import {
  markObservationComplete,
  reconcileFiles,
  buildRetireQuery,
  buildLoadStoredFilesQuery,
  type StoredFontFile,
} from "@/ingest/reconcile";
import {
  type GitHubClient,
  type RepoTreeResult,
} from "@/ingest/github-client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Stop the batch when remaining rate-limit budget falls to or below this value.
 * Leaves a safety buffer for other processes sharing the same token.
 */
const RATE_LIMIT_STOP_AT = 50;

/**
 * Font file formats that map to is_webfont=true.
 * woff and woff2 are web-native; ttf and otf load in browsers but are
 * technically desktop formats.
 */
const WEBFONT_FORMATS = new Set(["woff", "woff2"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Db executor type — accepts a query/values pair. */
export type DbExecutor = (query: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;

/**
 * A row returned by buildRescanQueueQuery.
 * Typed here so scan-worker.test.ts can build fixtures without importing
 * the full database layer.
 */
export interface QueueRow {
  id: string | number | bigint;
  full_name: string;
  default_branch: string | null;
  pushed_at: Date | string | null;
  fonts_scanned_at: Date | string | null;
  fonts_scan_error: string | null;
  reputation: number | string | null;
  stars: number | string | null;
  is_catalog_eligible: boolean;
}

/** Outcome for a single scanned repo. */
export interface RepoScanOutcome {
  repoId: bigint | number;
  fullName: string;
  /** "success" | "skipped" | "error" */
  status: "success" | "skipped" | "error";
  /** Number of new or updated font_files rows upserted. */
  filesAdded: number;
  /** Number of rows tombstoned (retired_at set). */
  filesRetired: number;
  /** GitHub API requests consumed by this repo. */
  requestsSpent: number;
  /** Classified error when status === "error". */
  error?: ScanError;
}

/** Telemetry summary returned by runScanBatch — consumed by collection_runs writer. */
export interface ScanBatchSummary {
  /** Number of repos the queue returned. */
  reposQueued: number;
  /** Number of repos successfully font-scanned. */
  reposScanned: number;
  /** Number of repos that returned a terminal or retryable error. */
  reposFailed: number;
  /** Cumulative files upserted across all repos. */
  filesAdded: number;
  /** Cumulative files retired across all repos. */
  filesRetired: number;
  /** Cumulative GitHub API requests spent. */
  requestsSpent: number;
  /**
   * "completed"  — all queued repos processed.
   * "rate_limit_stop" — batch stopped early because the budget ran out.
   * "empty_queue" — queue had no work.
   */
  outcome: "completed" | "rate_limit_stop" | "empty_queue";
  /** Rate-limit info from the last GitHub request, if any. */
  rateLimit: { remaining: number | null; resetAt: number | null } | null;
  /** Per-repo outcomes for logging/debugging. */
  repos: RepoScanOutcome[];
}

/** Options for runScanBatch. */
export interface ScanBatchOptions {
  client: GitHubClient;
  /** A raw query executor that runs { text, values } pairs. */
  db: DbExecutor;
  /** Maximum repos to dequeue. Default 25. */
  limit?: number;
  /**
   * When true, skip all writes — still fetches from GitHub, still classifies,
   * but does not touch the database.
   */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// scanRepo
// ---------------------------------------------------------------------------

/**
 * Scan one repo: resolve its HEAD sha, fetch its git tree, build asset URLs,
 * classify delivery.
 *
 * Returns either the observed font files (as FontFileInput rows ready for
 * upsert) or a classified ScanError.
 *
 * Does NOT write to the database — that is `runScanBatch`'s responsibility.
 */
export async function scanRepo(
  client: GitHubClient,
  repo: { id: bigint | number; full_name: string; default_branch: string | null },
): Promise<
  | { ok: true; fonts: FontFileInput[]; commitSha: string; requestsSpent: number; rateLimit: { remaining: number | null; resetAt: number | null } }
  | { ok: false; error: ScanError; requestsSpent: number; rateLimit: { remaining: number | null; resetAt: number | null } }
> {
  const [owner, repoName] = splitFullName(repo.full_name);
  if (!owner || !repoName) {
    return {
      ok: false,
      error: { cls: "terminal:not-found", code: "bad-name", detail: `malformed full_name: ${repo.full_name}` },
      requestsSpent: 0,
      rateLimit: { remaining: null, resetAt: null },
    };
  }

  const result: RepoTreeResult = await client.fetchRepoTree(owner, repoName, repo.default_branch);

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      requestsSpent: result.requestsSpent,
      rateLimit: {
        remaining: result.rateLimit.remaining,
        resetAt: result.rateLimit.resetAt,
      },
    };
  }

  const { commitSha, fonts: blobs, requestsSpent, rateLimit } = result.tree;

  // Build FontFileInput rows from tree blobs
  const now = new Date();
  const fontFiles: FontFileInput[] = blobs.map((blob) => {
    const ext = getExtension(blob.path);
    const format = ext.slice(1).toLowerCase(); // strip leading dot
    const fileName = getFileName(blob.path);

    const delivery = classifyDelivery({
      sizeBytes: blob.size,
      format,
    });

    // Asset URLs are pinned to the resolved commit sha, not the branch name.
    const cdn_url = buildCdnUrl({ owner, repo: repoName, ref: commitSha, path: blob.path });
    const raw_url = buildRawUrl({ owner, repo: repoName, ref: commitSha, path: blob.path });

    return {
      repo_id: repo.id,
      path: blob.path,
      file_name: fileName,
      format,
      raw_url,
      cdn_url,
      blob_url: null, // blob_url: not available from tree endpoint
      branch: repo.default_branch ?? "main",
      size_bytes: blob.size,
      family_guess: guessFamily(fileName),
      subfamily_guess: null,
      weight_guess: null,
      style_guess: null,
      is_variable: isVariablePath(blob.path),
      is_webfont: WEBFONT_FORMATS.has(format),
      sha: blob.sha,
      discovered_at: now,
      // delivery columns — passed through but not in FontFileInput contract;
      // scan-worker writes them separately via buildDeliveryUpdate
      _delivery: delivery.kind,
      _delivery_reason:
        delivery.kind !== "cdn"
          ? (delivery as { reason: string }).reason
          : null,
    } as FontFileInput & { _delivery: string; _delivery_reason: string | null };
  });

  return {
    ok: true,
    fonts: fontFiles,
    commitSha,
    requestsSpent,
    rateLimit: { remaining: rateLimit.remaining, resetAt: rateLimit.resetAt },
  };
}

// ---------------------------------------------------------------------------
// runScanBatch
// ---------------------------------------------------------------------------

/**
 * Drain a batch of repos from the scan queue.
 *
 * Per-repo checkpoint: writes scan outcome to the database after every repo
 * so an interrupted run resumes cleanly. Losing one repo is acceptable;
 * losing a batch is not.
 *
 * Returns a ScanBatchSummary shaped for direct hand-off to the collection_runs
 * writer (another agent's module — we emit, they persist).
 */
export async function runScanBatch({
  client,
  db,
  limit = 25,
  dryRun = false,
}: ScanBatchOptions): Promise<ScanBatchSummary> {
  const summary: ScanBatchSummary = {
    reposQueued: 0,
    reposScanned: 0,
    reposFailed: 0,
    filesAdded: 0,
    filesRetired: 0,
    requestsSpent: 0,
    outcome: "completed",
    rateLimit: null,
    repos: [],
  };

  // Fetch the queue.
  // Note: buildRescanQueueQuery from upsert.ts uses vmf.repo_id which does not
  // exist in v_repos_missing_fonts (the view has column 'id', not 'repo_id').
  // We use an equivalent inline query with the correct column name.
  const queueResult = await db(
    `SELECT
  r.id,
  r.full_name,
  r.default_branch,
  r.pushed_at,
  r.fonts_scanned_at,
  r.fonts_scan_error,
  r.reputation,
  r.stars,
  (vmf.id IS NOT NULL) AS is_catalog_eligible
FROM repos r
LEFT JOIN v_repos_missing_fonts vmf ON vmf.id = r.id
WHERE
  r.fonts_scanned_at IS NULL
  OR r.pushed_at > r.fonts_scanned_at
  OR (
    r.fonts_scan_error IS NOT NULL
    AND split_part(r.fonts_scan_error, ':', 1) = 'retryable'
  )
ORDER BY
  (vmf.id IS NOT NULL) DESC,
  r.reputation DESC,
  r.stars DESC,
  r.id ASC
LIMIT $1`,
    [limit],
  );
  const queue = queueResult.rows as QueueRow[];

  summary.reposQueued = queue.length;

  if (queue.length === 0) {
    summary.outcome = "empty_queue";
    return summary;
  }

  for (const row of queue) {
    const repoId = BigInt(String(row.id));
    const fullName = row.full_name;

    // Re-check needsRescan per row (queue may have been fetched ahead of time)
    const scanState: RepoScanState = {
      fonts_scanned_at: row.fonts_scanned_at ? new Date(row.fonts_scanned_at as string) : null,
      pushed_at: row.pushed_at ? new Date(row.pushed_at as string) : null,
      fonts_scan_error: row.fonts_scan_error,
    };

    if (!needsRescan(scanState)) {
      // Stale queue entry — skip without consuming rate limit
      const outcome: RepoScanOutcome = {
        repoId,
        fullName,
        status: "skipped",
        filesAdded: 0,
        filesRetired: 0,
        requestsSpent: 0,
      };
      summary.repos.push(outcome);
      continue;
    }

    // Check rate limit before each repo (budget may have depleted mid-batch)
    if (
      summary.rateLimit?.remaining !== null &&
      summary.rateLimit?.remaining !== undefined &&
      summary.rateLimit.remaining <= RATE_LIMIT_STOP_AT
    ) {
      summary.outcome = "rate_limit_stop";
      break;
    }

    // --- Scan GitHub ---
    const scanResult = await scanRepo(client, {
      id: repoId,
      full_name: fullName,
      default_branch: row.default_branch,
    });

    summary.requestsSpent += scanResult.requestsSpent;
    summary.rateLimit = scanResult.rateLimit;

    // Update rate-limit check for next iteration
    if (
      scanResult.rateLimit.remaining !== null &&
      scanResult.rateLimit.remaining <= RATE_LIMIT_STOP_AT
    ) {
      // Don't abort immediately — we still need to checkpoint this repo's outcome.
      // The check at the top of the loop will catch it next time.
    }

    if (!scanResult.ok) {
      // Scan failed — checkpoint the error
      const errStr = serialiseScanError(scanResult.error);
      const attempt = await getCurrentScanAttempts(db, repoId);
      const nextAttempt = attempt + 1;
      const delayMs = nextRetryDelayMs(nextAttempt, scanResult.error);
      const nextScanAfter = delayMs !== null ? new Date(Date.now() + delayMs) : null;

      if (!dryRun) {
        await writeScanOutcome(db, {
          repoId,
          fontsScannedAt: new Date(),
          fontsScanError: errStr,
          scanAttempts: nextAttempt,
          nextScanAfter,
        });
      }

      const outcome: RepoScanOutcome = {
        repoId,
        fullName,
        status: "error",
        filesAdded: 0,
        filesRetired: 0,
        requestsSpent: scanResult.requestsSpent,
        error: scanResult.error,
      };
      summary.repos.push(outcome);
      summary.reposFailed += 1;
      continue;
    }

    // --- Scan succeeded — reconcile + write ---
    const { fonts, commitSha } = scanResult;
    void commitSha; // sha is embedded in the URL; no separate storage needed

    // Load stored files for reconciliation
    let storedFiles: StoredFontFile[] = [];
    if (!dryRun) {
      const loadQuery = buildLoadStoredFilesQuery(repoId);
      const loadResult = await db(loadQuery.text, loadQuery.values);
      storedFiles = (loadResult.rows as Array<{ id: string | bigint; path: string; retired_at: string | null }>).map((r) => ({
        id: BigInt(String(r.id)),
        path: r.path,
        retired_at: r.retired_at ? new Date(r.retired_at) : null,
      }));
    }

    // Observation is complete — safe to retire
    const observation = markObservationComplete(fonts);
    const { toUpsert, toRetire } = reconcileFiles({ observed: observation, stored: storedFiles });

    let filesAdded = 0;
    let filesRetired = 0;

    if (!dryRun) {
      // Upsert observed files + un-retire reappeared ones
      for (const file of toUpsert) {
        const upsertQuery = buildFontFileUpsert(file);
        await db(upsertQuery.text, upsertQuery.values);

        // Check if this was a previously retired file and un-retire it
        const wasRetired = storedFiles.find((s) => s.path === file.path && s.retired_at !== null);
        if (wasRetired) {
          const { buildUnretireQuery } = await import("@/ingest/reconcile");
          const unretireQuery = buildUnretireQuery(wasRetired.id);
          await db(unretireQuery.text, unretireQuery.values);
        }

        // Write delivery columns (not in FontFileInput base contract)
        const extFile = file as FontFileInput & { _delivery?: string; _delivery_reason?: string | null };
        if (extFile._delivery) {
          await db(
            `UPDATE font_files SET delivery = $2, delivery_reason = $3
             WHERE repo_id = $1 AND path = $4`,
            [file.repo_id, extFile._delivery, extFile._delivery_reason ?? null, file.path],
          );
        }

        filesAdded += 1;
      }

      // Retire missing files
      for (const row of toRetire) {
        const retireQuery = buildRetireQuery(row.id);
        await db(retireQuery.text, retireQuery.values);
        filesRetired += 1;
      }

      // Checkpoint: write scan outcome per repo (not per batch)
      await writeScanOutcome(db, {
        repoId,
        fontsScannedAt: new Date(),
        fontsScanError: null,
        scanAttempts: 0,
        nextScanAfter: null,
      });
    } else {
      // Dry-run: count what would happen
      filesAdded = toUpsert.length;
      filesRetired = toRetire.length;
    }

    const outcome: RepoScanOutcome = {
      repoId,
      fullName,
      status: "success",
      filesAdded,
      filesRetired,
      requestsSpent: scanResult.requestsSpent,
    };
    summary.repos.push(outcome);
    summary.reposScanned += 1;
    summary.filesAdded += filesAdded;
    summary.filesRetired += filesRetired;

    // Post-repo rate-limit stop check
    if (
      scanResult.rateLimit.remaining !== null &&
      scanResult.rateLimit.remaining <= RATE_LIMIT_STOP_AT
    ) {
      summary.outcome = "rate_limit_stop";
      break;
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function splitFullName(fullName: string): [string | null, string | null] {
  const slash = fullName.indexOf("/");
  if (slash === -1) return [null, null];
  return [fullName.slice(0, slash), fullName.slice(slash + 1)];
}

function getExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return "";
  return path.slice(lastDot);
}

function getFileName(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

/**
 * Heuristic family name from the file name.
 * Strips weight/style suffixes and extension. Best-effort; the metadata
 * worker (silofl-qiy.12) will replace this with binary-extracted values.
 */
function guessFamily(fileName: string): string | null {
  // Strip extension
  const nameNoExt = fileName.replace(/\.[^.]+$/, "");
  if (!nameNoExt) return null;
  // Strip common weight/style suffixes (case-insensitive)
  const cleaned = nameNoExt
    .replace(/-?(Black|Bold|ExtraBold|ExtraLight|Heavy|Light|Medium|Regular|SemiBold|Thin|Italic|Oblique|Condensed|Expanded|Variable)+$/i, "")
    .replace(/[-_]$/, "")
    .trim();
  return cleaned || nameNoExt;
}

/** Return true if the path suggests a variable font. */
function isVariablePath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.includes("variable") || lower.includes("[");
}

async function getCurrentScanAttempts(
  db: DbExecutor,
  repoId: bigint | number,
): Promise<number> {
  const result = await db(
    "SELECT scan_attempts FROM repos WHERE id = $1",
    [repoId],
  );
  const row = result.rows[0] as { scan_attempts?: number | string } | undefined;
  if (!row) return 0;
  return Number(row.scan_attempts ?? 0);
}

interface ScanOutcomeWrite {
  repoId: bigint | number;
  fontsScannedAt: Date;
  fontsScanError: string | null;
  scanAttempts: number;
  nextScanAfter: Date | null;
}

async function writeScanOutcome(
  db: DbExecutor,
  params: ScanOutcomeWrite,
): Promise<void> {
  await db(
    `UPDATE repos
     SET fonts_scanned_at = $2,
         fonts_scan_error  = $3,
         scan_attempts     = $4,
         next_scan_after   = $5
     WHERE id = $1`,
    [
      params.repoId,
      params.fontsScannedAt,
      params.fontsScanError,
      params.scanAttempts,
      params.nextScanAfter,
    ],
  );
}

/**
 * Build a neon-compatible DbExecutor from a DATABASE_URL.
 * Used by scripts/ingest-scan.ts; not used in tests.
 */
export function makeNeonExecutor(databaseUrl: string): DbExecutor {
  // fullResults: true gives us { rows, fields, ... } so we can extract .rows
  const sql: NeonQueryFunction<false, true> = neon(databaseUrl, { fullResults: true });
  return async (query: string, values?: unknown[]) => {
    const result = await sql.query(query, values ?? []);
    return { rows: result.rows as unknown[] };
  };
}
