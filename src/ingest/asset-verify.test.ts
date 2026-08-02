/**
 * asset-verify.test.ts — beads silofl-qiy.10
 *
 * Pure, offline tests. No network. fetch is always stubbed.
 * Uses node:test + node:assert/strict.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  verifyAsset,
  verifySample,
  buildVerificationUpdate,
  summariseVerification,
  type MinimalFetch,
  type VerifyRow,
  type VerifyResult,
} from "./asset-verify.js";

// ── Stub helpers ─────────────────────────────────────────────────────────────

/** Build a fetch stub that always returns the given HTTP status. */
function stubFetch(status: number): MinimalFetch {
  return async () => {
    return { status };
  };
}

/** Build a fetch stub that always throws (simulates network error). */
function failingFetch(): MinimalFetch {
  return async () => {
    throw new Error("network failure");
  };
}

/** Build a fetch stub that records every call and returns the given status. */
function recordingFetch(
  status: number,
): { fetch: MinimalFetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: MinimalFetch = async (url) => {
    calls.push(String(url));
    return { status };
  };
  return { fetch: fetchImpl, calls };
}

/** Build a fetch stub that records request headers. */
function headerCapturingFetch(): {
  fetch: MinimalFetch;
  headers: Record<string, string>[];
} {
  const headers: Record<string, string>[] = [];
  const fetchImpl: MinimalFetch = async (_url, init) => {
    headers.push((init?.headers as Record<string, string>) ?? {});
    return { status: 206 };
  };
  return { fetch: fetchImpl, headers };
}

const CDN_URL = "https://cdn.jsdelivr.net/gh/some/font@abc123/font.ttf";

// ── verifyAsset ──────────────────────────────────────────────────────────────

describe("verifyAsset", () => {
  it("returns ok=true and status=206 for a 206 response", async () => {
    const result = await verifyAsset(stubFetch(206), CDN_URL);
    assert.ok(result.ok);
    assert.equal(result.status, 206);
    assert.ok(result.elapsedMs >= 0);
    assert.equal(result.url, CDN_URL);
  });

  it("returns ok=true and status=200 for a 200 response", async () => {
    const result = await verifyAsset(stubFetch(200), CDN_URL);
    assert.ok(result.ok);
    assert.equal(result.status, 200);
  });

  it("returns ok=false and status=404 for a 404 response", async () => {
    const result = await verifyAsset(stubFetch(404), CDN_URL);
    assert.ok(!result.ok);
    assert.equal(result.status, 404);
  });

  it("returns ok=false and status=403 for a 403 response (CDN size limit)", async () => {
    const result = await verifyAsset(stubFetch(403), CDN_URL);
    assert.ok(!result.ok);
    assert.equal(result.status, 403);
  });

  it("returns ok=false and status=400 for a 400 response (non-ASCII path)", async () => {
    const result = await verifyAsset(stubFetch(400), CDN_URL);
    assert.ok(!result.ok);
    assert.equal(result.status, 400);
  });

  it("returns ok=false, status=0, and error message on network failure", async () => {
    const result = await verifyAsset(failingFetch(), CDN_URL);
    assert.ok(!result.ok);
    assert.equal(result.status, 0);
    assert.ok(result.error?.includes("network failure"));
  });

  it("sends a Range: bytes=0-1 header", async () => {
    const { fetch: f, headers } = headerCapturingFetch();
    await verifyAsset(f, CDN_URL);
    assert.equal(headers[0]!["Range"], "bytes=0-1");
  });
});

// ── verifySample ─────────────────────────────────────────────────────────────

function makeRow(id: number, verified_at?: string | null): VerifyRow {
  return {
    id: String(id),
    cdn_url: `https://cdn.jsdelivr.net/gh/owner/repo@sha${id}/file${id}.ttf`,
    verified_at: verified_at ?? null,
  };
}

