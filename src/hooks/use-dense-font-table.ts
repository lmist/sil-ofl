"use client";

import { useCallback, useMemo } from "react";
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import type { FontFile, FontSort } from "@/types/catalog";
import { useFontCatalogShellContext } from "@/hooks/use-font-catalog-shell";
import { resolveFontFamily } from "@/lib/font-face-descriptors";

const columnHelper = createColumnHelper<FontFile>();

/** Map machine FontSort → table sorting state for header affordances. */
function sortToSortingState(sort: FontSort): SortingState {
  switch (sort) {
    case "FAMILY_ASC":
      return [{ id: "family", desc: false }];
    case "FAMILY_DESC":
      return [{ id: "family", desc: true }];
    case "STARS_DESC":
      return [{ id: "stars", desc: true }];
    case "STARS_ASC":
      return [{ id: "stars", desc: false }];
    case "REPUTATION_DESC":
    case "REPUTATION_ASC":
    case "ID_DESC":
    case "ID_ASC":
    default:
      return [];
  }
}

function sortingToFontSort(id: string, desc: boolean): FontSort | null {
  if (id === "family") return desc ? "FAMILY_DESC" : "FAMILY_ASC";
  if (id === "stars") return desc ? "STARS_DESC" : "STARS_ASC";
  if (id === "format") return null; // format not a server sort
  if (id === "owner") return null;
  return null;
}

/**
 * Headless dense-mode table: family, format, stars, owner.
 * Header sort dispatches SET_SORT to the catalog machine (server sort).
 * No @font-face mounts — text-only rows for speed.
 */
export function useDenseFontTable() {
  const shell = useFontCatalogShellContext();

  const data = useMemo(
    () => shell.edges.map((e) => e.node),
    [shell.edges],
  );

  const sorting = useMemo(
    () => sortToSortingState(shell.sort),
    [shell.sort],
  );

  const onSortClick = useCallback(
    (columnId: string) => {
      const current = sorting[0];
      let desc = false;
      if (current?.id === columnId) {
        desc = !current.desc;
      } else if (columnId === "stars") {
        desc = true;
      }
      const next = sortingToFontSort(columnId, desc);
      if (next) {
        shell.send({ type: "SET_SORT", sort: next });
      }
    },
    [sorting, shell],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor(
        (row) => resolveFontFamily(row),
        {
          id: "family",
          header: "Family",
          cell: (info) => info.getValue(),
          enableSorting: true,
        },
      ),
      columnHelper.accessor("format", {
        id: "format",
        header: "Format",
        cell: (info) => info.getValue(),
        enableSorting: false,
      }),
      columnHelper.accessor("stars", {
        id: "stars",
        header: "Stars",
        cell: (info) => info.getValue().toLocaleString(),
        enableSorting: true,
      }),
      columnHelper.accessor("ownerLogin", {
        id: "owner",
        header: "Owner",
        cell: (info) => info.getValue(),
        enableSorting: false,
      }),
    ],
    [],
  );

  // TanStack Table deliberately returns callable APIs that React Compiler skips.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.fontFileId),
  });

  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;

  const getHeaderSortProps = useCallback(
    (columnId: string, canSort: boolean) => {
      if (!canSort) {
        return {
          headerProps: {},
          buttonProps: null,
        };
      }
      const active = sorting[0]?.id === columnId;
      const desc = sorting[0]?.desc;
      return {
        headerProps: active
          ? {
              "aria-sort": desc
                ? ("descending" as const)
                : ("ascending" as const),
            }
          : {},
        buttonProps: {
          type: "button" as const,
          onClick: () => onSortClick(columnId),
          "data-sortable": "true" as const,
          "data-sorted": active ? (desc ? "desc" : "asc") : "none",
        },
      };
    },
    [onSortClick, sorting],
  );

  const getRowProps = useCallback(
    (node: FontFile) => {
      const interaction = shell.getRowInteractionProps(node);
      // Dense mode: no hover face load — only select mounts specimen/face.
      return {
        selectionProps: {
          type: "button" as const,
          onClick: (
            event: Parameters<typeof interaction.onClick>[0],
          ) => {
            event.stopPropagation();
            interaction.onClick(event);
          },
          onKeyDown: interaction.onKeyDown,
          "aria-pressed": interaction["aria-pressed"],
          "data-selected": interaction["data-selected"],
          "data-font-row": true,
        },
        onClick: () => shell.selectFont(node),
        selected: interaction.selected,
        node,
      };
    },
    [shell],
  );

  return {
    table,
    headerGroups,
    rows,
    getHeaderSortProps,
    getRowProps,
    empty: data.length === 0,
    isFetching: shell.isFetching,
    isPlaceholderData: shell.isPlaceholderData,
    error: shell.error,
    retryCatalogProps: shell.retryCatalogProps,
    canResetPagination: shell.catalog.context.after != null,
    resetPaginationProps: shell.resetPaginationProps,
    totalCount: shell.totalCount,
  } as const;
}

export type UseDenseFontTableReturn = ReturnType<typeof useDenseFontTable>;
