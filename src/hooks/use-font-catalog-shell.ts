"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useCatalogMachine } from "@/hooks/use-catalog-machine";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { useSpecimenMachine } from "@/hooks/use-specimen-machine";
import {
  useCatalogStatsQuery,
  useFontsQuery,
  usePrefetchNextFontsPage,
} from "@/hooks/use-fonts-query";
import {
  CATALOG_LOAD_ERROR_MESSAGE,
  parseMinStarsInput,
  toFontsFilter,
} from "@/machines/catalog-machine";
import type { CatalogEvent } from "@/machines/catalog-machine";
import type { FontFile, FontSort } from "@/types/catalog";

export const DEFAULT_SPECIMEN_TEXT =
  "The quick brown fox jumps over the lazy dog";

export type FontCatalogShellContextValue = ReturnType<
  typeof useFontCatalogShell
>;

export const FontCatalogShellContext =
  createContext<FontCatalogShellContextValue | null>(null);

export function useFontCatalogShellContext(): FontCatalogShellContextValue {
  const ctx = useContext(FontCatalogShellContext);
  if (!ctx) {
    throw new Error(
      "useFontCatalogShellContext must be used within FontCatalogShell",
    );
  }
  return ctx;
}

/**
 * Compound catalog engine: XState catalog + specimen machines, TanStack Query
 * (keepPreviousData / prefetch), derived UI values and prop bundles.
 * Policy stays in components.
 */
