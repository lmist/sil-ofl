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
import { isPositiveSafeInteger } from "@/lib/positive-safe-integer";

/** Search debounce for SET_Q (XState delayed transition — not useEffect). */
export const CATALOG_Q_DEBOUNCE_MS = 175;
export const GRAPHQL_INT_MAX = 2_147_483_647;
export const CATALOG_LOAD_ERROR_MESSAGE =
  "Unable to load the font catalog. Try again.";

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
  | { type: "COMMIT_Q" }
  | {
      type: "SET_FILTER";
      filter: Partial<CatalogFilters>;
    }
  | { type: "TOGGLE_WEBFONT" }
  | { type: "TOGGLE_VARIABLE" }
  | { type: "CLEAR_FILTERS" }
  | { type: "SET_SORT"; sort: FontSort }
  | { type: "NEXT_PAGE"; endCursor: string }
  | { type: "PREV_PAGE" }
  | { type: "GO_FIRST" }
  | { type: "RESET" }
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

export function normalizeMinStars(value: number): number {
  return Number.isInteger(value) &&
    value >= 0 &&
    value <= GRAPHQL_INT_MAX
    ? value
    : 0;
}

export function parseMinStarsInput(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return 0;
  return normalizeMinStars(Number(value));
}

function mergeCatalogFilters(
  current: CatalogFilters,
  patch: Partial<CatalogFilters>,
): CatalogFilters {
  return {
    ...current,
    ...patch,
    owner: (patch.owner ?? current.owner).trim(),
    ...(patch.minStars !== undefined
      ? { minStars: normalizeMinStars(patch.minStars) }
      : {}),
  };
}

/** Map machine context → GraphQL / TanStack Query filter key. */
export function toFontsFilter(ctx: CatalogContext): FontsFilter {
  const q = ctx.q.trim();
  const owner = ctx.filters.owner.trim();

  return {
    q: q || null,
    owner: owner || null,
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
    q: slice.q !== undefined ? slice.q.trim() : context.q,
    filters: {
      ...context.filters,
      ...(slice.filters?.format !== undefined
        ? { format: slice.filters.format }
        : {}),
      ...(slice.filters?.owner !== undefined
        ? { owner: slice.filters.owner.trim() }
        : {}),
    },
    sort: slice.sort ?? context.sort,
    after: slice.after !== undefined ? slice.after : context.after,
    // URL hydrate always starts a fresh cursor stack for the given after.
    cursorStack: [],
    selectedFontId:
      slice.selectedFontId !== undefined
        ? isPositiveSafeInteger(slice.selectedFontId)
          ? slice.selectedFontId
          : null
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
  guards: {
    hasValidSelectedFontId: ({ event }) =>
      event.type === "SELECT_FONT" &&
      isPositiveSafeInteger(event.id),
  },
}).createMachine({
  id: "catalog",
  initial: "ready",
  context: ({ input }) => {
    const selectedFontId = isPositiveSafeInteger(input?.selectedFontId)
      ? input.selectedFontId
      : null;

    return {
      ...defaultCatalogContext,
      ...input,
      q: input?.q?.trim() ?? defaultCatalogContext.q,
      filters: mergeCatalogFilters(
        defaultCatalogFilters,
        input?.filters ?? {},
      ),
      cursorStack: input?.cursorStack ? [...input.cursorStack] : [],
      selectedFontId,
      connection: null,
      error: null,
      isLoading: true,
    };
  },
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
        qDebounce: {
          target: "ready",
        },
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
        COMMIT_Q: {
          target: "ready",
          actions: assign(({ context }) => ({
            q: context.q.trim(),
            error: null,
            isLoading: true,
          })),
        },
        SET_FILTER: {
          target: "ready",
          actions: assign(({ context, event }) => ({
            filters: mergeCatalogFilters(context.filters, event.filter),
            ...resetPagination(),
            error: null,
            isLoading: true,
          })),
        },
        TOGGLE_WEBFONT: {
          target: "ready",
          actions: assign(({ context }) => ({
            filters: {
              ...context.filters,
              webfont: context.filters.webfont === true ? null : true,
            },
            ...resetPagination(),
            error: null,
            isLoading: true,
          })),
        },
        TOGGLE_VARIABLE: {
          target: "ready",
          actions: assign(({ context }) => ({
            filters: {
              ...context.filters,
              variable: context.filters.variable === true ? null : true,
            },
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
            sort: "REPUTATION_DESC" as FontSort,
            ...resetPagination(),
            selectedFontId: null,
            error: null,
            isLoading: true,
          })),
        },
        RESET: {
          target: "ready",
          actions: assign(() => ({
            ...resetPagination(),
            selectedFontId: null,
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
          guard: "hasValidSelectedFontId",
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
      entry: assign({ isLoading: true }),
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
            error: CATALOG_LOAD_ERROR_MESSAGE,
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
        COMMIT_Q: {
          actions: assign(({ context }) => ({
            q: context.q.trim(),
          })),
        },
        SET_FILTER: {
          target: "ready",
          reenter: true,
          actions: assign(({ context, event }) => ({
            filters: mergeCatalogFilters(context.filters, event.filter),
            ...resetPagination(),
            error: null,
            isLoading: true,
          })),
        },
        TOGGLE_WEBFONT: {
          target: "ready",
          reenter: true,
          actions: assign(({ context }) => ({
            filters: {
              ...context.filters,
              webfont: context.filters.webfont === true ? null : true,
            },
            ...resetPagination(),
            error: null,
            isLoading: true,
          })),
        },
        TOGGLE_VARIABLE: {
          target: "ready",
          reenter: true,
          actions: assign(({ context }) => ({
            filters: {
              ...context.filters,
              variable: context.filters.variable === true ? null : true,
            },
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
          guard: ({ context, event }) =>
            Boolean(event.endCursor) &&
            !context.isLoading &&
            event.endCursor !== context.after,
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
          guard: ({ context }) =>
            !context.isLoading && context.cursorStack.length > 0,
          actions: assign(({ context }) => {
            const stack = [...context.cursorStack];
            const prev = stack.pop();
            return {
              cursorStack: stack,
              after: prev == null || prev === "" ? null : prev,
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
        RESET: {
          target: "ready",
          reenter: true,
          actions: assign(() => ({
            ...resetPagination(),
            selectedFontId: null,
            error: null,
            isLoading: true,
          })),
        },
        SELECT_FONT: {
          guard: "hasValidSelectedFontId",
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
          actions: assign({ isLoading: true }),
        },
      },
    },
  },
});

export type CatalogMachine = typeof catalogMachine;
