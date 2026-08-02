/**
 * Scan failure taxonomy for the font ingest pipeline.
 *
 * Every scan attempt must produce either a success (fonts_scanned_at set) or a
 * typed error stored in repos.fonts_scan_error. This module defines the closed
 * union, classifies HTTP responses from the GitHub API, serialises the result
 * to the stable column format, and drives the retry scheduler.
 *
 * Column format: `class:code:detail`
 *   class  — one of the ScanErrorClass values below (GROUP BY-friendly)
 *   code   — numeric HTTP status or "NET" for network/timeout
 *   detail — short human-readable phrase, may contain colons but not newlines
 *
 * Example stored values:
 *   "retryable:429:primary rate limit"
 *   "retryable:403:secondary rate limit"
 *   "retryable:503:upstream unavailable"
 *   "retryable:NET:network timeout"
 *   "terminal:404:repo not found"
 *   "terminal:403:access denied"
 *   "terminal:403:dmca takedown"
 *   "terminal:empty:no default branch"
 *   "terminal:empty:empty repository"
 *   "terminal:budget:tree too large"
 *   "terminal:unsupported:unsupported"
 */

// ---------------------------------------------------------------------------
// Error class union
// ---------------------------------------------------------------------------

/** Retryable: the condition is transient and a later attempt may succeed. */
export type RetryableClass =
  | "retryable:rate-limit-primary"    // 429 or 403 with x-ratelimit-remaining: 0
  | "retryable:rate-limit-secondary"  // 403 or 429 with retry-after header
  | "retryable:server-error"          // 5xx
  | "retryable:network-timeout"       // fetch timeout / ECONNRESET / AbortError
  | "retryable:aborted";              // client-side AbortController cancel

/** Terminal: no retry will help; mark the repo and move on. */
export type TerminalClass =
  | "terminal:not-found"      // 404 — repo deleted or moved
  | "terminal:access-denied"  // 403 — DMCA, private, or organisation block (not rate limit)
  | "terminal:empty-repo"     // no default branch or empty tree
  | "terminal:tree-truncated" // tree > budget; would produce an incomplete picture
  | "terminal:unsupported";   // any other unrecoverable condition

export type ScanErrorClass = RetryableClass | TerminalClass;

// Stable mapping from ScanErrorClass → the "class" segment in the column.
// This is the group key; keep it short and stable across refactors.
const CLASS_SEGMENT: Record<ScanErrorClass, string> = {
  "retryable:rate-limit-primary":   "retryable",
  "retryable:rate-limit-secondary": "retryable",
  "retryable:server-error":         "retryable",
  "retryable:network-timeout":      "retryable",
  "retryable:aborted":              "retryable",
  "terminal:not-found":             "terminal",
  "terminal:access-denied":         "terminal",
  "terminal:empty-repo":            "terminal",
  "terminal:tree-truncated":        "terminal",
  "terminal:unsupported":           "terminal",
};

export function isRetryable(cls: ScanErrorClass): boolean {
  return CLASS_SEGMENT[cls] === "retryable";
}

export function isTerminal(cls: ScanErrorClass): boolean {
  return CLASS_SEGMENT[cls] === "terminal";
}

// ---------------------------------------------------------------------------
// Structured scan error
// ---------------------------------------------------------------------------

