import type { FontSort } from "@/types/catalog";
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
 * Missing keys leave defaults for the caller to merge.
 */
export function parseCatalogSearchParams(
  params: URLSearchParams | ReadonlyURLSearchParamsLike,
): Partial<CatalogUrlSlice> {
  const slice: Partial<CatalogUrlSlice> = {};

  const q = params.get(CATALOG_URL_KEYS.q);
  if (q != null && q !== "") slice.q = q;

  const format = params.get(CATALOG_URL_KEYS.format);
  const owner = params.get(CATALOG_URL_KEYS.owner);
  if (format != null || owner != null) {
    slice.filters = {
      format: format ?? "",
      owner: owner ?? "",
    };
  }

  const sort = params.get(CATALOG_URL_KEYS.sort);
  if (sort && isFontSort(sort)) slice.sort = sort;

  const after = params.get(CATALOG_URL_KEYS.after);
  if (after != null && after !== "") slice.after = after;

  const font = params.get(CATALOG_URL_KEYS.font);
  if (font != null && font !== "") {
    const id = Number(font);
    if (Number.isFinite(id)) slice.selectedFontId = id;
  }

  return slice;
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
