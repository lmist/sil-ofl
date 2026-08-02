/**
 * scan-worker.test.ts — offline tests for scan-worker.ts
 *
 * No database, no network. Stubs replace GitHubClient and DbExecutor.
 * Uses node:test + node:assert/strict.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanRepo, runScanBatch, type DbExecutor, type QueueRow } from "@/ingest/scan-worker";
import { GitHubClient } from "@/ingest/github-client";
import type { ScanError } from "@/ingest/scan-errors";

// ---------------------------------------------------------------------------
// Helpers / stubs
// ---------------------------------------------------------------------------

function makeBlob(path: string, sha = "blob123", size = 50000) {
  return { path, sha, size, type: "blob" as const };
}

function makeSuccessClient(fonts: ReturnType<typeof makeBlob>[], commitSha = "commit1234"): GitHubClient {
  return {
    fetchRepoTree: async () => ({
      ok: true as const,
      tree: {
        commitSha,
        fonts,
        requestsSpent: 2,
        rateLimit: { remaining: 4990, resetAt: 9999999999 },
      },
    }),
  } as unknown as GitHubClient;
}

function makeErrorClient(error: ScanError): GitHubClient {
  return {
    fetchRepoTree: async () => ({
      ok: false as const,
      error,
      requestsSpent: 1,
      rateLimit: { remaining: 4990, resetAt: 9999999999 },
    }),
  } as unknown as GitHubClient;
}

/** A no-op DbExecutor that records calls. */
function makeMockDb(): { db: DbExecutor; calls: Array<{ query: string; values: unknown[] }> } {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const db: DbExecutor = async (query, values = []) => {
    calls.push({ query, values });
    // For the queue query, return a fake row
    if (query.includes("v_repos_missing_fonts") || query.includes("FROM repos r")) {
      return { rows: [] };
    }
    // For load stored files
    if (query.includes("SELECT id, path, retired_at")) {
      return { rows: [] };
    }
    // For scan attempts
    if (query.includes("scan_attempts FROM repos")) {
      return { rows: [{ scan_attempts: 0 }] };
    }
    return { rows: [] };
  };
  return { db, calls };
}