describe("verifySample", () => {
  it("returns one result per row", async () => {
    const rows: VerifyRow[] = [makeRow(1), makeRow(2), makeRow(3)];
    const results = await verifySample(stubFetch(206), rows);
    assert.equal(results.length, 3);
  });

  it("respects the limit option", async () => {
    const rows: VerifyRow[] = [makeRow(1), makeRow(2), makeRow(3), makeRow(4)];
    const results = await verifySample(stubFetch(206), rows, { limit: 2 });
    assert.equal(results.length, 2);
  });

  it("puts unverified rows first (verified_at IS NULL)", async () => {
    // row 1 is verified, row 2 is not
    const rows: VerifyRow[] = [
      makeRow(1, "2026-08-01T00:00:00Z"),
      makeRow(2, null),
    ];
    const { fetch: f, calls } = recordingFetch(206);
    await verifySample(f, rows);
    // row 2 (unverified) should be fetched first
    assert.ok(
      calls[0]!.includes("file2.ttf"),
      `expected unverified row first, got: ${calls[0]}`,
    );
  });

  it("caps concurrency at 16 even when a higher value is requested", async () => {
    // Cannot observe concurrency directly, but we can confirm the function
    // accepts the argument and processes all rows correctly.
    const rows: VerifyRow[] = Array.from({ length: 20 }, (_, i) =>
      makeRow(i),
    );
    const results = await verifySample(stubFetch(206), rows, {
      concurrency: 100, // should be capped to 16
    });
    assert.equal(results.length, 20);
  });

  it("propagates row id onto each result", async () => {
    const rows: VerifyRow[] = [makeRow(42)];
    const results = await verifySample(stubFetch(206), rows);
    assert.equal(results[0]!.id, "42");
  });

  it("handles an empty row array gracefully", async () => {
    const results = await verifySample(stubFetch(206), []);
    assert.equal(results.length, 0);
  });

  it("records failures for rows that return 404", async () => {
    const rows: VerifyRow[] = [makeRow(1), makeRow(2)];
    const results = await verifySample(stubFetch(404), rows);
    assert.ok(results.every((r) => !r.ok));
    assert.ok(results.every((r) => r.status === 404));
  });
});

// ── buildVerificationUpdate ───────────────────────────────────────────────────

describe("buildVerificationUpdate", () => {
  it("writes verify_status and verified_at", () => {
    const stmt = buildVerificationUpdate("123", 206);
    assert.ok(stmt.text.includes("verified_at"));
    assert.ok(stmt.text.includes("verify_status"));
    assert.equal(stmt.values[0], 206);
    assert.equal(stmt.values[1], "123");
  });

  it("accepts numeric id", () => {
    const stmt = buildVerificationUpdate(456, 404);
    assert.equal(stmt.values[1], "456");
    assert.equal(stmt.values[0], 404);
  });

  it("stores status=0 for network-level errors", () => {
    const stmt = buildVerificationUpdate("789", 0);
    assert.equal(stmt.values[0], 0);
  });
});

// ── summariseVerification ─────────────────────────────────────────────────────

function makeResult(
  id: number,
  status: number,
  error?: string,
): VerifyResult {
  return {
    id: String(id),
    url: `https://cdn.jsdelivr.net/gh/o/r@sha/f${id}.ttf`,
    status,
    ok: status === 206 || status === 200,
    elapsedMs: 10,
    error,
  };
}

describe("summariseVerification", () => {
  it("returns zeros for an empty result set", () => {
    const s = summariseVerification([]);
    assert.equal(s.total, 0);
    assert.equal(s.non2xxRate, 0);
  });

  it("computes 0% non-2xx rate when all results are 206", () => {
    const results = [makeResult(1, 206), makeResult(2, 206), makeResult(3, 206)];
    const s = summariseVerification(results);
    assert.equal(s.total, 3);
    assert.equal(s.healthy, 3);
    assert.equal(s.unhealthy, 0);
    assert.equal(s.non2xxRate, 0);
  });

  it("computes 100% non-2xx rate when all results fail", () => {
    const results = [makeResult(1, 404), makeResult(2, 403)];
    const s = summariseVerification(results);
    assert.equal(s.non2xxRate, 1);
    assert.equal(s.healthy, 0);
  });

  it("computes fractional non-2xx rate correctly", () => {
    const results = [
      makeResult(1, 206),
      makeResult(2, 206),
      makeResult(3, 404),
      makeResult(4, 403),
    ];
    const s = summariseVerification(results);
    assert.equal(s.total, 4);
    assert.equal(s.healthy, 2);
    assert.equal(s.non2xxRate, 0.5);
  });

  it("groups results by status code in byStatus", () => {
    const results = [
      makeResult(1, 206),
      makeResult(2, 206),
      makeResult(3, 404),
    ];
    const s = summariseVerification(results);
    assert.equal(s.byStatus["206"], 2);
    assert.equal(s.byStatus["404"], 1);
  });

  it("counts network errors under 'error' key in byStatus", () => {
    const results = [makeResult(1, 0, "network failure")];
    const s = summariseVerification(results);
    assert.equal(s.byStatus["error"], 1);
    assert.equal(s.unhealthy, 1);
  });

  it("counts 200 as healthy", () => {
    const results = [makeResult(1, 200)];
    const s = summariseVerification(results);
    assert.equal(s.healthy, 1);
    assert.equal(s.non2xxRate, 0);
  });
});
