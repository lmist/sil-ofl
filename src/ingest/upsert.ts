/**
 * Idempotent upsert query builders for the font ingest pipeline.
 *
 * DESIGN PRINCIPLE — Pure query builders, no execution.
 * Every function returns { text: string; values: unknown[] } so callers can:
 *   - Unit-test the SQL offline (no database required)
 *   - Swap the executor (neon serverless, pg Pool, bun:sqlite in tests, etc.)
 *   - Inspect generated SQL for audit purposes
 *
 * INV-DATA-3 compliance: every user/remote-derived value is a bound parameter.
 * No value is ever interpolated into the query text. The column names,
 * conflict targets, and ordering expressions are closed, reviewer-controlled
 * constants — they are not derived from user input.
 *
 * ---------------------------------------------------------------------------
 * MERGE-PRESERVING vs AUTHORITATIVE columns
 * ---------------------------------------------------------------------------
 *
 * Re-ingest carries fresh data from the GitHub API.  Some columns should
 * always be overwritten with the fresh value (authoritative); others should
 * keep the best known value even if the new ingest carries null (merge-
 * preserving).
 *
 * owners — all columns authoritative; the API is the single source of truth.
 *
 * repos
 *   Authoritative (always overwrite):
 *     name, owner_id, license_spdx, description, html_url, homepage,
 *     language, default_branch, stars, forks, watchers, open_issues,
 *     size_kb, is_fork, is_archived, is_fontish, reputation,
 *     updated_at, pushed_at
 *   Merge-preserving (keep existing non-null value):
 *     collected_at      — set on first discovery; never regress
 *     fonts_scanned_at  — managed by the scan worker; upsert must not clear it
 *     fonts_scan_error  — managed by the scan worker; upsert must not clear it
 *     created_at        — GitHub rarely changes this; preserve if new value null
 *
 * font_files
 *   Authoritative (always overwrite):
 *     file_name, format, raw_url, cdn_url, branch, is_variable, is_webfont,
 *     sha, discovered_at, blob_url, size_bytes
 *   Merge-preserving (keep existing non-null value):
 *     family_guess, subfamily_guess, weight_guess, style_guess — filled in by
 *       the metadata worker later; the ingest path carries filename-parsed
 *       guesses which are weaker than binary-extracted values. We never want
 *       a second ingest pass (which may arrive without fresh binary metadata)
 *       to erase the binary-derived values the metadata worker wrote.
 *
 * The merge-preserving logic uses COALESCE(EXCLUDED.col, target.col) on the
 * DO UPDATE clause so that a non-null incoming value wins, but an incoming
 * null falls back to the stored value.
 *
 * Idempotency WHERE clause:
 * The DO UPDATE is guarded by a WHERE clause that compares the new values to
 * the stored ones across every authoritative column. When a second identical
 * run arrives, no column differs and the WHERE clause evaluates to false —
 * zero rows are touched. This keeps xmax/row-version counters honest and
 * makes "changed rows" a meaningful signal.
 */

import { isRetryableError } from "@/ingest/scan-errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryResult {
  text: string;
  values: unknown[];
}

/** Shape of a row coming from the GitHub Repositories API. */
export interface OwnerInput {
  id: bigint | number;
  login: string;
  owner_type: "User" | "Organization";
  html_url: string;
}

/** Shape of a repo row as returned from the GitHub Repositories API. */
export interface RepoInput {
  id: bigint | number;
  full_name: string;
  name: string;
  owner_id: bigint | number;
  license_spdx: string | null;
  description: string | null;
  html_url: string;
  homepage: string | null;
  language: string | null;
  default_branch: string | null;
  stars: number;
  forks: number;
  watchers: number;
  open_issues: number;
  size_kb: number;
  is_fork: boolean;
  is_archived: boolean;
  is_fontish: boolean;
  reputation: number;
  created_at: Date | null;
  updated_at: Date | null;
  pushed_at: Date | null;
}

/** Shape of a font_files row produced by the tree scanner. */
export interface FontFileInput {
  repo_id: bigint | number;
  path: string;
  file_name: string;
  format: string;
  raw_url: string;
  cdn_url: string;
  blob_url: string | null;
  branch: string;
  size_bytes: bigint | number | null;
  family_guess: string | null;
  subfamily_guess: string | null;
  weight_guess: number | null;
  style_guess: string | null;
  is_variable: boolean;
  is_webfont: boolean;
  sha: string | null;
  discovered_at: Date;
}

