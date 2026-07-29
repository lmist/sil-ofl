import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { createActor } from "xstate";
import { queryKeys } from "@/lib/query-keys";
import {
  composeAbortSignals,
  fetchFontLogic,
} from "./fetch-fonts";

type PendingGraphqlRequest = {
  id: string;
  signal: AbortSignal;
};

const originalFetch = globalThis.fetch;
let activeActors: Array<ReturnType<typeof createActor>> = [];
let activeQueryClient: QueryClient | null = null;

class TrackedAbortSource {
  readonly signal: AbortSignal;
  private aborted = false;
  private abortReason: unknown;
  private readonly listeners = new Set<
    EventListenerOrEventListenerObject
  >();

  constructor() {
    const getAborted = () => this.aborted;
    const getAbortReason = () => this.abortReason;
    this.signal = {
      get aborted() {
        return getAborted();
      },
      get reason() {
        return getAbortReason();
      },
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
      ) => {
        if (type === "abort" && listener) this.listeners.add(listener);
      },
      removeEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
      ) => {
        if (type === "abort" && listener) this.listeners.delete(listener);
      },
    } as unknown as AbortSignal;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  abort(reason: unknown): void {
    if (this.aborted) return;
    this.aborted = true;
    this.abortReason = reason;
    const event = new Event("abort");
    for (const listener of [...this.listeners]) {
      if (typeof listener === "function") {
        listener.call(this.signal, event);
      } else {
        listener.handleEvent(event);
      }
    }
    this.listeners.clear();
  }
}

afterEach(() => {
  for (const actor of activeActors) actor.stop();
  activeActors = [];
  activeQueryClient?.clear();
  activeQueryClient = null;
  globalThis.fetch = originalFetch;
});

function startFontFetch(queryClient: QueryClient, id: number) {
  const actor = createActor(fetchFontLogic, {
    input: { id, queryClient },
  });
  activeActors.push(actor);
  actor.start();
  return actor;
}

async function waitForRequestCount(
  requests: PendingGraphqlRequest[],
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 250;
  while (requests.length < expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(
    requests.length,
    expected,
    `expected ${expected} network requests, received ids: ${requests
      .map(({ id }) => id)
      .join(", ")}`,
  );
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 250;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(predicate(), true, message);
}

function successfulFontResponse(id: string): Response {
  return new Response(
    JSON.stringify({
      data: {
        font: {
          id,
          cdnUrl: `https://cdn.example/${id}.woff2`,
          rawUrl: `https://raw.example/${id}.woff2`,
          format: "woff2",
          fileName: `${id}.woff2`,
          path: `${id}.woff2`,
          familyGuess: `Family ${id}`,
          weightGuess: 400,
          styleGuess: "normal",
          isVariable: false,
          isWebfont: true,
          stars: 1,
          reputation: 1,
          ownerLogin: "owner",
          fullName: "owner/repo",
          defaultBranch: "main",
          fontFileId: Number(id),
          repoId: 1,
          repoName: "repo",
          repoUrl: "https://github.com/owner/repo",
          licenseSpdx: "OFL-1.1",
          ownerType: "User",
          ownerUrl: null,
        },
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("fetchFontLogic cancellation", () => {
  it("forwards either abort source and releases every source listener", () => {
    const firstActor = new TrackedAbortSource();
    const firstQuery = new TrackedAbortSource();
    const first = composeAbortSignals(
      firstQuery.signal,
      firstActor.signal,
    );

    assert.equal(firstActor.listenerCount, 1);
    assert.equal(firstQuery.listenerCount, 1);
    const actorReason = new Error("actor superseded");
    firstActor.abort(actorReason);
    assert.equal(first.signal.aborted, true);
    assert.equal(first.signal.reason, actorReason);
    assert.equal(firstActor.listenerCount, 0);
    assert.equal(firstQuery.listenerCount, 0);

    const secondActor = new TrackedAbortSource();
    const secondQuery = new TrackedAbortSource();
    const second = composeAbortSignals(
      secondQuery.signal,
      secondActor.signal,
    );
    const queryReason = new Error("query canceled");
    secondQuery.abort(queryReason);
    assert.equal(second.signal.aborted, true);
    assert.equal(second.signal.reason, queryReason);
    assert.equal(secondActor.listenerCount, 0);
    assert.equal(secondQuery.listenerCount, 0);

    const settledActor = new TrackedAbortSource();
    const settledQuery = new TrackedAbortSource();
    const settled = composeAbortSignals(
      settledQuery.signal,
      settledActor.signal,
    );
    settled.dispose();
    assert.equal(settled.signal.aborted, false);
    assert.equal(settledActor.listenerCount, 0);
    assert.equal(settledQuery.listenerCount, 0);
  });

  it("does not deduplicate a current A request onto superseded A work", async () => {
    const requests: PendingGraphqlRequest[] = [];
    globalThis.fetch = async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const payload = (await request.clone().json()) as {
        variables?: { id?: unknown };
      };
      const id = String(payload.variables?.id);

      return new Promise<Response>((_resolve, reject) => {
        requests.push({ id, signal: request.signal });
        const rejectAbort = () => {
          reject(
            request.signal.reason ??
              new DOMException("Aborted", "AbortError"),
          );
        };
        if (request.signal.aborted) {
          rejectAbort();
          return;
        }
        request.signal.addEventListener("abort", rejectAbort, {
          once: true,
        });
      });
    };

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    activeQueryClient = queryClient;

    const firstA = startFontFetch(queryClient, 101);
    await waitForRequestCount(requests, 1);

    firstA.stop();
    const requestB = startFontFetch(queryClient, 202);
    await waitForRequestCount(requests, 2);

    requestB.stop();
    const currentA = startFontFetch(queryClient, 101);
    await waitForRequestCount(requests, 3);

    assert.deepEqual(
      requests.map(({ id }) => id),
      ["101", "202", "101"],
    );
    assert.equal(requests[0]?.signal.aborted, true);
    assert.equal(requests[1]?.signal.aborted, true);
    assert.equal(requests[2]?.signal.aborted, false);

    currentA.stop();
  });

  it("cancels retry backoff before an immediate same-id restart", async () => {
    const requests: PendingGraphqlRequest[] = [];
    globalThis.fetch = async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const payload = (await request.clone().json()) as {
        variables?: { id?: unknown };
      };
      const id = String(payload.variables?.id);
      requests.push({ id, signal: request.signal });

      if (requests.length === 1) {
        throw new TypeError("transient transport failure");
      }
      return successfulFontResponse(id);
    };

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: 1,
          retryDelay: 10_000,
        },
      },
    });
    activeQueryClient = queryClient;

    const superseded = startFontFetch(queryClient, 303);
    await waitForRequestCount(requests, 1);
    await waitUntil(
      () =>
        queryClient.getQueryState(queryKeys.font(303))
          ?.fetchFailureCount === 1,
      "the first request never entered retry backoff",
    );

    superseded.stop();
    const current = startFontFetch(queryClient, 303);
    await waitForRequestCount(requests, 2);
    await waitUntil(
      () => current.getSnapshot().status === "done",
      "the current same-id actor did not complete",
    );

    assert.deepEqual(
      requests.map(({ id }) => id),
      ["303", "303"],
    );
    assert.equal(current.getSnapshot().output?.fontFileId, 303);
  });
});
