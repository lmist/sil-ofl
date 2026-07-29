"use client";

import { useMemo } from "react";
import { useFontCatalogShellContext } from "@/hooks/use-font-catalog-shell";

/**
 * Headless search field — prop bundles only; markup in FontSearchField.
 */
export function useFontSearchField() {
  const shell = useFontCatalogShellContext();

  const rootProps = useMemo(
    () =>
      ({
        "data-font-search-field": true,
      }) as const,
    [],
  );

  const labelProps = useMemo(
    () =>
      ({
        htmlFor: "font-catalog-search",
      }) as const,
    [],
  );

  const inputProps = useMemo(
    () => ({
      id: "font-catalog-search",
      ...shell.searchInputProps,
    }),
    [shell.searchInputProps],
  );

  const hint =
    shell.isDebouncing
      ? "Typing…"
      : shell.connection
        ? `${shell.totalCount.toLocaleString()} matches`
        : undefined;

  return {
    rootProps,
    labelProps,
    labelText: "Search",
    inputProps,
    /** Instant field; machine debounce; live match count when settled. */
    hint,
    totalCount: shell.totalCount,
    isDebouncing: shell.isDebouncing,
  } as const;
}

export type UseFontSearchFieldReturn = ReturnType<typeof useFontSearchField>;