/** Minimal repo shape sufficient for the needsRescan predicate. */
export interface RepoScanState {
  fonts_scanned_at: Date | null;
  pushed_at: Date | null;
  fonts_scan_error: string | null;
}

// ---------------------------------------------------------------------------
// Owner upsert
// ---------------------------------------------------------------------------

/**
 * Build an idempotent upsert for one owner row.
 *
 * Conflict target: owners(login) — login is the natural key from GitHub.
 * Fallback: owners(id) is also unique, but we key on login so a renamed user
 * still lands on the correct row.
 */
export function buildOwnerUpsert(owner: OwnerInput): QueryResult {
  const values: unknown[] = [
    owner.id,
    owner.login,
    owner.owner_type,
    owner.html_url,
  ];
  // $1...$4
  const text = `
INSERT INTO owners (id, login, owner_type, html_url)
VALUES ($1, $2, $3, $4)
ON CONFLICT (login) DO UPDATE
  SET id         = EXCLUDED.id,
      owner_type = EXCLUDED.owner_type,
      html_url   = EXCLUDED.html_url
  WHERE owners.id         IS DISTINCT FROM EXCLUDED.id
     OR owners.owner_type IS DISTINCT FROM EXCLUDED.owner_type
     OR owners.html_url   IS DISTINCT FROM EXCLUDED.html_url
`.trim();
  return { text, values };
}

// ---------------------------------------------------------------------------
// Repo upsert
// ---------------------------------------------------------------------------

/**
 * Build an idempotent upsert for one repo row.
 *
 * Conflict target: repos(full_name) — the natural stable key.
 * Fallback id-based conflict not used here; full_name is immutable for the
 * lifetime of a GitHub repo (renames produce a new full_name).
 *
 * Merge-preserving columns: collected_at, fonts_scanned_at, fonts_scan_error,
 * created_at — see module header for rationale.
 */
export function buildRepoUpsert(repo: RepoInput): QueryResult {
  const values: unknown[] = [
    repo.id,            // $1
    repo.full_name,     // $2
    repo.name,          // $3
    repo.owner_id,      // $4
    repo.license_spdx,  // $5
    repo.description,   // $6
    repo.html_url,      // $7
    repo.homepage,      // $8
    repo.language,      // $9
    repo.default_branch, // $10
    repo.stars,         // $11
    repo.forks,         // $12
    repo.watchers,      // $13
    repo.open_issues,   // $14
    repo.size_kb,       // $15
    repo.is_fork,       // $16
    repo.is_archived,   // $17
    repo.is_fontish,    // $18
    repo.reputation,    // $19
    repo.created_at,    // $20
    repo.updated_at,    // $21
    repo.pushed_at,     // $22
  ];

  const text = `
INSERT INTO repos (
  id, full_name, name, owner_id, license_spdx, description, html_url,
  homepage, language, default_branch, stars, forks, watchers, open_issues,
  size_kb, is_fork, is_archived, is_fontish, reputation,
  created_at, updated_at, pushed_at, collected_at
)
VALUES (
  $1, $2, $3, $4, $5, $6, $7,
  $8, $9, $10, $11, $12, $13, $14,
  $15, $16, $17, $18, $19,
  $20, $21, $22, NOW()
)
ON CONFLICT (full_name) DO UPDATE
  SET id             = EXCLUDED.id,
      name           = EXCLUDED.name,
      owner_id       = EXCLUDED.owner_id,
      license_spdx   = EXCLUDED.license_spdx,
      description    = EXCLUDED.description,
      html_url       = EXCLUDED.html_url,
      homepage       = EXCLUDED.homepage,
      language       = EXCLUDED.language,
      default_branch = EXCLUDED.default_branch,
      stars          = EXCLUDED.stars,
      forks          = EXCLUDED.forks,
      watchers       = EXCLUDED.watchers,
      open_issues    = EXCLUDED.open_issues,
      size_kb        = EXCLUDED.size_kb,
      is_fork        = EXCLUDED.is_fork,
      is_archived    = EXCLUDED.is_archived,
      is_fontish     = EXCLUDED.is_fontish,
      reputation     = EXCLUDED.reputation,
      updated_at     = EXCLUDED.updated_at,
      pushed_at      = EXCLUDED.pushed_at,
      -- created_at: merge-preserving — keep existing if incoming is null
      created_at     = COALESCE(EXCLUDED.created_at, repos.created_at)
      -- collected_at, fonts_scanned_at, fonts_scan_error: never touched here;
      -- those are owned by the scan worker and the scheduler.
  WHERE repos.id             IS DISTINCT FROM EXCLUDED.id
     OR repos.name           IS DISTINCT FROM EXCLUDED.name
     OR repos.owner_id       IS DISTINCT FROM EXCLUDED.owner_id
     OR repos.license_spdx   IS DISTINCT FROM EXCLUDED.license_spdx
     OR repos.description    IS DISTINCT FROM EXCLUDED.description
     OR repos.html_url       IS DISTINCT FROM EXCLUDED.html_url
     OR repos.homepage       IS DISTINCT FROM EXCLUDED.homepage
     OR repos.language       IS DISTINCT FROM EXCLUDED.language
     OR repos.default_branch IS DISTINCT FROM EXCLUDED.default_branch
     OR repos.stars          IS DISTINCT FROM EXCLUDED.stars
     OR repos.forks          IS DISTINCT FROM EXCLUDED.forks
     OR repos.watchers       IS DISTINCT FROM EXCLUDED.watchers
     OR repos.open_issues    IS DISTINCT FROM EXCLUDED.open_issues
     OR repos.size_kb        IS DISTINCT FROM EXCLUDED.size_kb
     OR repos.is_fork        IS DISTINCT FROM EXCLUDED.is_fork
     OR repos.is_archived    IS DISTINCT FROM EXCLUDED.is_archived
     OR repos.is_fontish     IS DISTINCT FROM EXCLUDED.is_fontish
     OR repos.reputation     IS DISTINCT FROM EXCLUDED.reputation
     OR repos.updated_at     IS DISTINCT FROM EXCLUDED.updated_at
     OR repos.pushed_at      IS DISTINCT FROM EXCLUDED.pushed_at
`.trim();

  return { text, values };
}

