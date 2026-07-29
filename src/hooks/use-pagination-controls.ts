"use client";

import { useMemo } from "react";
import { useFontCatalogShellContext } from "@/hooks/use-font-catalog-shell";

/**
 * Headless pagination — machine cursor stack + pageInfo.
 */
export function usePaginationControls() {
  const shell = useFontCatalogShellContext();
  const { after, cursorStack } = shell.catalog.context;

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
    if (after == null) return "Page 1";
    if (cursorStack[0] !== "") return "Page unknown";
    return `Page ${cursorStack.length + 1}`;
  }, [shell.connection, cursorStack, after]);

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
