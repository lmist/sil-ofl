/**
 * github-client.test.ts — offline tests for GitHubClient
 *
 * All network calls are stubbed. No real HTTP requests are made.
 * Uses node:test + node:assert/strict.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GitHubClient,
  GIT_EMPTY_BLOB_SHA
} from "@/ingest/github-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock Response. */
function makeResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  const responseHeaders = new Headers({
    "content-type": "application/json",
    "x-ratelimit-remaining": "4999",
    "x-ratelimit-reset": "9999999999",
    ...headers,
  });
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

/** Create a client with a stubbed fetch. */
function makeClient(fetchStub: typeof globalThis.fetch): GitHubClient {
  return new GitHubClient({ token: "test-token", fetch: fetchStub });
}

// ---------------------------------------------------------------------------
// resolveCommitSha
// ---------------------------------------------------------------------------

describe("GitHubClient.resolveCommitSha", () => {
  it("returns the sha on a 200 response", async () => {
    const fetchStub = async () => {
      return makeResponse({ sha: "abc123deadbeef" }, 200);
    };
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.resolveCommitSha("owner", "repo", "main");
    assert.ok(result.ok);
    assert.equal(result.sha, "abc123deadbeef");
  });

  it("returns a terminal:not-found error on 404", async () => {
    const fetchStub = async () => makeResponse({ message: "Not Found" }, 404);
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.resolveCommitSha("owner", "repo", "main");
    assert.ok(!result.ok);
    assert.equal(result.error.cls, "terminal:not-found");
  });

  it("returns retryable:rate-limit-primary on 429", async () => {
    const fetchStub = async () =>
      makeResponse({ message: "rate limited" }, 429, {
        "x-ratelimit-remaining": "0",
        "retry-after": "60",
      });
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.resolveCommitSha("owner", "repo", "main");
    assert.ok(!result.ok);
    assert.ok(result.error.cls.startsWith("retryable:rate-limit"));
  });

  it("returns retryable:server-error on 500", async () => {
    const fetchStub = async () => makeResponse({ message: "Internal Server Error" }, 500);
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.resolveCommitSha("owner", "repo", "main");
    assert.ok(!result.ok);
    assert.equal(result.error.cls, "retryable:server-error");
  });

  it("returns retryable:network-error on fetch throw", async () => {
    const fetchStub = async () => {
      throw new Error("ECONNRESET");
    };
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.resolveCommitSha("owner", "repo", "main");
    assert.ok(!result.ok);
    assert.equal(result.error.cls, "retryable:network-timeout");
    assert.ok(result.error.detail.includes("ECONNRESET"));
  });

  it("exposes rate-limit headers from the response", async () => {
    const fetchStub = async () =>
      makeResponse({ sha: "deadbeef" }, 200, {
        "x-ratelimit-remaining": "42",
        "x-ratelimit-reset": "1700000000",
      });
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.resolveCommitSha("owner", "repo", "main");
    assert.ok(result.ok);
    assert.equal(result.rateLimit.remaining, 42);
    assert.equal(result.rateLimit.resetAt, 1700000000);
  });
});

// ---------------------------------------------------------------------------
// fetchTree
// ---------------------------------------------------------------------------