export function useFontCatalogShell() {
  const catalog = useCatalogMachine();
  const specimen = useSpecimenMachine();
  const statsQuery = useCatalogStatsQuery();
  const [specimenText, setSpecimenText] = useState(DEFAULT_SPECIMEN_TEXT);
  const [denseMode, setDenseMode] = useState(false);
  const [selectedFontCache, setSelectedFontCache] =
    useState<FontFile | null>(null);

  const { context, error, send, matches } = catalog;

  // GraphQL / query variables mirror catalogMachine context exactly.
  const fontsFilter = useMemo(
    () => toFontsFilter(context),
    // Primitive fields only — avoid re-keying on connection / isLoading churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional field pick
    [
      context.q,
      context.filters.format,
      context.filters.owner,
      context.filters.minStars,
      context.filters.webfont,
      context.filters.variable,
      context.pageSize,
      context.after,
      context.sort,
    ],
  );

  const isDebouncing = matches("debouncing_q");

  // Parallel TanStack Query: same key as machine actor; keepPreviousData for smooth filters.
  const fontsQuery = useFontsQuery(fontsFilter, {
    enabled: !isDebouncing,
  });

  const catalogError =
    error || (fontsQuery.isError ? CATALOG_LOAD_ERROR_MESSAGE : null);

  // Prefer query data (includes placeholder), fall back to machine connection.
  const connection =
    fontsQuery.data ?? catalog.connection ?? null;

  const isPlaceholderData = Boolean(
    fontsQuery.isPlaceholderData ||
      (catalog.context.isLoading &&
        catalog.connection != null &&
        fontsQuery.data === undefined) ||
      (catalogError != null && connection != null),
  );

  usePrefetchNextFontsPage(fontsFilter, connection?.pageInfo, {
    enabled: !isDebouncing && Boolean(connection?.pageInfo.hasNextPage),
  });

  const edges = useMemo(
    () => connection?.edges ?? [],
    [connection?.edges],
  );
  const totalCount = connection?.totalCount ?? 0;
  const hasNext = connection?.pageInfo.hasNextPage ?? false;
  const endCursor = connection?.pageInfo.endCursor ?? null;
  const canPrev = context.cursorStack.length > 0 || context.after != null;
  const selectedFontId = context.selectedFontId;

  useMountEffect(() => {
    if (selectedFontId != null) {
      specimen.send({ type: "LOAD_BY_ID", fontId: selectedFontId });
    }
  });

  const isFetching =
    (matches("ready") && context.isLoading) ||
    (fontsQuery.isFetching && !isDebouncing);
  const isPageUnresolved = isFetching || isPlaceholderData;

  const isEmpty =
    matches("ready") &&
    !context.isLoading &&
    !fontsQuery.isFetching &&
    connection != null &&
    edges.length === 0 &&
    !isPlaceholderData;

  const selectedEdge = useMemo(
    () => {
      if (selectedFontId == null) return null;

      const visible =
        edges.find((edge) => edge.node.fontFileId === selectedFontId) ?? null;
      if (visible) return visible;

      if (selectedFontCache?.fontFileId === selectedFontId) {
        return {
          cursor: `selected-${selectedFontId}`,
          node: selectedFontCache,
        };
      }

      if (specimen.context.font?.fontFileId === selectedFontId) {
        return {
          cursor: `selected-${selectedFontId}`,
          node: specimen.context.font,
        };
      }

      return null;
    },
    [
      edges,
      selectedFontId,
      selectedFontCache,
      specimen.context.font,
    ],
  );

  const loadSpecimen = useCallback(
    (node: FontFile) => {
      const event = {
        type: "LOAD",
        fontId: node.fontFileId,
        cdnUrl: node.cdnUrl,
        rawUrl: node.rawUrl,
        format: node.format,
        family: node.familyGuess,
        fileName: node.fileName,
        weight: node.weightGuess,
        style: node.styleGuess,
      } as const;
      specimen.send(event);
    },
    [specimen],
  );

  const selectFont = useCallback(
    (node: FontFile) => {
      setSelectedFontCache(node);
      send({ type: "SELECT_FONT", id: node.fontFileId });
      loadSpecimen(node);
    },
    [send, loadSpecimen],
  );

  const onSearchChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      send({ type: "SET_Q", q: e.target.value });
    },
    [send],
  );

  const onFormatChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      send({ type: "SET_FILTER", filter: { format: e.target.value } });
    },
    [send],
  );

  const onOwnerChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      send({ type: "SET_FILTER", filter: { owner: e.target.value } });
    },
    [send],
  );

  const onSortChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      send({
        type: "SET_SORT",
        sort: e.target.value as FontSort,
      });
    },
    [send],
  );

  const onMinStarsChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      send({
        type: "SET_FILTER",
        filter: { minStars: parseMinStarsInput(e.target.value) },
      });
    },
    [send],
  );

  const onWebfontToggle = useCallback(() => {
    send({ type: "TOGGLE_WEBFONT" });
  }, [send]);

  const onVariableToggle = useCallback(() => {
    send({ type: "TOGGLE_VARIABLE" });
  }, [send]);

  const onPrevPage = useCallback(() => {
    send({ type: "PREV_PAGE" });
  }, [send]);

  const onNextPage = useCallback(() => {
    if (endCursor) send({ type: "NEXT_PAGE", endCursor });
  }, [send, endCursor]);

  const onResetPagination = useCallback(() => {
    send({ type: "GO_FIRST" });
  }, [send]);

  const onClearFilters = useCallback(() => {
    setSelectedFontCache(null);
    send({ type: "CLEAR_FILTERS" });
    specimen.send({ type: "CLEAR" });
  }, [send, specimen]);

  const onRetryCatalog = useCallback(() => {
    send({ type: "RETRY" });
  }, [send]);

  const onRetrySpecimen = useCallback(() => {
    specimen.send({ type: "RETRY" });
  }, [specimen]);

  const onSpecimenTextChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setSpecimenText(e.target.value);
    },
    [],
  );

  const onDeselect = useCallback(() => {
    setSelectedFontCache(null);
    send({ type: "DESELECT" });
    specimen.send({ type: "CLEAR" });
  }, [send, specimen]);

  const onDenseModeToggle = useCallback(() => {
    setDenseMode((v) => !v);
  }, []);

  const headerStatus = useMemo(() => {
    if (catalogError) return "Error";
    if (isDebouncing) return "Searching…";
    if (isFetching && edges.length === 0) return "Loading…";
    if (connection) {
      const n = totalCount.toLocaleString();
      return isPlaceholderData || isFetching ? `${n} fonts…` : `${n} fonts`;
    }
    return "Loading…";
  }, [
    catalogError,
    isDebouncing,
    isFetching,
    connection,
    totalCount,
    isPlaceholderData,
    edges.length,
  ]);

  const shellProps = useMemo(
    () =>
      ({
        "aria-label": "Font catalog",
        "data-catalog-shell": true,
        "data-catalog-state": String(catalog.snapshot.value),
        "data-dense-mode": denseMode ? "true" : "false",
      }) as const,
    [catalog.snapshot.value, denseMode],
  );

  const searchInputProps = useMemo(
    () =>
      ({
        type: "search" as const,
        value: context.q,
        onChange: onSearchChange,
        placeholder: "Family, file, owner…",
        autoComplete: "off",
        spellCheck: false,
        "aria-label": "Search fonts",
        "aria-busy": isDebouncing,
      }) as const,
    [context.q, onSearchChange, isDebouncing],
  );

  const formatSelectProps = useMemo(
    () =>
      ({
        value: context.filters.format,
        onChange: onFormatChange,
        "aria-label": "Format",
      }) as const,
    [context.filters.format, onFormatChange],
  );

  const ownerInputProps = useMemo(
    () =>
      ({
        type: "text" as const,
        value: context.filters.owner,
        onChange: onOwnerChange,
        placeholder: "github login",
        autoComplete: "off",
        spellCheck: false,
        "aria-label": "Owner",
      }) as const,
    [context.filters.owner, onOwnerChange],
  );

  const sortSelectProps = useMemo(
    () =>
      ({
        value: context.sort,
        onChange: onSortChange,
        "aria-label": "Sort",
      }) as const,
    [context.sort, onSortChange],
  );

  const minStarsInputProps = useMemo(
    () =>
      ({
        type: "number" as const,
        min: 0,
        step: 1,
        value: context.filters.minStars > 0 ? context.filters.minStars : "",
        onChange: onMinStarsChange,
        placeholder: "0",
        "aria-label": "Minimum stars",
      }) as const,
    [context.filters.minStars, onMinStarsChange],
  );

  const webfontToggleProps = useMemo(
    () =>
      ({
        type: "button" as const,
        onClick: onWebfontToggle,
        "aria-pressed": context.filters.webfont === true,
        "aria-label": "Filter webfonts",
      }) as const,
    [context.filters.webfont, onWebfontToggle],
  );

  const variableToggleProps = useMemo(
    () =>
      ({
        type: "button" as const,
        onClick: onVariableToggle,
        "aria-pressed": context.filters.variable === true,
        "aria-label": "Filter variable fonts",
      }) as const,
    [context.filters.variable, onVariableToggle],
  );

  const denseModeToggleProps = useMemo(
    () =>
      ({
        type: "button" as const,
        onClick: onDenseModeToggle,
        "aria-pressed": denseMode,
        "aria-label": "Dense table mode",
      }) as const,
    [denseMode, onDenseModeToggle],
  );

  const prevPageProps = useMemo(
    () =>
      ({
        type: "button" as const,
        onClick: onPrevPage,
        disabled: isPageUnresolved || !canPrev,
        "aria-label": "Previous page",
      }) as const,
    [onPrevPage, canPrev, isPageUnresolved],
  );

  const nextPageProps = useMemo(
    () =>
      ({
        type: "button" as const,
        onClick: onNextPage,
        disabled: isPageUnresolved || !hasNext || !endCursor,
        "aria-label": "Next page",
      }) as const,
    [onNextPage, hasNext, endCursor, isPageUnresolved],
  );

  const resetPaginationProps = useMemo(
    () =>
      ({
        type: "button" as const,
        onClick: onResetPagination,
        "aria-label": "Reset pagination",
      }) as const,
    [onResetPagination],
  );

  const clearFiltersProps = useMemo(
    () =>
      ({
        type: "button" as const,
        onClick: onClearFilters,
        "aria-label": "Clear filters",
      }) as const,
    [onClearFilters],
  );

  const retryCatalogProps = useMemo(
    () =>
      ({
        type: "button" as const,
        onClick: onRetryCatalog,
      }) as const,
    [onRetryCatalog],
  );

  const retrySpecimenProps = useMemo(
    () =>
      ({
        type: "button" as const,
        onClick: onRetrySpecimen,
      }) as const,
    [onRetrySpecimen],
  );

  const getRowInteractionProps = useCallback(
    (node: FontFile) => {
      const selected = selectedFontId === node.fontFileId;
      const faceActive =
        specimen.isReady &&
        specimen.context.fontId === node.fontFileId &&
        Boolean(specimen.family);

      const onClick = (e: MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        selectFont(node);
      };

      // Hover/focus loads face only for this row — never for offscreen virtual rows.
      const onMouseEnter = () => {
        if (selectedFontId == null) loadSpecimen(node);
      };

      const onFocus = () => {
        if (selectedFontId == null) loadSpecimen(node);
      };

      const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectFont(node);
        }
      };

      return {
        type: "button" as const,
        onClick,
        onMouseEnter,
        onFocus,
        onKeyDown,
        "aria-pressed": selected,
        "aria-label": `Select ${node.familyGuess ?? node.fileName}`,
        "data-selected": selected ? "true" : "false",
        "data-face-ready": faceActive ? "true" : "false",
        selected,
        faceActive,
        faceStyle: faceActive
          ? ({ fontFamily: `"${specimen.family}", sans-serif` } as const)
          : undefined,
        displayName: node.familyGuess ?? node.fileName,
        meta: `${node.ownerLogin} · ${node.format} · ★${node.stars}`,
        node,
      };
    },
    [
      selectedFontId,
      specimen.isReady,
      specimen.context.fontId,
      specimen.family,
      selectFont,
      loadSpecimen,
    ],
  );

  const specimenFaceStyle = useMemo(() => {
    if (!specimen.isReady || !specimen.family) return undefined;
    return { fontFamily: `"${specimen.family}", sans-serif` } as const;
  }, [specimen.isReady, specimen.family]);

  const stats = statsQuery.data ?? null;

  const sendEvent = useCallback(
    (event: CatalogEvent) => {
      send(event);
    },
    [send],
  );

  return {
    // machines / raw
    catalog,
    specimen,
    send: sendEvent,
    edges,
    connection,
    error: catalogError,
    selectedFontId,
    selectedEdge,
    totalCount,
    canPrev,
    hasNext,
    isDebouncing,
    isFetching,
    isEmpty,
    isPlaceholderData,
    headerStatus,
    stats,
    statsLoading: statsQuery.isLoading,
    statsError: statsQuery.isError,
    denseMode,

    // filters snapshot
    filters: context.filters,
    q: context.q,
    sort: context.sort,
    fontsFilter,

    // shell
    shellProps,
    onDeselect,

    // prop bundles
    searchInputProps,
    formatSelectProps,
    ownerInputProps,
    sortSelectProps,
    minStarsInputProps,
    webfontToggleProps,
    variableToggleProps,
    denseModeToggleProps,
    prevPageProps,
    nextPageProps,
    resetPaginationProps,
    clearFiltersProps,
    retryCatalogProps,
    retrySpecimenProps,

    // row factory
    getRowInteractionProps,
    loadSpecimen,
    selectFont,

    // specimen face + shared sample string
    specimenFaceStyle,
    specimenFamily: specimen.family,
    specimenIsReady: specimen.isReady,
    specimenIsLoading: specimen.isLoading,
    specimenIsError: specimen.isError,
    specimenError: specimen.error,
    specimenFontId: specimen.context.fontId,
    specimenText,
    onSpecimenTextChange,
    setSpecimenText,
  } as const;
}

export type UseFontCatalogShellReturn = ReturnType<typeof useFontCatalogShell>;
