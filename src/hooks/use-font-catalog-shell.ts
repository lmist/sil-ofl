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
import type { CatalogUrlSlice } from "@/machines/catalog-url";
import type {
  SpecimenContext,
  SpecimenEvent,
} from "@/machines/specimen-machine";
import type {
  FontConnection,
  FontFile,
  FontSort,
} from "@/types/catalog";
import {
  cssFontFamilyValue,
  resolveFontFamily,
  resolveFontStyle,
  resolveFontWeight,
} from "@/lib/font-face-descriptors";
import { isPositiveSafeInteger } from "@/lib/positive-safe-integer";
import { queryKeys } from "@/lib/query-keys";

export const DEFAULT_SPECIMEN_TEXT =
  "The quick brown fox jumps over the lazy dog";

type LoadSpecimenEvent = Extract<SpecimenEvent, { type: "LOAD" }>;

function toLoadSpecimenEvent(node: FontFile): LoadSpecimenEvent | null {
  if (!isPositiveSafeInteger(node.fontFileId)) return null;

  return {
    type: "LOAD",
    fontId: node.fontFileId,
    cdnUrl: node.cdnUrl,
    rawUrl: node.rawUrl,
    format: node.format,
    family: node.familyGuess,
    fileName: node.fileName,
    weight: node.weightGuess,
    style: node.styleGuess,
  };
}

function specimenMatchesFont(
  context: SpecimenContext,
  node: FontFile,
): boolean {
  return (
    context.fontId === node.fontFileId &&
    context.cdnUrl === node.cdnUrl &&
    context.rawUrl === node.rawUrl &&
    context.format === node.format &&
    context.fileName === node.fileName &&
    context.family === resolveFontFamily(node) &&
    context.weight === resolveFontWeight(node.weightGuess) &&
    context.style === resolveFontStyle(node.styleGuess)
  );
}

