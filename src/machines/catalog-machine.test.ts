/**
 * Pure createActor unit tests for catalogMachine.
 * Run: bun test src/machines/catalog-machine.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createActor, fromPromise, SimulatedClock } from "xstate";
import {
  catalogMachine,
  CATALOG_Q_DEBOUNCE_MS,
  toFontsFilter,
  type CatalogContext,
} from "./catalog-machine";
import type { FontConnection } from "../types/catalog";

const emptyConnection: FontConnection = {
  edges: [],
  pageInfo: { hasNextPage: false, endCursor: null },
  totalCount: 0,
};

function createTestCatalog(options?: {
  clock?: SimulatedClock;
  connection?: FontConnection;
  fail?: boolean;
  error?: unknown;
}) {
  const clock = options?.clock ?? new SimulatedClock();
  const connection = options?.connection ?? emptyConnection;
  const machine = catalogMachine.provide({
    actors: {
      loadFonts: fromPromise(async () => {
        if (options?.fail) {
          throw options.error ?? new Error("network boom");
        }
        return connection;
      }),
    },
  });
  const actor = createActor(machine, { clock, input: {} });
  actor.start();
  return { actor, clock };
}

describe("catalogMachine", () => {
  it("starts in ready and maps default filter", () => {
    const { actor } = createTestCatalog();
    const snap = actor.getSnapshot();
    assert.equal(snap.value, "ready");
    assert.equal(snap.context.q, "");
    assert.equal(snap.context.after, null);
    assert.deepEqual(snap.context.cursorStack, []);
    assert.deepEqual(toFontsFilter(snap.context as CatalogContext).first, 50);
  });

  it("debounces SET_Q via delayed transition (not immediate ready)", () => {
    const clock = new SimulatedClock();
    const { actor } = createTestCatalog({ clock });

    actor.send({ type: "SET_Q", q: "cha" });
    assert.equal(actor.getSnapshot().value, "debouncing_q");
    assert.equal(actor.getSnapshot().context.q, "cha");

    clock.increment(CATALOG_Q_DEBOUNCE_MS - 10);
    assert.equal(actor.getSnapshot().value, "debouncing_q");

    clock.increment(20);
    assert.equal(actor.getSnapshot().value, "ready");
    assert.equal(actor.getSnapshot().context.q, "cha");
  });

  it("resets debounce timer when SET_Q re-enters debouncing_q", () => {
    const clock = new SimulatedClock();
    const { actor } = createTestCatalog({ clock });

    actor.send({ type: "SET_Q", q: "a" });
    clock.increment(100);
    actor.send({ type: "SET_Q", q: "ab" });
    clock.increment(100);
    // Would have fired if timer were not reset (175ms from first keystroke).
    assert.equal(actor.getSnapshot().value, "debouncing_q");
    clock.increment(80);
    assert.equal(actor.getSnapshot().value, "ready");
    assert.equal(actor.getSnapshot().context.q, "ab");
  });

  it("paginates with cursor stack NEXT / PREV / GO_FIRST", async () => {
    const { actor } = createTestCatalog();
    await new Promise((resolve) => setTimeout(resolve, 0));

    actor.send({ type: "NEXT_PAGE", endCursor: "c1" });
    assert.equal(actor.getSnapshot().context.after, "c1");
    assert.deepEqual(actor.getSnapshot().context.cursorStack, [""]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    actor.send({ type: "NEXT_PAGE", endCursor: "c2" });
    assert.equal(actor.getSnapshot().context.after, "c2");
    assert.deepEqual(actor.getSnapshot().context.cursorStack, ["", "c1"]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    actor.send({ type: "PREV_PAGE" });
    assert.equal(actor.getSnapshot().context.after, "c1");
    assert.deepEqual(actor.getSnapshot().context.cursorStack, [""]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    actor.send({ type: "PREV_PAGE" });
    assert.equal(actor.getSnapshot().context.after, null);
    assert.deepEqual(actor.getSnapshot().context.cursorStack, []);

    await new Promise((resolve) => setTimeout(resolve, 0));
    actor.send({ type: "NEXT_PAGE", endCursor: "c9" });
    actor.send({ type: "GO_FIRST" });
    assert.equal(actor.getSnapshot().context.after, null);
    assert.deepEqual(actor.getSnapshot().context.cursorStack, []);
  });

  it("consumes a forward cursor at most once while the destination is unresolved", async () => {
    const connection: FontConnection = {
      edges: [],
      pageInfo: { hasNextPage: true, endCursor: "c1" },
      totalCount: 3,
    };
    const { actor } = createTestCatalog({ connection });
    await new Promise((resolve) => setTimeout(resolve, 0));

    actor.send({ type: "NEXT_PAGE", endCursor: "c1" });
    actor.send({ type: "NEXT_PAGE", endCursor: "c1" });

    assert.equal(actor.getSnapshot().context.after, "c1");
    assert.deepEqual(actor.getSnapshot().context.cursorStack, [""]);
  });

  it("pops at most one previous cursor while the destination is unresolved", async () => {
    const machine = catalogMachine.provide({
      actors: {
        loadFonts: fromPromise(async () => emptyConnection),
      },
    });
    const actor = createActor(machine, {
      input: { after: "c2", cursorStack: ["", "c1"] },
    });
    actor.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    actor.send({ type: "PREV_PAGE" });
    actor.send({ type: "PREV_PAGE" });

    assert.equal(actor.getSnapshot().context.after, "c1");
    assert.deepEqual(actor.getSnapshot().context.cursorStack, [""]);
  });

  it("ignores PREV_PAGE on first page", () => {
    const { actor } = createTestCatalog();
    actor.send({ type: "PREV_PAGE" });
    assert.equal(actor.getSnapshot().context.after, null);
  });

  it("does not fabricate a previous page for an unanchored cursor", async () => {
    const machine = catalogMachine.provide({
      actors: {
        loadFonts: fromPromise(async () => emptyConnection),
      },
    });
    const actor = createActor(machine, {
      input: { after: "opaque-deep-cursor" },
    });
    actor.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    actor.send({ type: "PREV_PAGE" });

    assert.equal(actor.getSnapshot().context.after, "opaque-deep-cursor");
    assert.deepEqual(actor.getSnapshot().context.cursorStack, []);
  });

  it("SET_FILTER / CLEAR_FILTERS / SET_SORT reset pagination", () => {
    const { actor } = createTestCatalog();
    actor.send({ type: "NEXT_PAGE", endCursor: "c1" });
    actor.send({ type: "SET_FILTER", filter: { owner: "silnrsi", format: "woff2" } });
    let ctx = actor.getSnapshot().context;
    assert.equal(ctx.filters.owner, "silnrsi");
    assert.equal(ctx.filters.format, "woff2");
    assert.equal(ctx.after, null);
    assert.deepEqual(ctx.cursorStack, []);

    actor.send({ type: "NEXT_PAGE", endCursor: "c2" });
    actor.send({ type: "SET_SORT", sort: "FAMILY_ASC" });
    ctx = actor.getSnapshot().context;
    assert.equal(ctx.sort, "FAMILY_ASC");
    assert.equal(ctx.after, null);

    actor.send({ type: "SET_FILTER", filter: { minStars: 10 } });
    actor.send({ type: "CLEAR_FILTERS" });
    ctx = actor.getSnapshot().context;
    assert.equal(ctx.q, "");
    assert.equal(ctx.filters.owner, "");
    assert.equal(ctx.filters.minStars, 0);
    assert.equal(ctx.after, null);
  });

  it("CLEAR_FILTERS is a full reset while search is debouncing", () => {
    const { actor } = createTestCatalog();
    actor.send({ type: "SELECT_FONT", id: 42 });
    actor.send({ type: "SET_SORT", sort: "STARS_ASC" });
    actor.send({ type: "SET_Q", q: "inter" });
    assert.equal(actor.getSnapshot().value, "debouncing_q");

    actor.send({ type: "CLEAR_FILTERS" });

    const ctx = actor.getSnapshot().context;
    assert.equal(ctx.q, "");
    assert.deepEqual(ctx.filters, {
      format: "",
      owner: "",
      minStars: 0,
      webfont: null,
      variable: null,
    });
    assert.equal(ctx.sort, "REPUTATION_DESC");
    assert.equal(ctx.selectedFontId, null);
    assert.equal(ctx.after, null);
    assert.deepEqual(ctx.cursorStack, []);
  });

  it("rejects fractional minimum stars before it reaches active state", () => {
    const { actor } = createTestCatalog();

    actor.send({ type: "SET_FILTER", filter: { minStars: 1.5 } });

    const ctx = actor.getSnapshot().context;
    assert.equal(ctx.filters.minStars, 0);
    assert.equal(toFontsFilter(ctx).minStars, null);
  });

  it("applies rapid boolean toggles from current machine state", () => {
    const { actor } = createTestCatalog();

    actor.send({ type: "TOGGLE_WEBFONT" });
    assert.equal(actor.getSnapshot().context.filters.webfont, true);

    actor.send({ type: "TOGGLE_WEBFONT" });
    assert.equal(actor.getSnapshot().context.filters.webfont, null);

    actor.send({ type: "TOGGLE_VARIABLE" });
    assert.equal(actor.getSnapshot().context.filters.variable, true);

    actor.send({ type: "TOGGLE_VARIABLE" });
    assert.equal(actor.getSnapshot().context.filters.variable, null);
  });

  it("SELECT_FONT and DESELECT", () => {
    const { actor } = createTestCatalog();
    actor.send({ type: "SELECT_FONT", id: 42 });
    assert.equal(actor.getSnapshot().context.selectedFontId, 42);
    actor.send({ type: "DESELECT" });
    assert.equal(actor.getSnapshot().context.selectedFontId, null);
  });

  it("HYDRATE_FROM_URL applies slice and clears stack", () => {
    const { actor } = createTestCatalog();
    actor.send({ type: "NEXT_PAGE", endCursor: "c1" });
    actor.send({
      type: "HYDRATE_FROM_URL",
      slice: {
        q: "charis",
        filters: { format: "ttf", owner: "silnrsi" },
        after: "url-cursor",
        selectedFontId: 7,
        sort: "STARS_DESC",
      },
    });
    const ctx = actor.getSnapshot().context;
    assert.equal(ctx.q, "charis");
    assert.equal(ctx.filters.format, "ttf");
    assert.equal(ctx.filters.owner, "silnrsi");
    assert.equal(ctx.after, "url-cursor");
    assert.deepEqual(ctx.cursorStack, []);
    assert.equal(ctx.selectedFontId, 7);
    assert.equal(ctx.sort, "STARS_DESC");
    assert.equal(actor.getSnapshot().value, "ready");
  });

  it("stores connection on successful invoke", async () => {
    const connection: FontConnection = {
      edges: [
        {
          cursor: "x",
          node: {
            fontFileId: 1,
            cdnUrl: "https://cdn.example/a.woff2",
            rawUrl: "https://raw.example/a.woff2",
            format: "woff2",
            fileName: "a.woff2",
            path: "a.woff2",
            familyGuess: "A",
            weightGuess: 400,
            styleGuess: "normal",
            isVariable: false,
            isWebfont: true,
            repoId: 1,
            fullName: "o/r",
            repoName: "r",
            repoUrl: "https://github.com/o/r",
            stars: 1,
            reputation: 1,
            licenseSpdx: "OFL-1.1",
            defaultBranch: "main",
            ownerLogin: "o",
            ownerType: "User",
            ownerUrl: null,
          },
        },
      ],
      pageInfo: { hasNextPage: true, endCursor: "x" },
      totalCount: 1,
    };
    const { actor } = createTestCatalog({ connection });
    // Allow microtask for fromPromise resolution.
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(actor.getSnapshot().context.connection?.totalCount, 1);
    assert.equal(actor.getSnapshot().context.error, null);
  });

  it("masks internal request details when loadFonts fails", async () => {
    const { actor } = createTestCatalog({
      fail: true,
      error: new Error(
        "GraphQL request failed: query Fonts($filter: FontFilter) variables={secret}",
      ),
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(
      actor.getSnapshot().context.error,
      "Unable to load the font catalog. Try again.",
    );
    // Initial load: connection stays null; refetch failures keep previous data.
    assert.equal(actor.getSnapshot().context.connection, null);
    assert.equal(actor.getSnapshot().context.isLoading, false);
  });

  it("keeps the safe error visible until retry succeeds", async () => {
    let attempt = 0;
    let resolveRetry!: (connection: FontConnection) => void;
    const machine = catalogMachine.provide({
      actors: {
        loadFonts: fromPromise(
          () =>
            attempt++ === 0
              ? Promise.reject(new Error("sensitive transport detail"))
              : new Promise<FontConnection>((resolve) => {
                  resolveRetry = resolve;
                }),
        ),
      },
    });
    const actor = createActor(machine, { input: {} });
    actor.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    actor.send({ type: "RETRY" });

    assert.equal(
      actor.getSnapshot().context.error,
      "Unable to load the font catalog. Try again.",
    );
    assert.equal(actor.getSnapshot().context.isLoading, true);

    resolveRetry(emptyConnection);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(actor.getSnapshot().context.error, null);
    assert.deepEqual(actor.getSnapshot().context.connection, emptyConnection);
  });

  it("keeps previous connection while filter refetch is in flight", async () => {
    const connection: FontConnection = {
      edges: [],
      pageInfo: { hasNextPage: false, endCursor: null },
      totalCount: 3,
    };
    const { actor } = createTestCatalog({ connection });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(actor.getSnapshot().context.connection?.totalCount, 3);

    actor.send({ type: "SET_FILTER", filter: { format: "woff2" } });
    // keepPreviousData: connection not cleared on re-fetch
    assert.equal(actor.getSnapshot().context.connection?.totalCount, 3);
    assert.equal(actor.getSnapshot().context.isLoading, true);
    assert.equal(actor.getSnapshot().context.filters.format, "woff2");
  });
});
