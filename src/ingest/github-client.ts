/**
 * github-client.ts — beads silofl-qiy.1
 *
 * A thin, testable GitHub REST client for exactly what the font-scan needs:
 *  1. Resolve the HEAD commit sha for a branch (one request, pinned ref).
 *  2. Fetch the repo's git tree recursively and filter to font blobs.
 *
 * Design:
 *  - `fetch` is injected as a constructor parameter so tests can stub it
 *    without touching the network.
 *  - Every response exposes rate-limit headers so the caller can budget
 *    requests and back off before hitting 403.
 *  - The client counts every request it makes so the worker can accumulate
 *    a run-level `requests_spent` total.
 *  - No module-level state; instances are cheap and throwaway.
 */

import {
  classifyScanError,
  classifyStructuralError,
  type ScanError,
} from "@/ingest/scan-errors";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Font file extensions the scanner recognises (case-insensitive). */
const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".woff", ".woff2", ".ttc"]);

/**
 * The canonical git empty-blob sha.
 * A tree entry with this sha has zero bytes and is not a font.
 * (beads silofl-qiy.20)
 */
export const GIT_EMPTY_BLOB_SHA = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Rate-limit metadata extracted from every GitHub API response. */
export interface RateLimitInfo {
  /** Requests remaining in the current window. null when header absent. */
  remaining: number | null;
  /** Unix timestamp (seconds) when the window resets. null when header absent. */
  resetAt: number | null;
  /** Seconds to wait before retrying, from Retry-After header. null when absent. */
  retryAfterSeconds: number | null;
}

/** A single font blob entry from the git tree. */
export interface FontBlob {
  /** Path within the repo, e.g. "fonts/Roboto-Regular.ttf" */
  path: string;
  /** Git blob sha — the content hash, not the commit sha. */
  sha: string;
  /** File size in bytes. null when the API omits it (unusual for blobs). */
  size: number | null;
  /** Always "blob" — tree entries with type "tree" are filtered out. */
  type: "blob";
}

/** Successful result of fetching a repo's git tree. */
export interface RepoTree {
  /** The resolved HEAD commit sha — use this to pin asset URLs, not the branch. */
  commitSha: string;
  /** Font blob entries (already filtered and de-emptied). */
  fonts: FontBlob[];
  /** Total requests spent by this call (commit + tree = 2). */
  requestsSpent: number;
  /** Rate-limit state after the final request. */
  rateLimit: RateLimitInfo;
}

/** Union returned by fetchRepoTree. */
export type RepoTreeResult =
  | { ok: true; tree: RepoTree }
  | { ok: false; error: ScanError; requestsSpent: number; rateLimit: RateLimitInfo };

/** Options accepted by the GitHubClient constructor. */
export interface GitHubClientOptions {
  /**
   * GitHub personal-access token or OAuth token.
   * Passed in Authorization header. Required for 5,000 req/hr quota.
   */
  token: string;
  /**
   * Injected fetch implementation. Defaults to globalThis.fetch.
   * Tests substitute a stub; production uses the platform built-in.
   */
  fetch?: typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// GitHubClient
// ---------------------------------------------------------------------------

export class GitHubClient {
  private readonly token: string;
  private readonly _fetch: typeof globalThis.fetch;

  constructor(options: GitHubClientOptions) {
    this.token = options.token;
    this._fetch = options.fetch ?? globalThis.fetch;
  }

