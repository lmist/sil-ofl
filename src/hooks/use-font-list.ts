"use client";

import { useLayoutEffect, useMemo } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useFontCatalogShellContext } from "@/hooks/use-font-catalog-shell";
import { perfAround } from "@/lib/perf";

/** Estimated Klim-style specimen row height (px) — stable for virtualizer. */
export const FONT_ROW_ESTIMATE_PX = 240;

/** Overscan band (rows) — 8–12 keeps scroll smooth without mounting faces. */
export const FONT_LIST_OVERSCAN = 10;

const estimateSize = () => FONT_ROW_ESTIMATE_PX;

/**
 * Headless virtualized font list (window scroll — continuous catalog feel).
 * Virtualizer math + row prop bundles live here; policy in FontList.
 *
 * @font-face is NOT mounted for offscreen rows — only selected / hovered
 * rows trigger specimen machine face load via getRowInteractionProps.
 */
export function useFontList() {
  const shell = useFontCatalogShellContext();
  const count = shell.edges.length;

  const virtualizer = useWindowVirtualizer({
    count,
    estimateSize,
    overscan: FONT_LIST_OVERSCAN,
    getItemKey: (index) => {
      const edge = shell.edges[index];
      return edge?.node.fontFileId ?? index;
    },
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  // Optional performance mark around list layout (after paint commit).
  useLayoutEffect(() => {
    perfAround("list-render", () => {
      // measure only — virtualizer already computed
    });
  }, [virtualItems.length, totalSize, count]);

  const containerProps = useMemo(
    () =>
      ({
        role: "list" as const,
        "aria-label": "Font families",
        "aria-busy": shell.isFetching || shell.isDebouncing,
        "data-font-list": true,
        "data-empty": shell.isEmpty ? "true" : "false",
        "data-placeholder": shell.isPlaceholderData ? "true" : "false",
        "data-total-count": shell.totalCount,
      }) as const,
    [
      shell.isFetching,
      shell.isDebouncing,
      shell.isEmpty,
      shell.isPlaceholderData,
      shell.totalCount,
    ],
  );

  const spacerStyle = useMemo(
    () =>
      ({
        height: `${totalSize}px`,
        width: "100%",
        position: "relative" as const,
      }) as const,
    [totalSize],
  );

  const specimenText = shell.specimenText;
  const getRowInteractionProps = shell.getRowInteractionProps;
  const edges = shell.edges;
  const cursorDepth = shell.catalog.context.cursorStack.length;
  const pageOffset = shell.isPlaceholderData
    ? null
    : shell.catalog.context.after == null
      ? 0
      : cursorDepth === 0
        ? null
        : shell.hasNext
          ? cursorDepth * count
          : Math.max(shell.totalCount - count, 0);
  const setSize = shell.totalCount;

  const rows = useMemo(() => {
    return virtualItems.map((vItem) => {
      const edge = edges[vItem.index];
      if (!edge) {
        return {
          key: `gap-${vItem.index}`,
          wrapperStyle: {
            position: "absolute" as const,
            top: 0,
            left: 0,
            width: "100%",
            height: `${vItem.size}px`,
            transform: `translateY(${vItem.start}px)`,
          },
          rowProps: null as null,
        };
      }

      const interaction = getRowInteractionProps(edge.node);

      return {
        key: edge.node.fontFileId,
        ariaPosInSet:
          pageOffset == null ? undefined : pageOffset + vItem.index + 1,
        ariaSetSize: setSize,
        wrapperStyle: {
          position: "absolute" as const,
          top: 0,
          left: 0,
          width: "100%",
          height: `${vItem.size}px`,
          transform: `translateY(${vItem.start}px)`,
        },
        rowProps: {
          rootProps: {
            type: interaction.type,
            onClick: interaction.onClick,
            onMouseEnter: interaction.onMouseEnter,
            onFocus: interaction.onFocus,
            onKeyDown: interaction.onKeyDown,
            "aria-pressed": interaction["aria-pressed"],
            "aria-label": interaction["aria-label"],
            "data-selected": interaction["data-selected"],
            "data-face-ready": interaction["data-face-ready"],
          },
          sampleProps: {
            style: interaction.faceStyle,
            "aria-hidden": true as const,
          },
          sampleText: specimenText || interaction.displayName,
          name: interaction.displayName,
          meta: interaction.meta,
          selected: interaction.selected,
          faceActive: interaction.faceActive,
          node: edge.node,
        },
      };
    });
  }, [
    virtualItems,
    edges,
    getRowInteractionProps,
    specimenText,
    pageOffset,
    setSize,
  ]);

  const emptyHeadline =
    shell.isFetching || !shell.connection
      ? "Loading catalog…"
      : "No fonts match these filters.";

  const emptySubcopy =
    shell.isFetching || !shell.connection
      ? "Fetching Open Font License faces."
      : "Try clearing filters or broadening the search.";

  // Keep showing list when we have placeholder (previous) data during fetch.
  const showList = count > 0;
  const showEmpty = !showList && !shell.error;
  const showError = Boolean(shell.error);

  return {
    containerProps,
    spacerStyle,
    rows,
    showList,
    showEmpty,
    showError,
    emptyHeadline,
    emptySubcopy,
    error: shell.error,
    retryCatalogProps: shell.retryCatalogProps,
    canResetPagination: shell.catalog.context.after != null,
    resetPaginationProps: shell.resetPaginationProps,
    isFetching: shell.isFetching,
    isPlaceholderData: shell.isPlaceholderData,
    totalCount: shell.totalCount,
    virtualizer,
  } as const;
}

export type UseFontListReturn = ReturnType<typeof useFontList>;
