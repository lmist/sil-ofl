import { fromPromise } from "xstate";
import type {
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import { getGraphqlClient } from "@/graphql/client";
import {
  FONTS_QUERY,
  FONT_QUERY,
  type FontsQueryResult,
  type FontsQueryVariables,
  type FontQueryResult,
  type FontQueryVariables,
  type FontNode,
} from "@/graphql/documents";
import type { FontConnection, FontsFilter, FontSort } from "@/types/catalog";
import {
  FONTS_STALE_TIME_MS,
  normalizeFontsFilterKey,
  queryKeys,
} from "@/lib/query-keys";

export type FetchFontsInput = FontsFilter & {
  queryClient?: QueryClient | null;
};

export type ComposedAbortSignals = {
  signal: AbortSignal;
  dispose: () => void;
};

/**
 * Create a signal that aborts when any unique source aborts.
 * `dispose` must be called when the guarded work settles.
 */
export function composeAbortSignals(
  ...candidates: Array<AbortSignal | null | undefined>
): ComposedAbortSignals {
  const sources = [...new Set(candidates.filter(Boolean))] as AbortSignal[];
  if (sources.length === 1) {
    return { signal: sources[0]!, dispose: () => {} };
  }

  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const [source, listener] of listeners) {
      source.removeEventListener("abort", listener);
    }
    listeners.clear();
  };

  const abortFrom = (source: AbortSignal) => {
    if (controller.signal.aborted) return;
    dispose();
    controller.abort(source.reason);
  };

  const alreadyAborted = sources.find((source) => source.aborted);
  if (alreadyAborted) {
    abortFrom(alreadyAborted);
    return { signal: controller.signal, dispose };
  }

  for (const source of sources) {
    const listener = () => abortFrom(source);
    listeners.set(source, listener);
    source.addEventListener("abort", listener, { once: true });
  }

  const abortedDuringSetup = sources.find((source) => source.aborted);
  if (abortedDuringSetup) abortFrom(abortedDuringSetup);

  return { signal: controller.signal, dispose };
}

async function withComposedAbortSignals<T>(
  querySignal: AbortSignal | undefined,
  actorSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const composed = composeAbortSignals(querySignal, actorSignal);
  try {
    return await operation(composed.signal);
  } finally {
    composed.dispose();
  }
}

async function fetchQueryForActor<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  actorSignal: AbortSignal,
  fetchQuery: () => Promise<T>,
): Promise<T> {
  const cancelQuery = () => {
    void queryClient.cancelQueries({ queryKey, exact: true });
  };

  if (actorSignal.aborted) {
    cancelQuery();
    throw (
      actorSignal.reason ??
      new DOMException("Aborted", "AbortError")
    );
  }

  actorSignal.addEventListener("abort", cancelQuery, { once: true });
  try {
    if (actorSignal.aborted) {
      cancelQuery();
      throw (
        actorSignal.reason ??
        new DOMException("Aborted", "AbortError")
      );
    }
    return await fetchQuery();
  } finally {
    actorSignal.removeEventListener("abort", cancelQuery);
  }
}

/**
 * GraphQL variables mirror `toFontsFilter(catalogContext)` / normalizeFontsFilterKey.
 */
export async function fetchFontsPage(
  filter: FontsFilter,
  signal?: AbortSignal,
): Promise<FontConnection> {
  const key = normalizeFontsFilterKey(filter);
  const client = getGraphqlClient();
  const data = await client.request<
    FontsQueryResult,
    FontsQueryVariables
  >({
    document: FONTS_QUERY,
    variables: {
      filter: {
        q: key.q,
        owner: key.owner,
        format: key.format,
        minStars: key.minStars,
        webfont: key.webfont,
        variable: key.variable,
      },
      sort: (key.sort ?? "REPUTATION_DESC") as FontSort,
      first: key.first ?? 50,
      after: key.after ?? null,
    },
    signal,
  });
  return data.fonts;
}

/**
 * XState promise actor: fonts connection via TanStack Query when a
 * QueryClient is supplied, otherwise plain graphql-request.
 */
export const fetchFontsLogic = fromPromise<FontConnection, FetchFontsInput>(
  async ({ input, signal }) => {
    const { queryClient, ...filter } = input;
    const normalized = normalizeFontsFilterKey(filter);
    if (queryClient) {
      const queryKey = queryKeys.fonts.list(normalized);
      return fetchQueryForActor(
        queryClient,
        queryKey,
        signal,
        () =>
          queryClient.fetchQuery({
            queryKey,
            queryFn: ({ signal: querySignal }) =>
              withComposedAbortSignals(
                querySignal,
                signal,
                (composedSignal) =>
                  fetchFontsPage(normalized, composedSignal),
              ),
            staleTime: FONTS_STALE_TIME_MS,
          }),
      );
    }
    return fetchFontsPage(normalized, signal);
  },
);

export type FetchFontInput = {
  id: string | number;
  queryClient?: QueryClient | null;
};

export async function fetchFontById(
  id: string | number,
  signal?: AbortSignal,
): Promise<FontNode | null> {
  const client = getGraphqlClient();
  const data = await client.request<
    FontQueryResult,
    FontQueryVariables
  >({
    document: FONT_QUERY,
    variables: { id: String(id) },
    signal,
  });
  return data.font;
}

export const fetchFontLogic = fromPromise<FontNode | null, FetchFontInput>(
  async ({ input, signal }) => {
    const { id, queryClient } = input;
    if (queryClient) {
      const queryKey = queryKeys.font(id);
      return fetchQueryForActor(
        queryClient,
        queryKey,
        signal,
        () =>
          queryClient.fetchQuery({
            queryKey,
            queryFn: ({ signal: querySignal }) =>
              withComposedAbortSignals(
                querySignal,
                signal,
                (composedSignal) =>
                  fetchFontById(id, composedSignal),
              ),
            staleTime: 60_000,
          }),
      );
    }
    return fetchFontById(id, signal);
  },
);
