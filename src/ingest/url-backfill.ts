/**
 * url-backfill.ts — beads silofl-qiy.9
 *
 * Pure planning and SQL-statement generation for the URL backfill migration.
 *
 * Takes every row where cdn_url or raw_url is invalid (raw spaces, non-ASCII)
 * or branch-pinned (@main, @master, @release, etc.) and produces a
 * correctly percent-encoded replacement.
 *
 * ── SHA-pinning status ───────────────────────────────────────────────────────
 *
 * The charter (asset-integrity.md) intends for cdn_url to be pinned to a
 * commit sha rather than a branch name. font_files.sha IS populated for every
 * row, but it contains a GIT BLOB SHA (the file content hash from the GitHub
 * Trees API), not a COMMIT SHA. Neither jsDelivr nor raw.githubusercontent.com
 * accept blob shas as path refs — they return 404.
 *
 * Consequence: this backfill PRESERVES the original ref (branch name) from the
 * stored URL and only applies correct percent-encoding. The sha-pinning goal
 * requires the ingest pipeline to record commit shas (not blob shas) during
 * collection — that is a future pipeline change tracked separately.
 *
 * What this backfill does fix:
 *   1. 1,909 rows with literal spaces in the path → %20-encoded, valid URLs.
 *   2. 8 rows with non-ASCII characters → correctly percent-encoded.
 *   3. All 35,509 rows classified for delivery (cdn | raw_fallback | not_renderable).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Design decisions
 * ----------------
 * 1. planRowRewrite is pure: no I/O, no network, no side effects.
 * 2. buildBackupStatement is idempotent: ON CONFLICT DO NOTHING means
 *    re-running the script never overwrites the genuine original with an
 *    already-rewritten value. That idempotency is the entire safety guarantee.
 * 3. buildRollbackStatement is the inverse of buildRewriteStatement: a single
 *    UPDATE...FROM that restores both columns atomically. Written up front,
 *    not as an afterthought.
 * 4. normaliseExistingUrl handles raw-space rows that new URL() refuses by
 *    splitting structurally; see asset-url.ts for details.
 */

import {
  buildCdnUrl,
  buildRawUrl,
  normaliseExistingUrl,
} from "./asset-url.js";
import { classifyDelivery } from "./cdn-policy.js";

// ── Input shape ──────────────────────────────────────────────────────────────

export interface BackfillRow {
  id: string | number;
  cdn_url: string;
  raw_url: string;
  sha: string | null;
  size_bytes: string | number | null;
  format: string | null;
}

// ── Plan types ───────────────────────────────────────────────────────────────

/** The plan for a row that can be rewritten. */
export interface RowPlan {
  ok: true;
  id: string | number;
  newCdnUrl: string;
  newRawUrl: string;
  delivery: string;
  delivery_reason: string | null;
  /** true when at least one URL actually changes (encoding was applied) */
  changes: boolean;
}

/** A typed failure that prevents planning. */
export interface RowPlanFailure {
  ok: false;
  id: string | number;
  reason:
    | "MISSING_SHA"
    | "UNPARSEABLE_CDN_URL"
    | "UNPARSEABLE_RAW_URL"
    | "UNRECOGNISED_CDN_HOST"
    | "UNRECOGNISED_RAW_HOST";
  detail: string;
}

export type PlanResult = RowPlan | RowPlanFailure;

// ── SQL statement shape ──────────────────────────────────────────────────────

export interface ParameterisedStatement {
  text: string;
  values: unknown[];
}

// ── Core planning logic ──────────────────────────────────────────────────────

const JSDELIVR_PREFIX = "https://cdn.jsdelivr.net/gh/";
const RAW_GITHUB_PREFIX = "https://raw.githubusercontent.com/";

/**
 * Pure function. Given a database row, produce a plan describing exactly
 * what the rewritten URLs will be, or a typed failure reason.
 *
 * Uses normaliseExistingUrl to parse the stored (possibly invalid) URL,
 * then rebuilds with correct percent-encoding.
 *
 * The original ref (branch name or other) is PRESERVED from the stored URL.
 * See the SHA-pinning status note at the top of this file for why blob shas
 * from font_files.sha cannot be used as path refs.
 *
 * The sha field is required to be present (non-empty) but is not used as the
 * URL ref. It is retained in the type for forward compatibility when the
 * pipeline is updated to record commit shas.
 */
