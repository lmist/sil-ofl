/**
 * asset-verify.ts — beads silofl-qiy.10
 *
 * Asset health verification: ranged HTTP requests against CDN/raw URLs to
 * confirm rewritten assets actually resolve.
 *
 * Design decisions
 * ----------------
 * 1. fetch is injected as a plain async function so tests stub it without
 *    any network. The type uses the minimal call signature, not typeof fetch,
 *    to avoid Bun-specific preconnect property requirements in tests.
 * 2. Range: bytes=0-1 — a minimal ranged request. 206 and 200 are healthy;
 *    everything else (403, 404, 400 …) is a failure recorded in verify_status.
 * 3. Concurrency is capped conservatively (default 8). jsDelivr and
 *    raw.githubusercontent.com are third-party services; we must not hammer
 *    them. The cap is a hard ceiling, not a suggestion.
 * 4. Ordering: unverified rows (verified_at IS NULL) go first, then recently-
 *    changed rows. This ensures the health-check sweep covers new data quickly
 *    while not skipping already-verified rows entirely.
 * 5. buildVerificationUpdate is parameterised and write-only — callers execute
 *    it, not this module.
 * 6. summariseVerification gives the non-2xx rate the data-quality suite will
 *    assert on.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal row shape needed for verification. */
export interface VerifyRow {
  id: string | number;
  cdn_url: string;
  /** verified_at IS NULL means never verified (goes first). */
  verified_at?: string | null;
}

/** Result of a single verifyAsset call. */
export interface VerifyResult {
  id: string | number;
  url: string;
  status: number;
  ok: boolean;
  elapsedMs: number;
  error?: string;
}

/** Summary across a batch. */
export interface VerificationSummary {
  total: number;
  healthy: number;
  unhealthy: number;
  /** Fraction 0–1 of non-2xx responses (errors count as non-2xx). */
  non2xxRate: number;
  /** Count per HTTP status code (or "error" for fetch failures). */
  byStatus: Record<string, number>;
}

export interface ParameterisedStatement {
  text: string;
  values: unknown[];
}

// ── Minimal fetch signature accepted by verifyAsset ─────────────────────────
// Using a structural type rather than `typeof fetch` avoids Bun-specific
// additions (e.g. `preconnect`) that break test stubs.

export type MinimalFetch = (
  url: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "status">>;

// ── Core verifier ────────────────────────────────────────────────────────────

/**
 * Issue a single ranged request against `url` and return a result.
 *
 * Treats HTTP 206 (Partial Content) and 200 (OK) as healthy.
 * Everything else — 403, 404, 400, 500 — is recorded as a failure.
 *
 * `fetchImpl` is injected so test files can stub it without any network I/O.
 * Never call this with the real `fetch` in tests.
 */
export async function verifyAsset(
  fetchImpl: MinimalFetch,
  url: string,
): Promise<VerifyResult> {
  const start = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Range: "bytes=0-1" },
    });
    const elapsedMs = Date.now() - start;
    const status = response.status;
    const ok = status === 206 || status === 200;
    return { id: 0, url, status, ok, elapsedMs };
  } catch (err) {
    const elapsedMs = Date.now() - start;
    return {
      id: 0,
      url,
      status: 0,
      ok: false,
      elapsedMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Batch verifier ────────────────────────────────────────────────────────────

export interface VerifySampleOptions {
  /**
   * Maximum number of concurrent in-flight requests.
   * Cap conservatively — default 8 — to protect the third-party CDN.
   */
  concurrency?: number;
  /**
   * Maximum number of rows to verify in this call.
   * Callers use this to bound a single sweep.
   */
  limit?: number;
}

/**
 * Verify a sample of font asset URLs with bounded concurrency.
 *
 * Ordering: unverified rows (verified_at IS NULL or empty) go first so new
 * data is covered quickly. Within each group rows are presented in the order
 * supplied (the caller controls the DB ORDER BY).
 *
 * Concurrency is hard-capped at `concurrency` (default 8). Never raises it
 * above 16 regardless of the caller's argument.
 *
 * Returns results in the order rows were processed.
 */
export async function verifySample(
  fetchImpl: MinimalFetch,
  rows: VerifyRow[],
  options: VerifySampleOptions = {},
): Promise<VerifyResult[]> {
  const concurrency = Math.min(options.concurrency ?? 8, 16);
  const limit = options.limit ?? rows.length;

  // Sort: unverified first (verified_at IS NULL), then rest.
  const sorted = [...rows]
    .sort((a, b) => {
      const aUnverified = !a.verified_at;
      const bUnverified = !b.verified_at;
      if (aUnverified && !bUnverified) return -1;
      if (!aUnverified && bUnverified) return 1;
      return 0;
    })
    .slice(0, limit);

  const results: VerifyResult[] = [];
  let cursor = 0;

  // Process rows in windows of `concurrency`.
  while (cursor < sorted.length) {
    const batch = sorted.slice(cursor, cursor + concurrency);
    cursor += batch.length;

    const batchResults = await Promise.all(
      batch.map(async (row) => {
        const result = await verifyAsset(fetchImpl, row.cdn_url);
        return { ...result, id: row.id };
      }),
    );
    results.push(...batchResults);
  }

  return results;
}

// ── SQL statement builder ────────────────────────────────────────────────────

/**
 * Build a parameterised UPDATE that writes verified_at (now()) and
 * verify_status (HTTP status) for a single row.
 *
 * status = 0 means a fetch-level error (no HTTP response).
 */
export function buildVerificationUpdate(
  id: string | number,
  status: number,
): ParameterisedStatement {
  return {
    text: `
      UPDATE font_files
      SET
        verified_at    = now(),
        verify_status  = $1::integer
      WHERE id = $2::bigint
    `.trim(),
    values: [status, String(id)],
  };
}

// ── Summary ──────────────────────────────────────────────────────────────────

/**
 * Summarise a batch of verification results.
 *
 * non2xxRate is the fraction (0–1) of results that are not healthy (status ≠
 * 206 and ≠ 200, or fetch error). This is the number the data-quality suite
 * will assert on.
 *
 * byStatus: keys are HTTP status codes as strings (e.g. "206", "404") or
 * "error" for fetch-level failures.
 */
export function summariseVerification(
  results: VerifyResult[],
): VerificationSummary {
  const total = results.length;
  if (total === 0) {
    return { total: 0, healthy: 0, unhealthy: 0, non2xxRate: 0, byStatus: {} };
  }

  const byStatus: Record<string, number> = {};
  let healthy = 0;

  for (const r of results) {
    if (r.ok) {
      healthy++;
    }
    const key = r.error && r.status === 0 ? "error" : String(r.status);
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }

  const unhealthy = total - healthy;
  return {
    total,
    healthy,
    unhealthy,
    non2xxRate: unhealthy / total,
    byStatus,
  };
}
