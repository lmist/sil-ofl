"use client";

import {
  keepPreviousData,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import {
  fetchFontsPage,
  type FetchFontsInput,
} from "@/machines/actors/fetch-fonts";
import { getGraphqlClient } from "@/graphql/client";
import {
  STATS_QUERY,
  type StatsQueryResult,
} from "@/graphql/documents";
import type { FontsFilter } from "@/types/catalog";
import {
  FONTS_GC_TIME_MS,
  FONTS_STALE_TIME_MS,
  STATS_STALE_TIME_MS,
  normalizeFontsFilterKey,
  queryKeys,
} from "@/lib/query-keys";

export {
  FONTS_GC_TIME_MS,
  FONTS_STALE_TIME_MS,
  STATS_STALE_TIME_MS,
  fontsQueryKey,
  fontQueryKey,
  statsQueryKey,
  queryKeys,
  normalizeFontsFilterKey,
  toFontsGraphqlVariables,
} from "@/lib/query-keys";

export type UseFontsQueryOptions = {
  /** When false, skip network (e.g. while machine is debouncing_q). Default true. */
  enabled?: boolean;
};

/**
 * Catalog fonts page via TanStack Query.
 * - queryKey factory + normalized filter
 * - placeholderData: keepPreviousData for smooth filter/sort/page changes
 * - staleTime tuned for FTS list
 */
export function useFontsQuery(
  filter: FontsFilter,
  options: UseFontsQueryOptions = {},
) {
  const { enabled = true } = options;
  const normalized = normalizeFontsFilterKey(filter);

  return useQuery({
    queryKey: queryKeys.fonts.list(normalized),
    queryFn: ({ signal }) => fetchFontsPage(normalized, signal),
    staleTime: FONTS_STALE_TIME_MS,
    gcTime: FONTS_GC_TIME_MS,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCatalogStatsQuery() {
  return useQuery({
    queryKey: queryKeys.stats(),
    queryFn: async () => {
      const client = getGraphqlClient();
      const data = await client.request<StatsQueryResult>(STATS_QUERY);
      return data.stats;
    },
    staleTime: STATS_STALE_TIME_MS,
  });
}

/** Prefetch a fonts page into the shared QueryClient (idle next-page, hover, etc.). */
export function prefetchFontsPage(
  queryClient: QueryClient,
  filter: FontsFilter,
): Promise<void> {
  const normalized = normalizeFontsFilterKey(filter);
  return queryClient.prefetchQuery({
    queryKey: queryKeys.fonts.list(normalized),
    queryFn: ({ signal }) => fetchFontsPage(normalized, signal),
    staleTime: FONTS_STALE_TIME_MS,
  });
}

/**
 * Warm the next page in the cache via a parallel query (no useEffect).
 * GraphQL vars mirror catalog machine context (caller passes full filter + after).
 * Runs when idle-friendly: enabled + hasNextPage + endCursor present.
 */
export function usePrefetchNextFontsPage(
  filter: FontsFilter,
  pageInfo: { hasNextPage: boolean; endCursor: string | null } | null | undefined,
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options;

  const nextFilter = useMemo(() => {
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) return null;
    return normalizeFontsFilterKey({
      ...filter,
      after: pageInfo.endCursor,
    });
    // Intentionally field-wise: avoid identity churn on filter object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pageInfo?.hasNextPage,
    pageInfo?.endCursor,
    filter.q,
    filter.owner,
    filter.format,
    filter.minStars,
    filter.webfont,
    filter.variable,
    filter.first,
    filter.sort,
    filter.after,
  ]);

  useQuery({
    queryKey: nextFilter
      ? queryKeys.fonts.list(nextFilter)
      : ([...queryKeys.fonts.lists(), "prefetch-idle"] as const),
    queryFn: ({ signal }) => fetchFontsPage(nextFilter!, signal),
    staleTime: FONTS_STALE_TIME_MS,
    gcTime: FONTS_GC_TIME_MS,
    enabled: Boolean(enabled && nextFilter),
    // Background warm only — never block UI; no keepPreviousData needed.
  });
}

/** Shared fetch options for XState actor (same keys / staleTime as the hook). */
export function fontsFetchQueryOptions(filter: FontsFilter) {
  const normalized = normalizeFontsFilterKey(filter);
  return {
    queryKey: queryKeys.fonts.list(normalized),
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      fetchFontsPage(normalized, signal),
    staleTime: FONTS_STALE_TIME_MS,
  } as const;
}

export type { FetchFontsInput };