export function planRowRewrite(row: BackfillRow): PlanResult {
  const { id, cdn_url, raw_url, sha, size_bytes, format } = row;

  // Guard: sha must be present — this is a schema invariant we verify.
  // We do not USE the sha as a ref (see module-level note), but we confirm
  // the row is in the expected state.
  if (!sha || sha.trim() === "") {
    return {
      ok: false,
      id,
      reason: "MISSING_SHA",
      detail: `row ${id}: sha is empty or null`,
    };
  }

  // --- Parse CDN URL ---
  if (!cdn_url.startsWith(JSDELIVR_PREFIX)) {
    return {
      ok: false,
      id,
      reason: "UNRECOGNISED_CDN_HOST",
      detail: `row ${id}: cdn_url does not start with ${JSDELIVR_PREFIX}: ${cdn_url.slice(0, 80)}`,
    };
  }

  // normaliseExistingUrl handles raw-space paths that new URL() refuses.
  const normalisedCdn = normaliseExistingUrl(cdn_url);
  if (normalisedCdn === null) {
    return {
      ok: false,
      id,
      reason: "UNPARSEABLE_CDN_URL",
      detail: `row ${id}: cannot parse cdn_url: ${cdn_url.slice(0, 80)}`,
    };
  }

  // Re-parse the normalised CDN URL to extract owner/repo/ref/path
  const cdnRest = normalisedCdn.slice(JSDELIVR_PREFIX.length);
  const cdnFirstSlash = cdnRest.indexOf("/");
  if (cdnFirstSlash === -1) {
    return {
      ok: false,
      id,
      reason: "UNPARSEABLE_CDN_URL",
      detail: `row ${id}: cannot extract owner from normalised cdn_url`,
    };
  }
  const cdnOwner = decodeURIComponent(cdnRest.slice(0, cdnFirstSlash));
  const cdnRemainder = cdnRest.slice(cdnFirstSlash + 1);
  const cdnSecondSlash = cdnRemainder.indexOf("/");
  if (cdnSecondSlash === -1) {
    return {
      ok: false,
      id,
      reason: "UNPARSEABLE_CDN_URL",
      detail: `row ${id}: cannot extract repo from normalised cdn_url`,
    };
  }
  const cdnRepoRef = cdnRemainder.slice(0, cdnSecondSlash);
  const cdnAtIdx = cdnRepoRef.lastIndexOf("@");
  if (cdnAtIdx === -1) {
    return {
      ok: false,
      id,
      reason: "UNPARSEABLE_CDN_URL",
      detail: `row ${id}: no @ in repo@ref segment of cdn_url`,
    };
  }
  const cdnRepo = decodeURIComponent(cdnRepoRef.slice(0, cdnAtIdx));
  // Preserve the original ref (branch name) — do NOT substitute the blob sha.
  const cdnRef = decodeURIComponent(cdnRepoRef.slice(cdnAtIdx + 1));
  const cdnPath = decodeURIComponent(cdnRemainder.slice(cdnSecondSlash + 1));

  // --- Parse RAW URL ---
  if (!raw_url.startsWith(RAW_GITHUB_PREFIX)) {
    return {
      ok: false,
      id,
      reason: "UNRECOGNISED_RAW_HOST",
      detail: `row ${id}: raw_url does not start with ${RAW_GITHUB_PREFIX}: ${raw_url.slice(0, 80)}`,
    };
  }

  const normalisedRaw = normaliseExistingUrl(raw_url);
  if (normalisedRaw === null) {
    return {
      ok: false,
      id,
      reason: "UNPARSEABLE_RAW_URL",
      detail: `row ${id}: cannot parse raw_url: ${raw_url.slice(0, 80)}`,
    };
  }

  const rawRest = normalisedRaw.slice(RAW_GITHUB_PREFIX.length);
  const rawParts = rawRest.split("/");
  if (rawParts.length < 4) {
    return {
      ok: false,
      id,
      reason: "UNPARSEABLE_RAW_URL",
      detail: `row ${id}: normalised raw_url has fewer than 4 path segments`,
    };
  }
  const rawOwner = decodeURIComponent(rawParts[0]!);
  const rawRepo = decodeURIComponent(rawParts[1]!);
  // Preserve the original ref from the raw URL.
  const rawRef = decodeURIComponent(rawParts[2]!);
  const rawPath = decodeURIComponent(rawParts.slice(3).join("/"));

  // --- Build correctly encoded URLs (preserving original ref) ---
  const newCdnUrl = buildCdnUrl({
    owner: cdnOwner,
    repo: cdnRepo,
    ref: cdnRef,
    path: cdnPath,
  });

  const newRawUrl = buildRawUrl({
    owner: rawOwner,
    repo: rawRepo,
    ref: rawRef,
    path: rawPath,
  });

  // --- Classify delivery ---
  const sizeNum =
    size_bytes === null || size_bytes === undefined
      ? null
      : typeof size_bytes === "number"
        ? size_bytes
        : parseInt(String(size_bytes), 10);

  const classification = classifyDelivery({
    sizeBytes: sizeNum,
    format: format ?? null,
  });

  return {
    ok: true,
    id,
    newCdnUrl,
    newRawUrl,
    delivery: classification.kind,
    delivery_reason:
      "reason" in classification ? classification.reason : null,
    changes: newCdnUrl !== cdn_url || newRawUrl !== raw_url,
  };
}