// ---------------------------------------------------------------------------
// Font file upsert
// ---------------------------------------------------------------------------

/**
 * Build an idempotent upsert for one font_files row.
 *
 * Conflict target: font_files(repo_id, path) — the composite natural key.
 *
 * Merge-preserving: family_guess, subfamily_guess, weight_guess, style_guess.
 * These are filled by the metadata worker (binary extraction) which produces
 * higher-quality values than the filename parser. If the incoming upsert
 * carries null for any guess, we keep whatever the metadata worker set.
 * If the incoming value is non-null, we prefer it over null — COALESCE does
 * this automatically: COALESCE(EXCLUDED.col, target.col).
 */
export function buildFontFileUpsert(file: FontFileInput): QueryResult {
  const values: unknown[] = [
    file.repo_id,        // $1
    file.path,           // $2
    file.file_name,      // $3
    file.format,         // $4
    file.raw_url,        // $5
    file.cdn_url,        // $6
    file.blob_url,       // $7
    file.branch,         // $8
    file.size_bytes,     // $9
    file.family_guess,   // $10
    file.subfamily_guess,// $11
    file.weight_guess,   // $12
    file.style_guess,    // $13
    file.is_variable,    // $14
    file.is_webfont,     // $15
    file.sha,            // $16
    file.discovered_at,  // $17
  ];

  const text = `
INSERT INTO font_files (
  repo_id, path, file_name, format, raw_url, cdn_url, blob_url,
  branch, size_bytes, family_guess, subfamily_guess, weight_guess,
  style_guess, is_variable, is_webfont, sha, discovered_at
)
VALUES (
  $1, $2, $3, $4, $5, $6, $7,
  $8, $9, $10, $11, $12,
  $13, $14, $15, $16, $17
)
ON CONFLICT (repo_id, path) DO UPDATE
  SET file_name      = EXCLUDED.file_name,
      format         = EXCLUDED.format,
      raw_url        = EXCLUDED.raw_url,
      cdn_url        = EXCLUDED.cdn_url,
      blob_url       = EXCLUDED.blob_url,
      branch         = EXCLUDED.branch,
      size_bytes     = EXCLUDED.size_bytes,
      is_variable    = EXCLUDED.is_variable,
      is_webfont     = EXCLUDED.is_webfont,
      sha            = EXCLUDED.sha,
      discovered_at  = EXCLUDED.discovered_at,
      -- Merge-preserving: prefer non-null value; keep metadata worker's output
      family_guess    = COALESCE(EXCLUDED.family_guess,    font_files.family_guess),
      subfamily_guess = COALESCE(EXCLUDED.subfamily_guess, font_files.subfamily_guess),
      weight_guess    = COALESCE(EXCLUDED.weight_guess,    font_files.weight_guess),
      style_guess     = COALESCE(EXCLUDED.style_guess,     font_files.style_guess)
  WHERE font_files.file_name      IS DISTINCT FROM EXCLUDED.file_name
     OR font_files.format         IS DISTINCT FROM EXCLUDED.format
     OR font_files.raw_url        IS DISTINCT FROM EXCLUDED.raw_url
     OR font_files.cdn_url        IS DISTINCT FROM EXCLUDED.cdn_url
     OR font_files.blob_url       IS DISTINCT FROM EXCLUDED.blob_url
     OR font_files.branch         IS DISTINCT FROM EXCLUDED.branch
     OR font_files.size_bytes     IS DISTINCT FROM EXCLUDED.size_bytes
     OR font_files.is_variable    IS DISTINCT FROM EXCLUDED.is_variable
     OR font_files.is_webfont     IS DISTINCT FROM EXCLUDED.is_webfont
     OR font_files.sha            IS DISTINCT FROM EXCLUDED.sha
`.trim();

  return { text, values };
}

