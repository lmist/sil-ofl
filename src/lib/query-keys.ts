import type { FontsFilter, FontSort } from "@/types/catalog";

export type NormalizedFontsFilter = {
  q: string | null;
  owner: string | null;
  format: string[] | null;
  minStars: number | null;
  webfont: boolean | null;
  variable: boolean | null;
  first: number;
  after: string | null;
  sort: FontSort;
};

/** Fonts list: long enough to absorb filter flickers; short enough for FTS freshness. */
export const FONTS_STALE_TIME_MS = 60_000;
export const FONTS_GC_TIME_MS = 5 * 60_000;
export const STATS_STALE_TIME_MS = 120_000;

/**
 * Hierarchical TanStack Query key factory.
 * GraphQL variables for fonts lists must match `toFontsFilter(catalogContext)`.
 */
export const queryKeys = {
  all: ["catalog"] as const,

  fonts: {
    all: ["catalog", "fonts"] as const,
    lists: () => [...queryKeys.fonts.all, "list"] as const,
    list: (filter: FontsFilter) =>
      [...queryKeys.fonts.lists(), normalizeFontsFilterKey(filter)] as const,
  },

  font: (id: string | number) =>
    [...queryKeys.all, "font", String(id)] as const,

  stats: () => [...queryKeys.all, "stats"] as const,
} as const;

/** Stable filter shape for cache keys (mirrors GraphQL variable defaults). */
export function normalizeFontsFilterKey(
  filter: FontsFilter,
): NormalizedFontsFilter {
  return {
    q: filter.q ?? null,
    owner: filter.owner ?? null,
    format: normalizeFormatKey(filter.format),
    minStars: filter.minStars ?? null,
    webfont: filter.webfont ?? null,
    variable: filter.variable ?? null,
    first: filter.first ?? 50,
    after: filter.after ?? null,
    sort: filter.sort ?? "REPUTATION_DESC",
  };
}

/** Exact GraphQL variable bag derived from the same normalized key as the cache. */
export function toFontsGraphqlVariables(filter: FontsFilter) {
  const key = normalizeFontsFilterKey(filter);
  return {
    filter: {
      q: key.q,
      owner: key.owner,
      format: key.format,
      minStars: key.minStars,
      webfont: key.webfont,
      variable: key.variable,
    },
    sort: key.sort,
    first: key.first,
    after: key.after,
  } as const;
}

function normalizeFormatKey(
  format: FontsFilter["format"],
): string[] | null {
  if (format == null || format === "") return null;
  if (Array.isArray(format)) {
    return format.length > 0 ? [...format].sort() : null;
  }
  return [format];
}

/** @deprecated Prefer queryKeys.fonts.list */
export function fontsQueryKey(filter: FontsFilter) {
  return queryKeys.fonts.list(filter);
}

/** @deprecated Prefer queryKeys.font */
export function fontQueryKey(id: string | number) {
  return queryKeys.font(id);
}

/** @deprecated Prefer queryKeys.stats */
export const statsQueryKey = queryKeys.stats();
