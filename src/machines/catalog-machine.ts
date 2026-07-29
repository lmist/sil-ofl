import { assign, setup } from "xstate";
import type { QueryClient } from "@tanstack/react-query";
import type {
  FontConnection,
  FontsFilter,
  FontSort,
} from "@/types/catalog";
import {
  fetchFontsLogic,
  type FetchFontsInput,
} from "./actors/fetch-fonts";
import type { CatalogUrlSlice } from "./catalog-url";

/** Search debounce for SET_Q (XState delayed transition — not useEffect). */
export const CATALOG_Q_DEBOUNCE_MS = 175;

export type CatalogFilters = {
  format: string;
  owner: string;
  minStars: number;
  webfont: boolean | null;
  variable: boolean | null;
};

export type CatalogContext = {
  /** Draft + committed search string (committed after debounce in ready). */
  q: string;
  filters: CatalogFilters;
  sort: FontSort;
  /**
   * Stack of previous `after` cursors for PREV_PAGE.
   * Index 0 is the oldest page; top is the page before current.
   */
  cursorStack: string[];
  /** Current page keyset cursor (`null` = first page). */
  after: string | null;
  pageSize: number;
  selectedFontId: number | null;
  /**
   * Server page from invoked TanStack Query / graphql actor.
   * Kept across filter/sort/page refetches (keepPreviousData semantics)
   * so the list does not flash empty while the next page loads.
   */
  connection: FontConnection | null;
  error: string | null;
  /** True while `ready` invoke is in flight. */
  isLoading: boolean;
  /** Injected by React hook for cache-aware fetches. */
  queryClient: QueryClient | null;
};

export type CatalogEvent =
  | { type: "SET_Q"; q: string }
  | {
      type: "SET_FILTER";
      filter: Partial<CatalogFilters>;
    }
  | { type: "CLEAR_FILTERS" }
  | { type: "SET_SORT"; sort: FontSort }
  | { type: "NEXT_PAGE"; endCursor: string }
  | { type: "PREV_PAGE" }
  | { type: "GO_FIRST" }
  | { type: "SELECT_FONT"; id: number }
  | { type: "DESELECT" }
  | { type: "HYDRATE_FROM_URL"; slice: Partial<CatalogUrlSlice> }
  | { type: "RETRY" };

export type CatalogInput = Partial<
  Pick<
    CatalogContext,
    | "q"
    | "filters"
    | "sort"
    | "after"
    | "cursorStack"
    | "pageSize"
    | "selectedFontId"
    | "queryClient"
  >
>;

export const defaultCatalogFilters: CatalogFilters = {
  format: "",
  owner: "",
  minStars: 0,
  webfont: null,
  variable: null,
};

export const defaultCatalogContext: CatalogContext = {
  q: "",
  filters: { ...defaultCatalogFilters },
  sort: "REPUTATION_DESC",
  cursorStack: [],
  after: null,
  pageSize: 50,
  selectedFontId: null,
  connection: null,
  error: null,
  isLoading: false,
  queryClient: null,
};

/** Map machine context → GraphQL / TanStack Query filter key. */
export function toFontsFilter(ctx: CatalogContext): FontsFilter {
  return {
    q: ctx.q || null,
    owner: ctx.filters.owner || null,
    format: ctx.filters.format ? [ctx.filters.format] : null,
    minStars: ctx.filters.minStars > 0 ? ctx.filters.minStars : null,
    webfont: ctx.filters.webfont,
    variable: ctx.filters.variable,
    first: ctx.pageSize,
    after: ctx.after,
    sort: ctx.sort,
  };
}

function toFetchInput(ctx: CatalogContext): FetchFontsInput {
  return {
    ...toFontsFilter(ctx),
    queryClient: ctx.queryClient,
  };
}

function resetPagination(): Pick<CatalogContext, "after" | "cursorStack"> {
  return { after: null, cursorStack: [] };
}

function applyHydrateSlice(
  context: CatalogContext,
  slice: Partial<CatalogUrlSlice>,
): CatalogContext {
  return {
    ...context,
    q: slice.q ?? context.q,
    filters: {
      ...context.filters,
      ...(slice.filters?.format !== undefined
        ? { format: slice.filters.format }
        : {}),
      ...(slice.filters?.owner !== undefined
        ? { owner: slice.filters.owner }
        : {}),
    },
    sort: slice.sort ?? context.sort,
    after: slice.after !== undefined ? slice.after : context.after,
    // URL hydrate always starts a fresh cursor stack for the given after.
    cursorStack: [],
    selectedFontId:
      slice.selectedFontId !== undefined
        ? slice.selectedFontId
        : context.selectedFontId,
    // Keep previous connection as placeholder until invoke completes.
    error: null,
    isLoading: true,
  };
}

