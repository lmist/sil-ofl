"use client";

import { useMemo } from "react";
import { useFontCatalogShellContext } from "@/hooks/use-font-catalog-shell";

/**
 * Headless pagination — machine cursor stack + pageInfo.
 */
export function usePaginationControls() {
  const shell = useFontCatalogShellContext();

  const rootProps = useMemo(
    () =>
      ({
        role: "navigation" as const,
        "aria-label": "Catalog pagination",
        "data-pagination-controls": true,
      }) as const,
    [],
  );

  const pageLabel = useMemo(() => {
    if (!shell.connection) return "—";
    const page = shell.catalog.context.cursorStack.length + 1;
    return `Page ${page}`;
  }, [shell.connection, shell.catalog.context.cursorStack.length]);

  return {
    rootProps,
    prevProps: shell.prevPageProps,
    nextProps: shell.nextPageProps,
    clearProps: shell.clearFiltersProps,
    canPrev: shell.canPrev,
    hasNext: shell.hasNext,
    pageLabel,
    prevLabel: "Prev",
    nextLabel: "Next",
    clearLabel: "Clear",
  } as const;
}

export type UsePaginationControlsReturn = ReturnType<
  typeof usePaginationControls
>;