describe("GitHubClient.fetchTree", () => {
  it("returns filtered font blobs on success", async () => {
    const fetchStub = async () =>
      makeResponse(
        {
          truncated: false,
          tree: [
            { path: "fonts/Roboto-Regular.ttf", sha: "aaaa", size: 50000, type: "blob" },
            { path: "fonts/Roboto-Bold.otf", sha: "bbbb", size: 60000, type: "blob" },
            { path: "README.md", sha: "cccc", size: 1000, type: "blob" },
            { path: "src/fonts", sha: "dddd", size: 0, type: "tree" },
            { path: "fonts/Roboto.woff2", sha: "eeee", size: 20000, type: "blob" },
          ],
        },
        200,
      );
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.fetchTree("owner", "repo", "sha123");
    assert.ok(result.ok);
    assert.equal(result.fonts.length, 3);
    assert.ok(result.fonts.every((f) => f.type === "blob"));
    // Verify paths are font paths
    const paths = result.fonts.map((f) => f.path);
    assert.ok(paths.includes("fonts/Roboto-Regular.ttf"));
    assert.ok(paths.includes("fonts/Roboto-Bold.otf"));
    assert.ok(paths.includes("fonts/Roboto.woff2"));
    assert.ok(!paths.includes("README.md"));
  });

  it("skips the git empty blob", async () => {
    const fetchStub = async () =>
      makeResponse(
        {
          truncated: false,
          tree: [
            { path: "fonts/Empty.ttf", sha: GIT_EMPTY_BLOB_SHA, size: 0, type: "blob" },
            { path: "fonts/Real.ttf", sha: "abc123", size: 50000, type: "blob" },
          ],
        },
        200,
      );
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.fetchTree("owner", "repo", "sha123");
    assert.ok(result.ok);
    assert.equal(result.fonts.length, 1);
    assert.equal(result.fonts[0]!.path, "fonts/Real.ttf");
  });

  it("returns terminal:tree-truncated when tree is truncated", async () => {
    const fetchStub = async () =>
      makeResponse(
        {
          truncated: true,
          tree: [
            { path: "fonts/A.ttf", sha: "aaaa", size: 50000, type: "blob" },
          ],
        },
        200,
      );
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.fetchTree("owner", "repo", "sha123");
    assert.ok(!result.ok);
    assert.equal(result.error.cls, "terminal:tree-truncated");
  });

  it("filters case-insensitively (.TTF .OTF)", async () => {
    const fetchStub = async () =>
      makeResponse(
        {
          truncated: false,
          tree: [
            { path: "fonts/UPPER.TTF", sha: "aaaa", size: 50000, type: "blob" },
            { path: "fonts/Mixed.Otf", sha: "bbbb", size: 50000, type: "blob" },
            { path: "fonts/lower.woff2", sha: "cccc", size: 10000, type: "blob" },
          ],
        },
        200,
      );
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.fetchTree("owner", "repo", "sha123");
    assert.ok(result.ok);
    assert.equal(result.fonts.length, 3);
  });

  it("returns terminal:not-found on 404", async () => {
    const fetchStub = async () => makeResponse({ message: "Not Found" }, 404);
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.fetchTree("owner", "repo", "sha123");
    assert.ok(!result.ok);
    assert.equal(result.error.cls, "terminal:not-found");
  });
});

// ---------------------------------------------------------------------------
// fetchRepoTree (combined)
// ---------------------------------------------------------------------------

describe("GitHubClient.fetchRepoTree", () => {
  it("returns error immediately when branch is null", async () => {
    const fetchStub = async () => {
      throw new Error("should not be called");
    };
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.fetchRepoTree("owner", "repo", null);
    assert.ok(!result.ok);
    assert.equal(result.error.cls, "terminal:empty-repo");
    assert.equal(result.requestsSpent, 0);
  });

  it("returns error after first request if commit fails", async () => {
    const fetchStub = async () => makeResponse({ message: "Not Found" }, 404);
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.fetchRepoTree("owner", "repo", "main");
    assert.ok(!result.ok);
    assert.equal(result.requestsSpent, 1);
  });

  it("returns 2 requests on full success", async () => {
    let callCount = 0;
    const fetchStub = async () => {
      callCount += 1;
      if (callCount === 1) {
        return makeResponse({ sha: "commit123abc" }, 200);
      }
      return makeResponse(
        {
          truncated: false,
          tree: [
            { path: "fonts/Font.ttf", sha: "blob123", size: 50000, type: "blob" },
          ],
        },
        200,
      );
    };
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.fetchRepoTree("owner", "repo", "main");
    assert.ok(result.ok);
    assert.equal(result.tree.requestsSpent, 2);
    assert.equal(result.tree.commitSha, "commit123abc");
    assert.equal(result.tree.fonts.length, 1);
  });

  it("pins asset URL ref to commitSha, not the branch", async () => {
    let callCount = 0;
    const fetchStub = async () => {
      callCount += 1;
      if (callCount === 1) {
        return makeResponse({ sha: "deadbeef1234567890" }, 200);
      }
      return makeResponse(
        {
          truncated: false,
          tree: [
            { path: "fonts/Font.ttf", sha: "blobsha", size: 50000, type: "blob" },
          ],
        },
        200,
      );
    };
    const client = makeClient(fetchStub as unknown as typeof globalThis.fetch);
    const result = await client.fetchRepoTree("owner", "repo", "main");
    assert.ok(result.ok);
    // The commitSha should be the resolved sha, not the branch name
    assert.equal(result.tree.commitSha, "deadbeef1234567890");
    assert.notEqual(result.tree.commitSha, "main");
  });
});
