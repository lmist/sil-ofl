import type { FontSort } from "@/types/catalog";
import { parsePositiveSafeInteger } from "@/lib/positive-safe-integer";
import type { CatalogContext, CatalogFilters } from "./catalog-machine";

/** URL query keys for catalog state (Next App Router searchParams). */
export const CATALOG_URL_KEYS = {
  q: "q",
  format: "format",
  owner: "owner",
  after: "after",
  sort: "sort",
  font: "font",
} as const;

const SORT_VALUES: readonly FontSort[] = [
  "REPUTATION_DESC",
  "REPUTATION_ASC",
  "STARS_DESC",
  "STARS_ASC",
  "FAMILY_ASC",
  "FAMILY_DESC",
  "ID_DESC",
  "ID_ASC",
] as const;

function isFontSort(value: string): value is FontSort {
  return (SORT_VALUES as readonly string[]).includes(value);
}

export type CatalogUrlSlice = {
  q: string;
  filters: Pick<CatalogFilters, "format" | "owner">;
  sort: FontSort;
  after: string | null;
  selectedFontId: number | null;
};

/**
 * Parse catalog slice from URLSearchParams / Next searchParams.
 * Missing keys are explicit defaults so parameter removal clears machine state.
 */
export function parseCatalogSearchParams(
  params: URLSearchParams | ReadonlyURLSearchParamsLike,
): CatalogUrlSlice {
  const sort = params.get(CATALOG_URL_KEYS.sort);
  const after = params.get(CATALOG_URL_KEYS.after);
  const font = params.get(CATALOG_URL_KEYS.font);
  const fontId = parsePositiveSafeInteger(font);

  return {
    q: params.get(CATALOG_URL_KEYS.q) ?? "",
    filters: {
      format: params.get(CATALOG_URL_KEYS.format) ?? "",
      owner: params.get(CATALOG_URL_KEYS.owner) ?? "",
    },
    sort: sort && isFontSort(sort) ? sort : "REPUTATION_DESC",
    after: after == null || after === "" ? null : after,
    selectedFontId: fontId,
  };
}

/** Serialise catalog machine context → search string (no leading `?`). */
export function serializeCatalogContext(
  ctx: Pick<
    CatalogContext,
    "q" | "filters" | "sort" | "after" | "selectedFontId"
  >,
): string {
  const params = new URLSearchParams();

  if (ctx.q) params.set(CATALOG_URL_KEYS.q, ctx.q);
  if (ctx.filters.format) {
    params.set(CATALOG_URL_KEYS.format, ctx.filters.format);
  }
  if (ctx.filters.owner) {
    params.set(CATALOG_URL_KEYS.owner, ctx.filters.owner);
  }
  if (ctx.after) params.set(CATALOG_URL_KEYS.after, ctx.after);
  if (ctx.sort && ctx.sort !== "REPUTATION_DESC") {
    params.set(CATALOG_URL_KEYS.sort, ctx.sort);
  }
  if (ctx.selectedFontId != null) {
    params.set(CATALOG_URL_KEYS.font, String(ctx.selectedFontId));
  }

  return params.toString();
}

/** Minimal structural type so we don't depend on Next types here. */
export type ReadonlyURLSearchParamsLike = {
  get(name: string): string | null;
};