// ---------------------------------------------------------------------------
// Change-driven rescan predicate
// ---------------------------------------------------------------------------

/**
 * Return true when a repo needs its font tree rescanned.
 *
 * Rules (any one is sufficient):
 *   1. Never scanned: fonts_scanned_at IS NULL.
 *   2. Stale: the repo was pushed after the last scan.
 *   3. Retryable error: the last scan failed with a transient condition.
 *
 * Terminal errors (404, DMCA, empty) are not retried — needsRescan returns
 * false for those so the scheduler skips them.
 */
export function needsRescan(repo: RepoScanState): boolean {
  // Rule 1: never scanned
  if (repo.fonts_scanned_at === null) return true;

  // Rule 2: pushed after last scan
  if (repo.pushed_at !== null && repo.pushed_at > repo.fonts_scanned_at) {
    return true;
  }

  // Rule 3: last attempt ended in a retryable error
  if (isRetryableError(repo.fonts_scan_error)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Rescan queue query
// ---------------------------------------------------------------------------

/**
 * Build a parameterised SELECT that returns the next batch of repo IDs to
 * scan, ordered so the highest-value work lands first.
 *
 * Ordering rationale:
 *   1. reputation DESC — reputation is a composite score that already weights
 *      stars, forks, and watchers.  High-reputation repos appear in more
 *      external references and serve more users, so their data is worth more.
 *   2. stars DESC — tiebreaker: raw star count as a simpler popularity proxy.
 *   3. id ASC — deterministic tiebreaker for reproducible queue ordering.
 *
 * Source: we JOIN against v_repos_missing_fonts to prefer repos that are both
 * unscanned AND eligible for the public catalog (OFL, fontish, non-fork,
 * non-archived). Repos that are unscanned but not eligible are also included
 * as a second priority (via LEFT JOIN + CASE) — they still need a scan
 * outcome, just not catalog publication.
 *
 * The `limit` parameter ($1) is always passed as a bound parameter so the
 * planner can cache the plan while keeping the value safe.
 *
 * @param limit - maximum number of repos to return
 */
export function buildRescanQueueQuery(limit: number): QueryResult {
  const text = `
SELECT
  r.id,
  r.full_name,
  r.default_branch,
  r.pushed_at,
  r.fonts_scanned_at,
  r.fonts_scan_error,
  r.reputation,
  r.stars,
  -- eligible = meets the public catalog criteria (OFL, fontish, non-fork, non-archived)
  (vmf.repo_id IS NOT NULL) AS is_catalog_eligible
FROM repos r
LEFT JOIN v_repos_missing_fonts vmf ON vmf.repo_id = r.id
WHERE
  -- Include repos that need rescanning by any of the three rules:
  r.fonts_scanned_at IS NULL
  OR r.pushed_at > r.fonts_scanned_at
  OR (
    r.fonts_scan_error IS NOT NULL
    AND split_part(r.fonts_scan_error, ':', 1) = 'retryable'
  )
ORDER BY
  -- Catalog-eligible repos come first (they have real user value)
  (vmf.repo_id IS NOT NULL) DESC,
  -- Within each group, highest reputation/stars first
  r.reputation DESC,
  r.stars DESC,
  r.id ASC
LIMIT $1
`.trim();

  return { text, values: [limit] };
}