export interface ScanError {
  readonly cls: ScanErrorClass;
  /**
   * HTTP status code as a string, "NET" for network errors, or "empty" /
   * "budget" / "unsupported" for non-HTTP terminal conditions.
   */
  readonly code: string;
  /** Short human-readable phrase. Must not contain newlines. */
  readonly detail: string;
  /**
   * retry-after value in seconds, when the server supplied one.
   * Only meaningful for retryable classes.
   */
  readonly retryAfterSeconds?: number;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface ClassifyInput {
  /** HTTP status code (or 0 for network errors). */
  status: number;
  /** Value of the x-ratelimit-remaining response header, if present. */
  rateLimitRemaining?: string | null;
  /** Value of the retry-after response header, if present (seconds or HTTP date). */
  retryAfter?: string | null;
  /** GitHub error message body, e.g. from the JSON `message` field. */
  body?: string | null;
}

/**
 * Map an HTTP response (plus optional GitHub-specific headers/body) to a
 * ScanError.
 *
 * GitHub rate-limit disambiguation:
 *   Primary rate limit:   403 or 429 WITH x-ratelimit-remaining: 0
 *   Secondary rate limit: 403 or 429 WITH retry-after header (and remaining may be > 0)
 *   Genuine 403:          403 WITHOUT either of the above signals
 *
 * We must not confuse rate limits with DMCA/access denials. The order of
 * checks below is intentional: secondary (retry-after) is checked first
 * because it is more specific; then primary (remaining=0); then genuine deny.
 */
export function classifyScanError(input: ClassifyInput): ScanError {
  const { status, rateLimitRemaining, retryAfter, body } = input;

  // --- Network / client abort ---
  if (status === 0) {
    const lc = (body ?? "").toLowerCase();
    if (lc.includes("abort") || lc.includes("cancel")) {
      return { cls: "retryable:aborted", code: "NET", detail: "aborted" };
    }
    return { cls: "retryable:network-timeout", code: "NET", detail: "network timeout" };
  }

  // --- 429 / 403 rate-limit handling ---
  if (status === 429 || status === 403) {
    const retryAfterSecs = parseRetryAfter(retryAfter);
    // Secondary rate limit: server sent retry-after (regardless of remaining)
    if (retryAfterSecs !== null) {
      return {
        cls: "retryable:rate-limit-secondary",
        code: String(status),
        detail: "secondary rate limit",
        retryAfterSeconds: retryAfterSecs,
      };
    }
    // Primary rate limit: x-ratelimit-remaining is 0
    if (rateLimitRemaining === "0") {
      return {
        cls: "retryable:rate-limit-primary",
        code: String(status),
        detail: "primary rate limit",
      };
    }
    // Genuine 403: DMCA, private repo, org SSO block, etc.
    if (status === 403) {
      const lc = (body ?? "").toLowerCase();
      const detail = lc.includes("dmca") ? "dmca takedown" : "access denied";
      return { cls: "terminal:access-denied", code: "403", detail };
    }
    // 429 without retry-after or ratelimit-remaining=0 — treat as primary
    return {
      cls: "retryable:rate-limit-primary",
      code: "429",
      detail: "primary rate limit",
    };
  }

  // --- 404 ---
  if (status === 404) {
    return { cls: "terminal:not-found", code: "404", detail: "repo not found" };
  }

  // --- 5xx ---
  if (status >= 500 && status <= 599) {
    return {
      cls: "retryable:server-error",
      code: String(status),
      detail: "upstream server error",
    };
  }

  // --- Anything else we don't know how to recover from ---
  return {
    cls: "terminal:unsupported",
    code: String(status),
    detail: `unexpected status ${status}`,
  };
}

/**
 * Classify a non-HTTP terminal condition: empty repo, missing branch, or tree
 * too large to scan within budget.
 */
export function classifyStructuralError(
  kind: "no-default-branch" | "empty-repo" | "tree-truncated",
): ScanError {
  switch (kind) {
    case "no-default-branch":
      return { cls: "terminal:empty-repo", code: "empty", detail: "no default branch" };
    case "empty-repo":
      return { cls: "terminal:empty-repo", code: "empty", detail: "empty repository" };
    case "tree-truncated":
      return { cls: "terminal:tree-truncated", code: "budget", detail: "tree too large" };
  }
}

// ---------------------------------------------------------------------------
// Serialiser / parser  (round-trip of repos.fonts_scan_error)
// ---------------------------------------------------------------------------

/**
 * Serialise a ScanError to the stable column string written to
 * repos.fonts_scan_error.  Format: `class:code:detail`
 *
 * The first colon-segment is the grouping key. Operators can do:
 *   SELECT class_seg, count(*) FROM repos
 *   WHERE fonts_scan_error IS NOT NULL
 *   GROUP BY split_part(fonts_scan_error, ':', 1)
 */
export function serialiseScanError(err: ScanError): string {
  const segment = CLASS_SEGMENT[err.cls];
  // Sanitise detail: strip newlines, keep colons (they are fine after the 3rd segment)
  const detail = err.detail.replace(/[\r\n]/g, " ");
  return `${segment}:${err.code}:${detail}`;
}

export interface ParsedScanError {
  classSegment: string; // "retryable" | "terminal"
  code: string;
  detail: string;
  raw: string;
}

/**
 * Parse a value from repos.fonts_scan_error back to its parts.
 * Returns null for rows that are NULL or in an unrecognised format.
 */
export function parseScanError(value: string | null | undefined): ParsedScanError | null {
  if (value == null) return null;
  // Split on first two colons only; detail may contain colons
  const firstColon = value.indexOf(":");
  if (firstColon === -1) return null;
  const secondColon = value.indexOf(":", firstColon + 1);
  if (secondColon === -1) return null;
  return {
    classSegment: value.slice(0, firstColon),
    code: value.slice(firstColon + 1, secondColon),
    detail: value.slice(secondColon + 1),
    raw: value,
  };
}

/**
 * Return true when a stored fonts_scan_error value represents a condition the
 * scan worker should retry on the next queue drain.
 */
export function isRetryableError(storedValue: string | null | undefined): boolean {
  const parsed = parseScanError(storedValue);
  return parsed?.classSegment === "retryable";
}

// ---------------------------------------------------------------------------
// Retry scheduler
// ---------------------------------------------------------------------------

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 5 * 60 * 1_000; // 5 minutes
const JITTER_FRACTION = 0.2; // ±20 %

/**
 * Compute the delay in milliseconds before the next retry attempt.
 *
 * Rules:
 *   - Terminal classes: returns null (never retry).
 *   - retry-after present: honour it (with a small jitter cap at ±20%).
 *   - Otherwise: bounded exponential backoff starting at BASE_DELAY_MS,
 *     capped at MAX_DELAY_MS, with ±20% jitter.
 *
 * `attempt` is 0-indexed (first failure = 0).
 */
export function nextRetryDelayMs(
  attempt: number,
  error: ScanError,
  rng: () => number = Math.random,
): number | null {
  if (isTerminal(error.cls)) return null;

  if (error.retryAfterSeconds !== undefined && error.retryAfterSeconds > 0) {
    // Honour server-supplied retry-after with a small jitter (±20%) to spread
    // thundering-herd when many workers hit the limit simultaneously.
    const base = error.retryAfterSeconds * 1_000;
    const jitter = base * JITTER_FRACTION * (rng() * 2 - 1);
    return Math.max(BASE_DELAY_MS, Math.round(base + jitter));
  }

  // Bounded exponential backoff: BASE * 2^attempt, capped, with ±20% jitter.
  const expo = BASE_DELAY_MS * Math.pow(2, attempt);
  const capped = Math.min(expo, MAX_DELAY_MS);
  const jitter = capped * JITTER_FRACTION * (rng() * 2 - 1);
  return Math.max(BASE_DELAY_MS, Math.round(capped + jitter));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a retry-after header value to seconds.
 * Accepts both integer-second strings ("30") and HTTP-date strings.
 * Returns null if the header is absent, empty, or unparseable.
 */
function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value || value.trim() === "") return null;
  const trimmed = value.trim();
  // Integer seconds
  if (/^\d+$/.test(trimmed)) {
    const secs = parseInt(trimmed, 10);
    return secs > 0 ? secs : null;
  }
  // HTTP-date (e.g. "Sat, 02 Aug 2026 03:00:00 GMT")
  const ts = Date.parse(trimmed);
  if (!Number.isNaN(ts)) {
    const diffSecs = Math.round((ts - Date.now()) / 1_000);
    return diffSecs > 0 ? diffSecs : 1; // always at least 1 second
  }
  return null;
}
