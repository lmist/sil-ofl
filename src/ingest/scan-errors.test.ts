/**
 * Tests for src/ingest/scan-errors.ts
 *
 * All tests are pure and offline — no network, no database.
 * Style: node:test / node:assert/strict, matching the house test convention.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyScanError,
  classifyStructuralError,
  isRetryable,
  isTerminal,
  nextRetryDelayMs,
  parseScanError,
  serialiseScanError,
  isRetryableError,
  type ScanError,
} from "./scan-errors";

// ---------------------------------------------------------------------------
// classifyScanError — each class
// ---------------------------------------------------------------------------

describe("classifyScanError", () => {
  describe("primary rate limit", () => {
    it("classifies 429 with ratelimit-remaining=0 as primary rate limit", () => {
      const err = classifyScanError({ status: 429, rateLimitRemaining: "0" });
      assert.equal(err.cls, "retryable:rate-limit-primary");
      assert.equal(err.code, "429");
    });

    it("classifies 403 with ratelimit-remaining=0 (and no retry-after) as primary rate limit", () => {
      const err = classifyScanError({ status: 403, rateLimitRemaining: "0" });
      assert.equal(err.cls, "retryable:rate-limit-primary");
      assert.equal(err.code, "403");
    });

    it("classifies 429 without any rate-limit headers as primary rate limit", () => {
      const err = classifyScanError({ status: 429 });
      assert.equal(err.cls, "retryable:rate-limit-primary");
    });
  });

  describe("secondary rate limit — retry-after header wins over ratelimit-remaining", () => {
    it("classifies 403 with retry-after as secondary rate limit", () => {
      const err = classifyScanError({
        status: 403,
        retryAfter: "60",
        rateLimitRemaining: "4999", // still has quota — secondary, not primary
      });
      assert.equal(err.cls, "retryable:rate-limit-secondary");
      assert.equal(err.retryAfterSeconds, 60);
    });

    it("classifies 429 with retry-after as secondary rate limit", () => {
      const err = classifyScanError({ status: 429, retryAfter: "30" });
      assert.equal(err.cls, "retryable:rate-limit-secondary");
      assert.equal(err.retryAfterSeconds, 30);
    });

    it("parses HTTP-date retry-after", () => {
      // Use a date far in the future so the diff is always positive
      const futureDate = new Date(Date.now() + 120_000).toUTCString();
      const err = classifyScanError({ status: 429, retryAfter: futureDate });
      assert.equal(err.cls, "retryable:rate-limit-secondary");
      assert.ok(typeof err.retryAfterSeconds === "number");
      assert.ok(err.retryAfterSeconds! > 0);
    });
  });

  describe("403 access denied — must not be confused with rate limits", () => {
    it("classifies 403 with no rate-limit signals as terminal access-denied", () => {
      const err = classifyScanError({ status: 403 });
      assert.equal(err.cls, "terminal:access-denied");
      assert.equal(err.code, "403");
    });

    it("classifies 403 with DMCA body as access-denied with dmca detail", () => {
      const err = classifyScanError({
        status: 403,
        body: "Repository access blocked. This repository has been disabled for DMCA takedown.",
      });
      assert.equal(err.cls, "terminal:access-denied");
      assert.ok(err.detail.includes("dmca"));
    });

    it("classifies 403 with remaining=5 and no retry-after as terminal (not rate limit)", () => {
      // remaining=5 means the rate limit is not hit; no retry-after means not secondary
      const err = classifyScanError({
        status: 403,
        rateLimitRemaining: "5",
      });
      assert.equal(err.cls, "terminal:access-denied");
    });
  });

  describe("404 — terminal not-found", () => {
    it("classifies 404 as terminal not-found", () => {
      const err = classifyScanError({ status: 404 });
      assert.equal(err.cls, "terminal:not-found");
      assert.equal(err.code, "404");
    });
  });

  describe("5xx — retryable server errors", () => {
    for (const status of [500, 502, 503, 504]) {
      it(`classifies ${status} as retryable server-error`, () => {
        const err = classifyScanError({ status });
        assert.equal(err.cls, "retryable:server-error");
        assert.equal(err.code, String(status));
      });
    }
  });

  describe("network / abort", () => {
    it("classifies status=0 with no body as network-timeout", () => {
      const err = classifyScanError({ status: 0 });
      assert.equal(err.cls, "retryable:network-timeout");
      assert.equal(err.code, "NET");
    });

    it("classifies status=0 with abort body as aborted", () => {
      const err = classifyScanError({ status: 0, body: "AbortError: cancelled" });
      assert.equal(err.cls, "retryable:aborted");
    });
  });

  describe("unsupported fallback", () => {
    it("classifies unknown status as terminal:unsupported", () => {
      const err = classifyScanError({ status: 418 });
      assert.equal(err.cls, "terminal:unsupported");
    });
  });
});

describe("classifyStructuralError", () => {
  it("no-default-branch → terminal:empty-repo", () => {
    const err = classifyStructuralError("no-default-branch");
    assert.equal(err.cls, "terminal:empty-repo");
    assert.equal(err.code, "empty");
  });

  it("empty-repo → terminal:empty-repo", () => {
    const err = classifyStructuralError("empty-repo");
    assert.equal(err.cls, "terminal:empty-repo");
  });

  it("tree-truncated → terminal:tree-truncated", () => {
    const err = classifyStructuralError("tree-truncated");
    assert.equal(err.cls, "terminal:tree-truncated");
    assert.equal(err.code, "budget");
  });
});

// ---------------------------------------------------------------------------
// isRetryable / isTerminal
// ---------------------------------------------------------------------------

describe("isRetryable / isTerminal", () => {
  const retryable: ScanError["cls"][] = [
    "retryable:rate-limit-primary",
    "retryable:rate-limit-secondary",
    "retryable:server-error",
    "retryable:network-timeout",
    "retryable:aborted",
  ];
  const terminal: ScanError["cls"][] = [
    "terminal:not-found",
    "terminal:access-denied",
    "terminal:empty-repo",
    "terminal:tree-truncated",
    "terminal:unsupported",
  ];

  for (const cls of retryable) {
    it(`isRetryable(${cls}) === true`, () => {
      assert.ok(isRetryable(cls));
      assert.ok(!isTerminal(cls));
    });
  }

  for (const cls of terminal) {
    it(`isTerminal(${cls}) === true`, () => {
      assert.ok(isTerminal(cls));
      assert.ok(!isRetryable(cls));
    });
  }
});

// ---------------------------------------------------------------------------
// Serialiser / parser round-trip
// ---------------------------------------------------------------------------

describe("serialiseScanError / parseScanError round-trip", () => {
  const cases: Array<{ name: string; err: ScanError }> = [
    {
      name: "primary rate limit 429",
      err: { cls: "retryable:rate-limit-primary", code: "429", detail: "primary rate limit" },
    },
    {
      name: "secondary rate limit with retry-after",
      err: {
        cls: "retryable:rate-limit-secondary",
        code: "403",
        detail: "secondary rate limit",
        retryAfterSeconds: 60,
      },
    },
    {
      name: "network timeout",
      err: { cls: "retryable:network-timeout", code: "NET", detail: "network timeout" },
    },
    {
      name: "terminal 404",
      err: { cls: "terminal:not-found", code: "404", detail: "repo not found" },
    },
    {
      name: "terminal access denied",
      err: { cls: "terminal:access-denied", code: "403", detail: "access denied" },
    },
    {
      name: "terminal dmca",
      err: { cls: "terminal:access-denied", code: "403", detail: "dmca takedown" },
    },
    {
      name: "empty repo",
      err: { cls: "terminal:empty-repo", code: "empty", detail: "empty repository" },
    },
    {
      name: "tree truncated",
      err: { cls: "terminal:tree-truncated", code: "budget", detail: "tree too large" },
    },
  ];

  for (const { name, err } of cases) {
    it(`round-trips: ${name}`, () => {
      const serialised = serialiseScanError(err);
      // Must start with "retryable:" or "terminal:"
      assert.ok(
        serialised.startsWith("retryable:") || serialised.startsWith("terminal:"),
        `serialised form should start with class segment: ${serialised}`,
      );
      // Must be parseable
      const parsed = parseScanError(serialised);
      assert.ok(parsed !== null, `parseScanError should not return null for: ${serialised}`);
      assert.ok(
        parsed!.classSegment === "retryable" || parsed!.classSegment === "terminal",
      );
      assert.equal(parsed!.code, err.code);
      assert.equal(parsed!.detail, err.detail.replace(/[\r\n]/g, " "));
    });
  }

  it("serialised form has no newlines (greppable, GROUP BY safe)", () => {
    const err: ScanError = {
      cls: "terminal:not-found",
      code: "404",
      detail: "line1\nline2",
    };
    const s = serialiseScanError(err);
    assert.ok(!s.includes("\n") && !s.includes("\r"));
  });

  it("parseScanError returns null for null input", () => {
    assert.equal(parseScanError(null), null);
    assert.equal(parseScanError(undefined), null);
    assert.equal(parseScanError(""), null);
    assert.equal(parseScanError("no-colons-here"), null);
  });

  it("parseScanError returns null for one-segment input", () => {
    assert.equal(parseScanError("retryable"), null);
  });

  it("GROUP BY on first segment works — detail may contain colons", () => {
    // The first colon-separated segment must be stable
    const err: ScanError = {
      cls: "terminal:unsupported",
      code: "418",
      detail: "unexpected:colons:in:detail",
    };
    const s = serialiseScanError(err);
    const parsed = parseScanError(s);
    assert.equal(parsed!.classSegment, "terminal");
    assert.equal(parsed!.code, "418");
    assert.equal(parsed!.detail, "unexpected:colons:in:detail");
  });
});

describe("isRetryableError (stored column value)", () => {
  it("returns true for a retryable serialised error", () => {
    const stored = serialiseScanError({
      cls: "retryable:rate-limit-primary",
      code: "429",
      detail: "primary rate limit",
    });
    assert.ok(isRetryableError(stored));
  });

  it("returns false for a terminal serialised error", () => {
    const stored = serialiseScanError({
      cls: "terminal:not-found",
      code: "404",
      detail: "repo not found",
    });
    assert.ok(!isRetryableError(stored));
  });

  it("returns false for null", () => {
    assert.ok(!isRetryableError(null));
  });
});

// ---------------------------------------------------------------------------
// nextRetryDelayMs
// ---------------------------------------------------------------------------

describe("nextRetryDelayMs", () => {
  const retryableErr: ScanError = {
    cls: "retryable:server-error",
    code: "503",
    detail: "upstream server error",
  };

  it("returns null for terminal errors — never retry", () => {
    const terminalErr: ScanError = {
      cls: "terminal:not-found",
      code: "404",
      detail: "repo not found",
    };
    assert.equal(nextRetryDelayMs(0, terminalErr), null);
    assert.equal(nextRetryDelayMs(10, terminalErr), null);
  });

  it("honours retry-after from the server", () => {
    const err: ScanError = {
      cls: "retryable:rate-limit-secondary",
      code: "403",
      detail: "secondary rate limit",
      retryAfterSeconds: 120,
    };
    // Deterministic rng returning 0 → jitter = -20% of base
    const delay = nextRetryDelayMs(0, err, () => 0);
    // base=120_000ms, jitter=-24_000ms → 96_000ms
    assert.ok(delay !== null);
    assert.ok(delay! >= 96_000 && delay! <= 144_000, `delay=${delay} out of ±20% band`);
  });

  it("backoff is monotonically non-decreasing (median, no jitter)", () => {
    // Use rng=0.5 → jitter = 0 (midpoint)
    const delays = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((attempt) =>
      nextRetryDelayMs(attempt, retryableErr, () => 0.5),
    );
    for (let i = 1; i < delays.length; i++) {
      assert.ok(
        delays[i]! >= delays[i - 1]!,
        `attempt ${i}: ${delays[i]} < ${delays[i - 1]}`,
      );
    }
  });

  it("backoff is bounded by MAX_DELAY_MS (5 minutes)", () => {
    const MAX_DELAY_MS = 5 * 60 * 1_000;
    // rng=1 → maximum jitter = +20%
    const delay = nextRetryDelayMs(100, retryableErr, () => 1);
    assert.ok(delay !== null);
    // With +20% jitter at the cap, the max is MAX * 1.2
    assert.ok(delay! <= MAX_DELAY_MS * 1.2, `delay=${delay} exceeds cap with jitter`);
  });

  it("minimum delay is at least 1000 ms (BASE_DELAY_MS)", () => {
    // rng=0 → maximum negative jitter at attempt=0
    const delay = nextRetryDelayMs(0, retryableErr, () => 0);
    assert.ok(delay !== null);
    assert.ok(delay! >= 1_000, `delay=${delay} is below 1000ms floor`);
  });

  it("all retryable classes produce a positive delay at attempt=0", () => {
    const retryableClasses: ScanError["cls"][] = [
      "retryable:rate-limit-primary",
      "retryable:rate-limit-secondary",
      "retryable:server-error",
      "retryable:network-timeout",
      "retryable:aborted",
    ];
    for (const cls of retryableClasses) {
      const err: ScanError = { cls, code: "0", detail: "test" };
      const delay = nextRetryDelayMs(0, err);
      assert.ok(delay !== null, `${cls} should be retryable`);
      assert.ok(delay! > 0, `${cls} delay should be positive`);
    }
  });

  it("all terminal classes return null", () => {
    const terminalClasses: ScanError["cls"][] = [
      "terminal:not-found",
      "terminal:access-denied",
      "terminal:empty-repo",
      "terminal:tree-truncated",
      "terminal:unsupported",
    ];
    for (const cls of terminalClasses) {
      const err: ScanError = { cls, code: "0", detail: "test" };
      assert.equal(nextRetryDelayMs(0, err), null, `${cls} should not retry`);
    }
  });
});