  // ── private helpers ─────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "sil-ofl-ingest/1.0",
    };
  }

  private extractRateLimit(res: Response): RateLimitInfo {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    const retryAfter = res.headers.get("retry-after");

    return {
      remaining: remaining !== null ? parseInt(remaining, 10) : null,
      resetAt: reset !== null ? parseInt(reset, 10) : null,
      retryAfterSeconds: retryAfter !== null ? parseRetryAfterHeader(retryAfter) : null,
    };
  }

  /**
   * Resolve the HEAD commit sha for `branch` in `owner/repo`.
   *
   * Uses `GET /repos/{owner}/{repo}/commits/{branch}` which returns the full
   * commit object; we extract `.sha`. One request per call.
   *
   * Returns null on 404/empty-repo so the caller can issue a structural error.
   */
  async resolveCommitSha(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<
    | { ok: true; sha: string; rateLimit: RateLimitInfo }
    | { ok: false; error: ScanError; rateLimit: RateLimitInfo }
  > {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`;
    let res: Response;
    try {
      res = await this._fetch(url, { headers: this.headers() });
    } catch (networkErr: unknown) {
      const detail = networkErr instanceof Error ? networkErr.message : String(networkErr);
      return {
        ok: false,
        error: { cls: "retryable:network-timeout", code: "network", detail },
        rateLimit: { remaining: null, resetAt: null, retryAfterSeconds: null },
      };
    }

    const rateLimit = this.extractRateLimit(res);

    if (!res.ok) {
      const error = classifyScanError({
        status: res.status,
        rateLimitRemaining: rateLimit.remaining !== null ? String(rateLimit.remaining) : null,
        retryAfter: rateLimit.retryAfterSeconds !== null ? String(rateLimit.retryAfterSeconds) : null,
      });
      return { ok: false, error, rateLimit };
    }

    let data: { sha?: string };
    try {
      data = (await res.json()) as { sha?: string };
    } catch {
      return {
        ok: false,
        error: { cls: "retryable:server-error", code: "parse", detail: "commit JSON parse failed" },
        rateLimit,
      };
    }

    if (!data.sha || typeof data.sha !== "string") {
      return {
        ok: false,
        error: classifyStructuralError("empty-repo"),
        rateLimit,
      };
    }

    return { ok: true, sha: data.sha, rateLimit };
  }

  /**
   * Fetch the full recursive git tree for `owner/repo` at `commitSha`.
   *
   * Returns the raw tree entries (truncation already checked and converted to
   * a terminal ScanError). One request.
   */
  async fetchTree(
    owner: string,
    repo: string,
    commitSha: string,
  ): Promise<
    | { ok: true; fonts: FontBlob[]; rateLimit: RateLimitInfo }
    | { ok: false; error: ScanError; rateLimit: RateLimitInfo }
  > {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`;
    let res: Response;
    try {
      res = await this._fetch(url, { headers: this.headers() });
    } catch (networkErr: unknown) {
      const detail = networkErr instanceof Error ? networkErr.message : String(networkErr);
      return {
        ok: false,
        error: { cls: "retryable:network-timeout", code: "network", detail },
        rateLimit: { remaining: null, resetAt: null, retryAfterSeconds: null },
      };
    }

    const rateLimit = this.extractRateLimit(res);

    if (!res.ok) {
      const error = classifyScanError({
        status: res.status,
        rateLimitRemaining: rateLimit.remaining !== null ? String(rateLimit.remaining) : null,
        retryAfter: rateLimit.retryAfterSeconds !== null ? String(rateLimit.retryAfterSeconds) : null,
      });
      return { ok: false, error, rateLimit };
    }

    let data: { truncated?: boolean; tree?: unknown[] };
    try {
      data = (await res.json()) as { truncated?: boolean; tree?: unknown[] };
    } catch {
      return {
        ok: false,
        error: { cls: "retryable:server-error", code: "parse", detail: "tree JSON parse failed" },
        rateLimit,
      };
    }

    // Truncated tree is a terminal condition — scanning it would silently miss
    // files and could cause valid fonts to be tombstoned in reconciliation.
    if (data.truncated === true) {
      return {
        ok: false,
        error: classifyStructuralError("tree-truncated"),
        rateLimit,
      };
    }

    if (!Array.isArray(data.tree)) {
      return {
        ok: false,
        error: classifyStructuralError("empty-repo"),
        rateLimit,
      };
    }

    const fonts = filterFontBlobs(data.tree);
    return { ok: true, fonts, rateLimit };
  }

  /**
   * High-level: resolve the commit sha, then fetch the tree.
   *
   * Returns a unified `RepoTreeResult` and the total `requestsSpent` (always
   * 2 on full success, 1 if the commit step failed, 0 for network errors
   * before the first request completes).
   *
   * @param owner   GitHub owner login
   * @param repo    Repository name
   * @param branch  Default branch (from repos.default_branch)
   */
  async fetchRepoTree(
    owner: string,
    repo: string,
    branch: string | null,
  ): Promise<RepoTreeResult> {
    if (!branch) {
      return {
        ok: false,
        error: classifyStructuralError("no-default-branch"),
        requestsSpent: 0,
        rateLimit: { remaining: null, resetAt: null, retryAfterSeconds: null },
      };
    }

    // Step 1: resolve commit sha (request 1)
    const commitResult = await this.resolveCommitSha(owner, repo, branch);
    if (!commitResult.ok) {
      return {
        ok: false,
        error: commitResult.error,
        requestsSpent: 1,
        rateLimit: commitResult.rateLimit,
      };
    }

    const commitSha = commitResult.sha;

    // Step 2: fetch tree (request 2)
    const treeResult = await this.fetchTree(owner, repo, commitSha);
    if (!treeResult.ok) {
      return {
        ok: false,
        error: treeResult.error,
        requestsSpent: 2,
        rateLimit: treeResult.rateLimit,
      };
    }

    return {
      ok: true,
      tree: {
        commitSha,
        fonts: treeResult.fonts,
        requestsSpent: 2,
        rateLimit: treeResult.rateLimit,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Filter raw tree entries to font blobs, skipping the git empty blob.
 */
function filterFontBlobs(entries: unknown[]): FontBlob[] {
  const result: FontBlob[] = [];
  for (const entry of entries) {
    if (!isTreeEntry(entry)) continue;
    if (entry.type !== "blob") continue;
    if (!isFontPath(entry.path)) continue;
    if (entry.sha === GIT_EMPTY_BLOB_SHA) continue; // beads .20
    result.push({
      path: entry.path,
      sha: entry.sha,
      size: typeof entry.size === "number" ? entry.size : null,
      type: "blob",
    });
  }
  return result;
}

/** Type guard for raw tree entry objects from the GitHub API. */
function isTreeEntry(v: unknown): v is { path: string; sha: string; size?: number; type: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>)["path"] === "string" &&
    typeof (v as Record<string, unknown>)["sha"] === "string" &&
    typeof (v as Record<string, unknown>)["type"] === "string"
  );
}

/** Return true when the path ends with a recognised font extension. */
function isFontPath(path: string): boolean {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return false;
  const ext = path.slice(lastDot).toLowerCase();
  return FONT_EXTENSIONS.has(ext);
}

/**
 * Parse a Retry-After header value to seconds.
 * Accepts integer-second strings ("30") and HTTP-date strings.
 */
function parseRetryAfterHeader(value: string): number | null {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return n > 0 ? n : null;
  }
  const ts = Date.parse(trimmed);
  if (!Number.isNaN(ts)) {
    const diffSecs = Math.round((ts - Date.now()) / 1_000);
    return diffSecs > 0 ? diffSecs : 1;
  }
  return null;
}