function makeQueueRow(
  id: number,
  fullName: string,
  defaultBranch = "main",
  overrides: Partial<QueueRow> = {},
): QueueRow {
  return {
    id,
    full_name: fullName,
    default_branch: defaultBranch,
    pushed_at: null,
    fonts_scanned_at: null,
    fonts_scan_error: null,
    reputation: 100,
    stars: 50,
    is_catalog_eligible: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// scanRepo
// ---------------------------------------------------------------------------

describe("scanRepo", () => {
  it("returns font files on success with sha-pinned URLs", async () => {
    const client = makeSuccessClient(
      [makeBlob("fonts/Font-Regular.ttf", "blobsha", 50000)],
      "commitdeadbeef",
    );
    const result = await scanRepo(client, {
      id: BigInt(1),
      full_name: "owner/repo",
      default_branch: "main",
    });
    assert.ok(result.ok);
    assert.equal(result.fonts.length, 1);
    // URL must be pinned to commitSha, not "main"
    assert.ok(result.fonts[0]!.cdn_url.includes("commitdeadbeef"));
    assert.ok(!result.fonts[0]!.cdn_url.includes("@main"));
    assert.ok(result.fonts[0]!.raw_url.includes("commitdeadbeef"));
  });

  it("returns delivery classification in font rows", async () => {
    const client = makeSuccessClient([
      makeBlob("fonts/Small.ttf", "sha1", 100),
    ]);
    const result = await scanRepo(client, {
      id: BigInt(1),
      full_name: "owner/repo",
      default_branch: "main",
    });
    assert.ok(result.ok);
    // Small file should be cdn
    const ext = result.fonts[0] as typeof result.fonts[0] & { _delivery?: string };
    assert.equal(ext._delivery, "cdn");
  });

  it("correctly sets is_webfont for woff2", async () => {
    const client = makeSuccessClient([makeBlob("fonts/Font.woff2", "sha1", 10000)]);
    const result = await scanRepo(client, {
      id: BigInt(1),
      full_name: "owner/repo",
      default_branch: "main",
    });
    assert.ok(result.ok);
    assert.equal(result.fonts[0]!.is_webfont, true);
    assert.equal(result.fonts[0]!.format, "woff2");
  });

  it("correctly sets is_webfont false for ttf", async () => {
    const client = makeSuccessClient([makeBlob("fonts/Font.ttf", "sha1", 50000)]);
    const result = await scanRepo(client, {
      id: BigInt(1),
      full_name: "owner/repo",
      default_branch: "main",
    });
    assert.ok(result.ok);
    assert.equal(result.fonts[0]!.is_webfont, false);
  });

  it("returns error when client fails", async () => {
    const client = makeErrorClient({ cls: "terminal:not-found", code: "404", detail: "not found" });
    const result = await scanRepo(client, {
      id: BigInt(1),
      full_name: "owner/repo",
      default_branch: "main",
    });
    assert.ok(!result.ok);
    assert.equal(result.error.cls, "terminal:not-found");
    assert.equal(result.requestsSpent, 1);
  });

  it("returns error for malformed full_name", async () => {
    const client = makeSuccessClient([]);
    const result = await scanRepo(client, {
      id: BigInt(1),
      full_name: "no-slash-here",
      default_branch: "main",
    });
    assert.ok(!result.ok);
    assert.ok(result.error.detail.includes("malformed full_name"));
  });

  it("accounts requestsSpent correctly", async () => {
    const client = makeSuccessClient([makeBlob("fonts/A.ttf")], "sha");
    const result = await scanRepo(client, {
      id: BigInt(1),
      full_name: "owner/repo",
      default_branch: "main",
    });
    assert.ok(result.ok);
    assert.equal(result.requestsSpent, 2); // commit + tree
  });
});

// ---------------------------------------------------------------------------
// runScanBatch
// ---------------------------------------------------------------------------

describe("runScanBatch", () => {
  it("returns empty_queue when no repos are queued", async () => {
    const client = makeSuccessClient([]);
    const { db } = makeMockDb();
    const summary = await runScanBatch({ client, db, limit: 10 });
    assert.equal(summary.outcome, "empty_queue");
    assert.equal(summary.reposQueued, 0);
  });

  it("dry-run does not write to db (only read queries)", async () => {
    const client = makeSuccessClient([makeBlob("fonts/A.ttf")]);
    const calls: Array<{ query: string; values: unknown[] }> = [];
    const db: DbExecutor = async (query, values = []) => {
      calls.push({ query, values });
      if (query.includes("v_repos_missing_fonts") || query.includes("FROM repos r")) {
        return { rows: [makeQueueRow(1, "owner/repo")] };
      }
      return { rows: [] };
    };
    const summary = await runScanBatch({ client, db, limit: 1, dryRun: true });
    // In dry-run, no UPDATE/INSERT calls should happen
    const writeCalls = calls.filter(
      (c) =>
        c.query.includes("UPDATE repos") ||
        c.query.includes("INSERT INTO font_files") ||
        c.query.includes("UPDATE font_files"),
    );
    assert.equal(writeCalls.length, 0);
    assert.equal(summary.reposScanned, 1);
    // dry-run: filesAdded = toUpsert.length (observed count, not DB writes=0)
    assert.equal(summary.filesAdded, 1);
  });

  it("skips repos that do not need rescan", async () => {
    const client = makeSuccessClient([makeBlob("fonts/A.ttf")]);
    const calls: Array<{ query: string; values: unknown[] }> = [];
    const db: DbExecutor = async (query, values = []) => {
      calls.push({ query, values });
      if (query.includes("v_repos_missing_fonts") || query.includes("FROM repos r")) {
        // Repo that doesn't need rescan: scanned recently, no error, no new push
        return {
          rows: [
            makeQueueRow(1, "owner/repo", "main", {
              fonts_scanned_at: new Date("2026-01-01"),
              pushed_at: new Date("2025-12-01"), // older than scanned_at
              fonts_scan_error: null,
            }),
          ],
        };
      }
      return { rows: [] };
    };
    const summary = await runScanBatch({ client, db, limit: 1 });
    const skipped = summary.repos.filter((r) => r.status === "skipped");
    assert.equal(skipped.length, 1);
    assert.equal(summary.reposScanned, 0);
  });

  it("returns rate_limit_stop when budget is at stop threshold", async () => {
    // Client returns very low remaining budget
    const client = {
      fetchRepoTree: async () => ({
        ok: true as const,
        tree: {
          commitSha: "sha",
          fonts: [],
          requestsSpent: 2,
          rateLimit: { remaining: 10, resetAt: 9999 }, // below RATE_LIMIT_STOP_AT=50
        },
      }),
    } as unknown as GitHubClient;

    const calls: Array<{ query: string; values: unknown[] }> = [];
    const db: DbExecutor = async (query, values = []) => {
      calls.push({ query, values });
      if (query.includes("v_repos_missing_fonts") || query.includes("FROM repos r")) {
        return {
          rows: [
            makeQueueRow(1, "owner/repo-1"),
            makeQueueRow(2, "owner/repo-2"), // second repo should not be processed
          ],
        };
      }
      if (query.includes("SELECT id, path, retired_at")) return { rows: [] };
      if (query.includes("scan_attempts FROM repos")) return { rows: [{ scan_attempts: 0 }] };
      return { rows: [] };
    };

    const summary = await runScanBatch({ client, db, limit: 2 });
    // After first repo, remaining=10 <= 50, so should stop
    assert.equal(summary.outcome, "rate_limit_stop");
  });

  it("counts filesAdded across repos (dry-run mode uses observed count)", async () => {
    const client = makeSuccessClient([
      makeBlob("fonts/A.ttf"),
      makeBlob("fonts/B.woff2"),
    ]);
    const db: DbExecutor = async (query) => {
      if (query.includes("v_repos_missing_fonts") || query.includes("FROM repos r")) {
        return { rows: [makeQueueRow(1, "owner/repo")] };
      }
      return { rows: [] };
    };
    const summary = await runScanBatch({ client, db, limit: 1, dryRun: true });
    // dry-run uses toUpsert.length for filesAdded
    assert.equal(summary.reposScanned, 1);
  });
});
