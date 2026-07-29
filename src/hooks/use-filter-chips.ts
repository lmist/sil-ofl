"use client";

import { useCallback, useMemo } from "react";
import { useFontCatalogShellContext } from "@/hooks/use-font-catalog-shell";

export type FilterChip = {
  id: string;
  label: string;
  onRemove: () => void;
};

/**
 * Active filter chips for format / webfont / variable / minStars (+ owner, q).
 * Removing a chip dispatches SET_FILTER / SET_Q / CLEAR via shell send.
 */
export function useFilterChips() {
  const shell = useFontCatalogShellContext();
  const { filters, q, send } = shell;

  const clearFormat = useCallback(() => {
    send({ type: "SET_FILTER", filter: { format: "" } });
  }, [send]);

  const clearWebfont = useCallback(() => {
    send({ type: "SET_FILTER", filter: { webfont: null } });
  }, [send]);

  const clearVariable = useCallback(() => {
    send({ type: "SET_FILTER", filter: { variable: null } });
  }, [send]);

  const clearMinStars = useCallback(() => {
    send({ type: "SET_FILTER", filter: { minStars: 0 } });
  }, [send]);

  const clearOwner = useCallback(() => {
    send({ type: "SET_FILTER", filter: { owner: "" } });
  }, [send]);

  const clearQ = useCallback(() => {
    send({ type: "SET_Q", q: "" });
  }, [send]);


  const chips = useMemo(() => {
    const list: FilterChip[] = [];

    if (q.trim()) {
      list.push({
        id: "q",
        label: `Search: ${q.trim()}`,
        onRemove: clearQ,
      });
    }
    if (filters.format) {
      list.push({
        id: "format",
        label: `Format: ${filters.format}`,
        onRemove: clearFormat,
      });
    }
    if (filters.owner.trim()) {
      list.push({
        id: "owner",
        label: `Owner: ${filters.owner.trim()}`,
        onRemove: clearOwner,
      });
    }
    if (filters.minStars > 0) {
      list.push({
        id: "minStars",
        label: `★ ≥ ${filters.minStars}`,
        onRemove: clearMinStars,
      });
    }
    if (filters.webfont === true) {
      list.push({
        id: "webfont",
        label: "Webfont",
        onRemove: clearWebfont,
      });
    }
    if (filters.variable === true) {
      list.push({
        id: "variable",
        label: "Variable",
        onRemove: clearVariable,
      });
    }

    return list;
  }, [
    q,
    filters.format,
    filters.owner,
    filters.minStars,
    filters.webfont,
    filters.variable,
    clearQ,
    clearFormat,
    clearOwner,
    clearMinStars,
    clearWebfont,
    clearVariable,
  ]);

  const rootProps = useMemo(
    () =>
      ({
        role: "list" as const,
        "aria-label": "Active filters",
        "data-filter-chips": true,
      }) as const,
    [],
  );

  const statusText = shell.isDebouncing
    ? "Searching…"
    : shell.isFetching
      ? shell.connection
        ? "Updating results…"
        : "Loading fonts…"
      : shell.connection
        ? `${shell.totalCount.toLocaleString()} match${shell.totalCount === 1 ? "" : "es"}`
        : "Loading fonts…";

  return {
    chips,
    hasChips: chips.length > 0,
    rootProps,
    clearAllProps: shell.clearFiltersProps,
    statusText,
  } as const;
}

export type UseFilterChipsReturn = ReturnType<typeof useFilterChips>;
