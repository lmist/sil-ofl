import { fromPromise } from "xstate";
import type { QueryClient } from "@tanstack/react-query";
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
      return queryClient.fetchQuery({
        queryKey: queryKeys.fonts.list(normalized),
        queryFn: ({ signal: qs }) => fetchFontsPage(normalized, qs ?? signal),
        staleTime: FONTS_STALE_TIME_MS,
      });
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
      return queryClient.fetchQuery({
        queryKey: queryKeys.font(id),
        queryFn: ({ signal: qs }) => fetchFontById(id, qs ?? signal),
        staleTime: 60_000,
      });
    }
    return fetchFontById(id, signal);
  },
);