// ── SQL statement builders ───────────────────────────────────────────────────

/**
 * Build an idempotent INSERT into font_files_url_backup for a batch of rows.
 *
 * ON CONFLICT (font_file_id) DO NOTHING ensures that re-running the script
 * never overwrites the genuine original with an already-rewritten value.
 * This idempotency guarantee is the core safety property of the migration.
 *
 * @param rows  The rows from font_files to back up (read before rewriting).
 */
export function buildBackupStatement(
  rows: Array<{ id: string | number; cdn_url: string; raw_url: string }>,
): ParameterisedStatement {
  if (rows.length === 0) {
    // Return a no-op statement so callers don't have to branch.
    return { text: "SELECT 0", values: [] };
  }

  // Build parameterised value tuples: ($1, $2, $3), ($4, $5, $6), ...
  const placeholders: string[] = [];
  const values: unknown[] = [];
  rows.forEach((row, i) => {
    const base = i * 3;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
    values.push(String(row.id), row.cdn_url, row.raw_url);
  });

  return {
    text: `
      INSERT INTO font_files_url_backup (font_file_id, cdn_url, raw_url)
      VALUES ${placeholders.join(", ")}
      ON CONFLICT (font_file_id) DO NOTHING
    `.trim(),
    values,
  };
}

/**
 * Build an UPDATE statement that rewrites cdn_url, raw_url, delivery, and
 * delivery_reason for a batch of planned rows.
 *
 * Uses a VALUES list so the entire batch is one round-trip.
 */
export function buildRewriteStatement(
  plans: RowPlan[],
): ParameterisedStatement {
  if (plans.length === 0) {
    return { text: "SELECT 0", values: [] };
  }

  // Each row contributes 5 values: id, newCdnUrl, newRawUrl, delivery, delivery_reason
  const valueTuples: string[] = [];
  const values: unknown[] = [];

  plans.forEach((plan, i) => {
    const base = i * 5;
    valueTuples.push(
      `($${base + 1}::bigint, $${base + 2}::text, $${base + 3}::text, $${base + 4}::text, $${base + 5}::text)`,
    );
    values.push(
      String(plan.id),
      plan.newCdnUrl,
      plan.newRawUrl,
      plan.delivery,
      plan.delivery_reason,
    );
  });

  return {
    text: `
      UPDATE font_files AS ff
      SET
        cdn_url         = v.cdn_url,
        raw_url         = v.raw_url,
        delivery        = v.delivery,
        delivery_reason = v.delivery_reason
      FROM (VALUES ${valueTuples.join(", ")}) AS v(id, cdn_url, raw_url, delivery, delivery_reason)
      WHERE ff.id = v.id
    `.trim(),
    values,
  };
}

/**
 * Build the rollback UPDATE that restores original cdn_url and raw_url from
 * font_files_url_backup for every row that was backed up.
 *
 * This is a single UPDATE...FROM so the restore is atomic for all rows.
 * delivery and delivery_reason are also NULLed since we did not capture them
 * (they were NULL before the backfill ran).
 *
 * Scope: only rows in font_files_url_backup are affected; rows that were
 * never backed up (e.g. they were added after the backfill) are untouched.
 */
export function buildRollbackStatement(): ParameterisedStatement {
  return {
    text: `
      UPDATE font_files AS ff
      SET
        cdn_url         = b.cdn_url,
        raw_url         = b.raw_url,
        delivery        = NULL,
        delivery_reason = NULL
      FROM font_files_url_backup b
      WHERE ff.id = b.font_file_id
    `.trim(),
    values: [],
  };
}