export const catalogMachine = setup({
  types: {
    context: {} as CatalogContext,
    events: {} as CatalogEvent,
    input: {} as CatalogInput,
  },
  actors: {
    loadFonts: fetchFontsLogic,
  },
  delays: {
    qDebounce: CATALOG_Q_DEBOUNCE_MS,
  },
}).createMachine({
  id: "catalog",
  initial: "ready",
  context: ({ input }) => ({
    ...defaultCatalogContext,
    ...input,
    filters: {
      ...defaultCatalogFilters,
      ...input?.filters,
    },
    cursorStack: input?.cursorStack ? [...input.cursorStack] : [],
    connection: null,
    error: null,
    isLoading: true,
  }),
  states: {
    /**
     * Brief resting state after hard resets; immediately enters ready
     * so invoke can run. Kept for the idle | debouncing_q | ready contract.
     */
    idle: {
      always: { target: "ready" },
      on: {
        SET_Q: {
          target: "debouncing_q",
          actions: assign(({ event }) => ({
            q: event.q,
            ...resetPagination(),
            error: null,
            isLoading: false,
          })),
        },
        HYDRATE_FROM_URL: {
          target: "ready",
          actions: assign(({ context, event }) =>
            applyHydrateSlice(context, event.slice),
          ),
        },
      },
    },

    /** Typing debounce — delayed transition only (no useEffect). Instant field; fetch after debounce. */
    debouncing_q: {
      entry: assign({ isLoading: false }),
      after: {
        qDebounce: { target: "ready" },
      },
      on: {
        SET_Q: {
          target: "debouncing_q",
          reenter: true,
          actions: assign(({ event }) => ({
            q: event.q,
            ...resetPagination(),
            error: null,
          })),
        },
        SET_FILTER: {
          target: "ready",
          actions: assign(({ context, event }) => ({
            filters: { ...context.filters, ...event.filter },
            ...resetPagination(),
            error: null,
            isLoading: true,
          })),
        },
        CLEAR_FILTERS: {
          target: "ready",
          actions: assign(() => ({
            q: "",
            filters: { ...defaultCatalogFilters },
            ...resetPagination(),
            error: null,
            isLoading: true,
          })),
        },
        SET_SORT: {
          target: "ready",
          actions: assign(({ event }) => ({
            sort: event.sort,
            ...resetPagination(),
            error: null,
            isLoading: true,
          })),
        },
        SELECT_FONT: {
          actions: assign({
            selectedFontId: ({ event }) => event.id,
          }),
        },
        DESELECT: {
          actions: assign({ selectedFontId: null }),
        },
        HYDRATE_FROM_URL: {
          target: "ready",
          actions: assign(({ context, event }) =>
            applyHydrateSlice(context, event.slice),
          ),
        },
      },
    },

    ready: {
      entry: assign({ error: null, isLoading: true }),
      invoke: {
        id: "loadFonts",
        src: "loadFonts",
        input: ({ context }) => toFetchInput(context),
        onDone: {
          actions: assign({
            connection: ({ event }) => event.output,
            error: null,
            isLoading: false,
          }),
        },
        onError: {
          actions: assign({
            error: ({ event }) =>
              event.error instanceof Error
                ? event.error.message
                : "Failed to load fonts",
            // Keep previous connection when a refetch fails (placeholder).
            isLoading: false,
          }),
        },
      },
      on: {
        SET_Q: {
          target: "debouncing_q",
          actions: assign(({ event }) => ({
            q: event.q,
            ...resetPagination(),
            error: null,
            isLoading: false,
          })),
        },
        SET_FILTER: {
          target: "ready",
          reenter: true,
          actions: assign(({ context, event }) => ({
            filters: { ...context.filters, ...event.filter },
            ...resetPagination(),
            error: null,
            isLoading: true,
          })),
        },
        CLEAR_FILTERS: {
          target: "idle",
          actions: assign(() => ({
            q: "",
            filters: { ...defaultCatalogFilters },
            sort: "REPUTATION_DESC" as FontSort,
            ...resetPagination(),
            selectedFontId: null,
            error: null,
            isLoading: true,
          })),
        },
        SET_SORT: {
          target: "ready",
          reenter: true,
          actions: assign(({ event }) => ({
            sort: event.sort,
            ...resetPagination(),
            error: null,
            isLoading: true,
          })),
        },
        NEXT_PAGE: {
          target: "ready",
          reenter: true,
          guard: ({ event }) => Boolean(event.endCursor),
          actions: assign(({ context, event }) => ({
            cursorStack: [
              ...context.cursorStack,
              context.after ?? "",
            ],
            after: event.endCursor,
            error: null,
            isLoading: true,
          })),
        },
        PREV_PAGE: {
          target: "ready",
          reenter: true,
          guard: ({ context }) => context.cursorStack.length > 0,
          actions: assign(({ context }) => {
            const stack = [...context.cursorStack];
            const prev = stack.pop()!;
            return {
              cursorStack: stack,
              after: prev === "" ? null : prev,
              error: null,
              isLoading: true,
            };
          }),
        },
        GO_FIRST: {
          target: "ready",
          reenter: true,
          actions: assign(() => ({
            ...resetPagination(),
            error: null,
            isLoading: true,
          })),
        },
        SELECT_FONT: {
          actions: assign({
            selectedFontId: ({ event }) => event.id,
          }),
        },
        DESELECT: {
          actions: assign({ selectedFontId: null }),
        },
        HYDRATE_FROM_URL: {
          target: "ready",
          reenter: true,
          actions: assign(({ context, event }) =>
            applyHydrateSlice(context, event.slice),
          ),
        },
        RETRY: {
          target: "ready",
          reenter: true,
          actions: assign({ error: null, isLoading: true }),
        },
      },
    },
  },
});

export type CatalogMachine = typeof catalogMachine;