function asFontConnection(value: unknown): FontConnection | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("edges" in value) ||
    !Array.isArray(value.edges)
  ) {
    return null;
  }
  return value as FontConnection;
}

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
  const specimen = useSpecimenMachine();
  const specimenActorRef = specimen.actorRef;
  const sendSpecimen = specimen.send;
  const statsQuery = useCatalogStatsQuery();
  const refetchStats = statsQuery.refetch;
  const [specimenText, setSpecimenText] = useState(DEFAULT_SPECIMEN_TEXT);
  const [denseMode, setDenseMode] = useState(false);
  const [isStatsRetryPending, setIsStatsRetryPending] =
    useState(false);
  const [selectedFontCache, setSelectedFontCache] =
    useState<FontFile | null>(null);

  const onUrlHydrate = useCallback(
    (slice: CatalogUrlSlice) => {
      const selectedFontId = isPositiveSafeInteger(slice.selectedFontId)
        ? slice.selectedFontId
        : null;
      setSelectedFontCache((cached) =>
        selectedFontId != null && cached?.fontFileId === selectedFontId
          ? cached
          : null,
      );

      const specimenFontId =
        specimenActorRef.getSnapshot().context.fontId;
      if (selectedFontId == null) {
        sendSpecimen({ type: "CLEAR" });
      } else if (specimenFontId !== selectedFontId) {
        sendSpecimen({ type: "LOAD_BY_ID", fontId: selectedFontId });
      }
    },
    [specimenActorRef, sendSpecimen],
  );

  const catalog = useCatalogMachine({ onUrlHydrate });
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
  const refetchFonts = fontsQuery.refetch;

  const catalogError =
    error ||
    (matches("ready") && fontsQuery.isError
      ? CATALOG_LOAD_ERROR_MESSAGE
      : null);

  // A disabled draft query can still expose cached data for its uncommitted key.
  // Keep rendering the machine's last committed connection until debounce settles.
  const connection = (
    isDebouncing
      ? catalog.connection
      : fontsQuery.data ?? catalog.connection
  ) ?? null;

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
  const canPrev = context.cursorStack.length > 0;
  const selectedFontId = context.selectedFontId;

  useMountEffect(() => {
    const subscription = specimen.actorRef.subscribe((snapshot) => {
      const missingSelectedFont =
        snapshot.matches("error") &&
        snapshot.context.error === "Font not found" &&
        snapshot.context.cdnUrl == null &&
        snapshot.context.font == null &&
        snapshot.context.fontId != null &&
        catalog.actorRef.getSnapshot().context.selectedFontId ===
          snapshot.context.fontId;

      if (!missingSelectedFont) return;

      setSelectedFontCache(null);
      catalog.send({ type: "DESELECT" });
    });

    return () => {
      subscription.unsubscribe();
    };
  });

  useMountEffect(() => {
    if (selectedFontId != null) {
      specimen.send({ type: "LOAD_BY_ID", fontId: selectedFontId });
    }
  });

  useMountEffect(() => {
    const queryClient =
      catalog.actorRef.getSnapshot().context.queryClient;
    if (!queryClient) return;

    return queryClient.getQueryCache().subscribe((event) => {
      const catalogSnapshot = catalog.actorRef.getSnapshot();
      if (!catalogSnapshot.matches("ready")) return;

      const catalogContext = catalogSnapshot.context;
      const activeQuery = queryClient.getQueryCache().find({
        queryKey: queryKeys.fonts.list(
          toFontsFilter(catalogContext),
        ),
        exact: true,
      });
      if (event.query !== activeQuery || !event.query.isActive()) return;

      const selectedId = catalogContext.selectedFontId;
      if (!isPositiveSafeInteger(selectedId)) return;

      const updatedConnection = asFontConnection(
        event.query.state.data,
      );
      const updatedFont =
        updatedConnection?.edges.find(
          (edge) => edge.node.fontFileId === selectedId,
        )?.node ?? null;
      const loadEvent = updatedFont
        ? toLoadSpecimenEvent(updatedFont)
        : null;
      if (!updatedFont || !loadEvent) return;

      setSelectedFontCache((cached) =>
        cached === updatedFont ? cached : updatedFont,
      );
      if (
        !specimenMatchesFont(
          specimenActorRef.getSnapshot().context,
          updatedFont,
        )
      ) {
        specimenActorRef.send(loadEvent);
      }
    });
  });

  const isFetching =
    (matches("ready") && context.isLoading) ||
    (fontsQuery.isFetching && !isDebouncing);
  const isPageUnresolved =
    isDebouncing || isFetching || isPlaceholderData;

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
      const event = toLoadSpecimenEvent(node);
      if (!event) return;
      const snapshot = specimenActorRef.getSnapshot();
      if (
        (snapshot.matches("loadingFace") || snapshot.matches("ready")) &&
        specimenMatchesFont(snapshot.context, node)
      ) {
        return;
      }
      specimenActorRef.send(event);
    },
    [specimenActorRef],
  );

  const selectFont = useCallback(
    (node: FontFile) => {
      if (!isPositiveSafeInteger(node.fontFileId)) return;
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

  const onSearchCommit = useCallback(() => {
    send({ type: "COMMIT_Q" });
  }, [send]);

  const onSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        send({ type: "COMMIT_Q" });
      }
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
      send({
        type: "SET_FILTER",
        filter: { owner: e.target.value.trim() },
      });
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
    setSelectedFontCache(null);
    send({ type: "RESET" });
    specimen.send({ type: "CLEAR" });
  }, [send, specimen]);

  const onClearFilters = useCallback(() => {
    setSelectedFontCache(null);
    send({ type: "CLEAR_FILTERS" });
    specimen.send({ type: "CLEAR" });
  }, [send, specimen]);

  const refetchCatalog = useCallback(async () => {
    send({ type: "RETRY" });
    return refetchFonts();
  }, [send, refetchFonts]);

  const onRetryCatalog = useCallback(async () => {
    try {
      await refetchCatalog();
    } catch {
      // Inline catalog errors remain represented by machine/query state.
    }
  }, [refetchCatalog]);

  const onRetryCatalogBoundary = useCallback(async () => {
    const result = await refetchCatalog();
    if (result.isError) {
      throw result.error ?? new Error(CATALOG_LOAD_ERROR_MESSAGE);
    }
  }, [refetchCatalog]);

  const onRetryStats = useCallback(async () => {
    setIsStatsRetryPending(true);
    try {
      await refetchStats();
    } finally {
      setIsStatsRetryPending(false);
    }
  }, [refetchStats]);

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
        onBlur: onSearchCommit,
        onKeyDown: onSearchKeyDown,
        placeholder: "Family, file, owner…",
        autoComplete: "off",
        spellCheck: false,
        "aria-label": "Search fonts",
        "aria-busy": isDebouncing,
      }) as const,
    [
      context.q,
      onSearchChange,
      onSearchCommit,
      onSearchKeyDown,
      isDebouncing,
    ],
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
      const displayName = resolveFontFamily(node);
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
        "data-selected": selected ? "true" : "false",
        "data-face-ready": faceActive ? "true" : "false",
        selected,
        faceActive,
        faceStyle: faceActive
          ? ({
              fontFamily: `${cssFontFamilyValue(specimen.family!)}, sans-serif`,
            } as const)
          : undefined,
        displayName,
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
    return {
      fontFamily: `${cssFontFamilyValue(specimen.family)}, sans-serif`,
    } as const;
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
    statsError: statsQuery.isError || isStatsRetryPending,
    statsFetching: statsQuery.isFetching || isStatsRetryPending,
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
    onRetryCatalogBoundary,
    onRetryStats,
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
