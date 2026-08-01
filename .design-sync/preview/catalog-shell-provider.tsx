"use client";

/**
 * Static catalog-shell context for previews.
 *
 * Every catalog component except FontRow, CatalogSkeleton and
 * CatalogErrorBoundary reads `useFontCatalogShellContext()`. In the application
 * that context comes from CatalogIsland, which drives two XState machines, a
 * TanStack Query cache, the Next app-router URL and a live GraphQL request.
 * None of that exists in Storybook or in a rendered design.
 *
 * This module supplies the same context shape as a fixed value, so the real
 * components render their real markup against realistic data. It is composition
 * data only — no component is reimplemented here.
 *
 * Consumed by:
 *   - .storybook/preview.tsx (decorator for every Catalog story)
 *   - .design-sync/config.json via `extraEntries` + `provider`, which makes
 *     CatalogPreviewProvider a bundle export wrapped around preview cards.
 *
 * Rows are real OFL repositories from data/all.jsonl. URLs follow the origins
 * approved by src/lib/external-url-policy.ts (INV-ARTIFACT-2), so snippets and
 * download links rendered by FontUsePanel are valid.
 */

import type { ReactNode } from "react";
import {
  FontCatalogShellContext,
  type FontCatalogShellContextValue,
} from "@/hooks/use-font-catalog-shell";
import type { FontRowInput } from "@/hooks/use-font-row";
import type {
  CatalogStats,
  FontConnection,
  FontFile,
} from "@/types/catalog";

type RowSeed = {
  id: number;
  owner: string;
  ownerType: "User" | "Organization";
  repo: string;
  branch: string;
  path: string;
  family: string;
  weight: number | null;
  style: string | null;
  format: string;
  variable: boolean;
  stars: number;
  reputation: number;
};

const ROW_SEEDS: readonly RowSeed[] = [
  {
    id: 4101,
    owner: "tonsky",
    ownerType: "User",
    repo: "FiraCode",
    branch: "master",
    path: "distr/woff2/FiraCode-Regular.woff2",
    family: "Fira Code",
    weight: 400,
    style: "normal",
    format: "woff2",
    variable: false,
    stars: 81869,
    reputation: 88503,
  },
  {
    id: 4102,
    owner: "be5invis",
    ownerType: "User",
    repo: "Iosevka",
    branch: "main",
    path: "dist/iosevka/woff2/Iosevka-Regular.woff2",
    family: "Iosevka",
    weight: 400,
    style: "normal",
    format: "woff2",
    variable: false,
    stars: 22545,
    reputation: 24149,
  },
  {
    id: 4103,
    owner: "rsms",
    ownerType: "User",
    repo: "inter",
    branch: "master",
    path: "docs/font-files/InterVariable.woff2",
    family: "Inter Variable",
    weight: null,
    style: "normal",
    format: "woff2",
    variable: true,
    stars: 19751,
    reputation: 20957,
  },
  {
    id: 4104,
    owner: "JetBrains",
    ownerType: "Organization",
    repo: "JetBrainsMono",
    branch: "master",
    path: "fonts/webfonts/JetBrainsMono-Bold.woff2",
    family: "JetBrains Mono",
    weight: 700,
    style: "normal",
    format: "woff2",
    variable: false,
    stars: 12906,
    reputation: 13977,
  },
  {
    id: 4105,
    owner: "adobe-fonts",
    ownerType: "Organization",
    repo: "source-code-pro",
    branch: "release",
    path: "WOFF2/OTF/SourceCodePro-It.otf.woff2",
    family: "Source Code Pro",
    weight: 400,
    style: "italic",
    format: "woff2",
    variable: false,
    stars: 20424,
    reputation: 24035,
  },
  {
    id: 4106,
    owner: "githubnext",
    ownerType: "Organization",
    repo: "monaspace",
    branch: "main",
    path: "fonts/webfonts/MonaspaceNeon-Medium.woff2",
    family: "Monaspace Neon",
    weight: 500,
    style: "normal",
    format: "woff2",
    variable: false,
    stars: 19500,
    reputation: 20481,
  },
  {
    id: 4107,
    owner: "IBM",
    ownerType: "Organization",
    repo: "plex",
    branch: "master",
    path: "IBM-Plex-Sans/fonts/complete/woff2/IBMPlexSans-Regular.woff2",
    family: "IBM Plex Sans",
    weight: 400,
    style: "normal",
    format: "woff2",
    variable: false,
    stars: 11528,
    reputation: 13081,
  },
  {
    id: 4108,
    owner: "subframe7536",
    ownerType: "User",
    repo: "maple-font",
    branch: "variable",
    path: "woff2/MapleMono-Variable.woff2",
    family: "Maple Mono",
    weight: null,
    style: "normal",
    format: "woff2",
    variable: true,
    stars: 27635,
    reputation: 30153,
  },
  {
    id: 4109,
    owner: "intel",
    ownerType: "Organization",
    repo: "intel-one-mono",
    branch: "main",
    path: "fonts/webfonts/IntelOneMono-Light.woff2",
    family: "Intel One Mono",
    weight: 300,
    style: "normal",
    format: "woff2",
    variable: false,
    stars: 9925,
    reputation: 10896,
  },
  {
    id: 4110,
    owner: "IdreesInc",
    ownerType: "User",
    repo: "Monocraft",
    branch: "main",
    path: "dist/Monocraft.otf",
    family: "Monocraft",
    weight: 400,
    style: "normal",
    format: "otf",
    variable: false,
    stars: 11195,
    reputation: 11767,
  },
];

function toFontFile(seed: RowSeed): FontFile {
  const fileName = seed.path.slice(seed.path.lastIndexOf("/") + 1);
  const fullName = `${seed.owner}/${seed.repo}`;
  return {
    fontFileId: seed.id,
    cdnUrl: `https://cdn.jsdelivr.net/gh/${fullName}@${seed.branch}/${seed.path}`,
    rawUrl: `https://raw.githubusercontent.com/${fullName}/${seed.branch}/${seed.path}`,
    format: seed.format,
    fileName,
    path: seed.path,
    familyGuess: seed.family,
    weightGuess: seed.weight,
    styleGuess: seed.style,
    isVariable: seed.variable,
    isWebfont: seed.format === "woff" || seed.format === "woff2",
    repoId: seed.id * 7,
    fullName,
    repoName: seed.repo,
    repoUrl: `https://github.com/${fullName}`,
    stars: seed.stars,
    reputation: seed.reputation,
    licenseSpdx: "OFL-1.1",
    defaultBranch: seed.branch,
    ownerLogin: seed.owner,
    ownerType: seed.ownerType,
    ownerUrl: `https://github.com/${seed.owner}`,
  };
}

/** Ten real OFL faces, sorted by reputation like the default catalog view. */
export const PREVIEW_FONTS: readonly FontFile[] = ROW_SEEDS.map(toFontFile);

function requireFont(index: number): FontFile {
  const font = PREVIEW_FONTS[index];
  if (!font) throw new Error(`preview font ${index} missing`);
  return font;
}

/** Fira Code — the row used wherever a single selected face is needed. */
export const PREVIEW_SELECTED_FONT: FontFile = requireFont(0);

export const PREVIEW_CONNECTION: FontConnection = {
  edges: PREVIEW_FONTS.map((node) => ({
    cursor: `cursor-${node.fontFileId}`,
    node,
  })),
  pageInfo: { hasNextPage: true, endCursor: "cursor-4110" },
  totalCount: 11429,
};

/** Mirrors data/summary.json so the strip reads like the live catalog. */
export const PREVIEW_STATS: CatalogStats = {
  repos: 12782,
  fontFiles: 11429,
  owners: 3676,
  reposWithFiles: 11318,
};

/** The shared sample string every row renders, matching DEFAULT_SPECIMEN_TEXT. */
export const PREVIEW_SPECIMEN_TEXT =
  "The quick brown fox jumps over the lazy dog";

const noop = () => {};

function rowInteractionProps(node: FontFile, selected: boolean) {
  return {
    type: "button" as const,
    onClick: noop,
    onMouseEnter: noop,
    onFocus: noop,
    onKeyDown: noop,
    "aria-pressed": selected,
    "data-selected": selected ? "true" : "false",
    "data-face-ready": "false",
    selected,
    faceActive: false,
    faceStyle: undefined,
    displayName: node.familyGuess ?? node.fileName,
    meta: `${node.ownerLogin} · ${node.format} · ★${node.stars}`,
    node,
  };
}

/**
 * Builds the prop bundle FontRow expects.
 *
 * FontRow is the one catalog component driven entirely by props, so its
 * previews compose this directly instead of going through the shell context.
 */
export function buildFontRowInput(
  node: FontFile,
  options: { selected?: boolean; sampleText?: string } = {},
): FontRowInput {
  const { selected = false, sampleText } = options;
  const interaction = rowInteractionProps(node, selected);
  return {
    rootProps: {
      type: interaction.type,
      onClick: interaction.onClick,
      onMouseEnter: interaction.onMouseEnter,
      onFocus: interaction.onFocus,
      onKeyDown: interaction.onKeyDown,
      "aria-pressed": interaction["aria-pressed"],
      "data-selected": interaction["data-selected"],
      "data-face-ready": interaction["data-face-ready"],
    },
    sampleProps: { "aria-hidden": true },
    // useFontList renders `specimenText || displayName`; mirror that default so
    // a standalone row looks like a row inside the list.
    sampleText: sampleText ?? PREVIEW_SPECIMEN_TEXT,
    name: interaction.displayName,
    meta: interaction.meta,
    selected,
    faceActive: false,
    node,
  };
}

/** Options accepted by {@link buildCatalogShellValue}. */
export type CatalogPreviewOptions = {
  /** Font selected in the row list; drives specimen and use-panel surfaces. */
  selectedFontId?: number | null;
  /** Committed search term shown in the search field and active chips. */
  q?: string;
  /** Rows to display. Defaults to all ten preview faces. */
  edges?: FontConnection["edges"];
  /** Renders the inline catalog error surface when set. */
  error?: string | null;
  /** Marks rows as retained/stale (INV-PAGE-6). */
  isPlaceholderData?: boolean;
  /** Empty-result state for the list and dense table. */
  isEmpty?: boolean;
  /** Puts pagination on a later page so Previous becomes available. */
  onLaterPage?: boolean;
  /** Switches the results region to the dense table projection. */
  denseMode?: boolean;
  /** Fails the statistics strip without failing the catalog (INV-ERROR-2). */
  statsError?: boolean;
  /** Active format filter chips. */
  format?: string;
  /** Active owner filter chip. */
  owner?: string;
  /** Active minimum-stars filter chip. */
  minStars?: number;
  /** Webfont-only filter toggle. */
  webfont?: boolean;
  /** Variable-only filter toggle. */
  variable?: boolean;
};

/**
 * Builds a complete catalog-shell context value.
 *
 * `catalog` and `specimen` are narrowed: consumers only read
 * `catalog.context.after`, `catalog.context.cursorStack`, `specimen.weight`
 * and `specimen.style`, so the rest of those machine objects is not modelled.
 */
export function buildCatalogShellValue(
  options: CatalogPreviewOptions = {},
): FontCatalogShellContextValue {
  const {
    selectedFontId = null,
    q = "",
    edges = PREVIEW_CONNECTION.edges,
    error = null,
    isPlaceholderData = false,
    isEmpty = false,
    onLaterPage = false,
    denseMode = false,
    statsError = false,
    format = "",
    owner = "",
    minStars = 0,
    webfont = false,
    variable = false,
  } = options;

  const connection: FontConnection = { ...PREVIEW_CONNECTION, edges };
  const selectedEdge =
    selectedFontId == null
      ? null
      : (edges.find((edge) => edge.node.fontFileId === selectedFontId) ?? null);
  const selectedFace = selectedEdge?.node ?? null;
  const filters = { format, owner, minStars, webfont, variable };

  const totalCount = isEmpty ? 0 : connection.totalCount;
  const headerStatus = error
    ? "Error"
    : isEmpty
      ? "0 fonts"
      : `${totalCount.toLocaleString()} fonts`;

  const value = {
    catalog: {
      context: {
        after: onLaterPage ? "cursor-4105" : null,
        cursorStack: onLaterPage ? [""] : [],
      },
    },
    specimen: {
      weight: selectedFace?.weightGuess ?? 400,
      style: selectedFace?.styleGuess ?? "normal",
    },
    send: noop,
    edges,
    connection,
    error,
    selectedFontId,
    selectedEdge,
    totalCount,
    canPrev: onLaterPage,
    hasNext: !isEmpty,
    isDebouncing: false,
    isFetching: false,
    isEmpty,
    isPlaceholderData,
    headerStatus,
    stats: statsError ? null : PREVIEW_STATS,
    statsLoading: false,
    statsError,
    statsFetching: false,
    denseMode,

    filters,
    q,
    sort: "REPUTATION_DESC",
    fontsFilter: { q, sort: "REPUTATION_DESC", first: 10 },

    shellProps: {
      "aria-label": "Font catalog",
      "data-catalog-shell": true,
      "data-catalog-state": "ready",
      "data-dense-mode": denseMode ? "true" : "false",
    },
    onDeselect: noop,

    searchInputProps: {
      type: "search",
      value: q,
      onChange: noop,
      onBlur: noop,
      onKeyDown: noop,
      placeholder: "Family, file, owner…",
      autoComplete: "off",
      spellCheck: false,
      "aria-label": "Search fonts",
      "aria-busy": false,
    },
    formatSelectProps: {
      value: format,
      onChange: noop,
      "aria-label": "Format",
    },
    ownerInputProps: {
      type: "text",
      value: owner,
      onChange: noop,
      placeholder: "github login",
      autoComplete: "off",
      spellCheck: false,
      "aria-label": "Owner",
    },
    sortSelectProps: {
      value: "REPUTATION_DESC",
      onChange: noop,
      "aria-label": "Sort",
    },
    minStarsInputProps: {
      type: "number",
      min: 0,
      step: 1,
      value: minStars > 0 ? minStars : "",
      onChange: noop,
      placeholder: "0",
      "aria-label": "Minimum stars",
    },
    webfontToggleProps: {
      type: "button",
      onClick: noop,
      "aria-pressed": webfont,
      "aria-label": "Filter webfonts",
    },
    variableToggleProps: {
      type: "button",
      onClick: noop,
      "aria-pressed": variable,
      "aria-label": "Filter variable fonts",
    },
    denseModeToggleProps: {
      type: "button",
      onClick: noop,
      "aria-pressed": denseMode,
      "aria-label": "Dense table mode",
    },
    prevPageProps: {
      type: "button",
      onClick: noop,
      disabled: !onLaterPage,
      "aria-label": "Previous page",
    },
    nextPageProps: {
      type: "button",
      onClick: noop,
      disabled: isEmpty,
      "aria-label": "Next page",
    },
    resetPaginationProps: {
      type: "button",
      onClick: noop,
      "aria-label": "Reset pagination",
    },
    clearFiltersProps: {
      type: "button",
      onClick: noop,
      "aria-label": "Clear filters",
    },
    retryCatalogProps: { type: "button", onClick: noop },
    onRetryCatalogBoundary: async () => {},
    onRetryStats: async () => {},
    retrySpecimenProps: { type: "button", onClick: noop },

    getRowInteractionProps: (node: FontFile) =>
      rowInteractionProps(node, node.fontFileId === selectedFontId),
    loadSpecimen: noop,
    selectFont: noop,

    specimenFaceStyle: undefined,
    specimenFamily: selectedFace ? (selectedFace.familyGuess ?? null) : null,
    specimenIsReady: false,
    specimenIsLoading: false,
    specimenIsError: false,
    specimenError: null,
    specimenFontId: selectedFontId,
    specimenText: PREVIEW_SPECIMEN_TEXT,
    onSpecimenTextChange: noop,
    setSpecimenText: noop,
  };

  return value as unknown as FontCatalogShellContextValue;
}

/** The default context: ten rows, nothing selected, no filters. */
export const PREVIEW_SHELL_VALUE = buildCatalogShellValue();

/**
 * Answers the two GraphQL documents CatalogIsland issues (Fonts and
 * CatalogStats) from the preview fixtures, and returns a restore function.
 *
 * CatalogIsland is the only component that fetches, so previewing it means
 * serving its requests rather than mocking its context. Shared by the story and
 * by the owned preview card, which run in different harnesses.
 */
export function installCatalogGraphqlStub(): () => void {
  const real = globalThis.fetch;

  const fontsPayload = {
    data: {
      fonts: {
        totalCount: PREVIEW_STATS.fontFiles,
        pageInfo: PREVIEW_CONNECTION.pageInfo,
        edges: PREVIEW_FONTS.map((node) => ({
          cursor: `cursor-${node.fontFileId}`,
          node: { id: String(node.fontFileId), ...node },
        })),
      },
    },
  };
  const statsPayload = { data: { stats: PREVIEW_STATS } };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("/api/graphql")) return real(input, init);

    const body = typeof init?.body === "string" ? init.body : "";
    const payload = body.includes("CatalogStats") ? statsPayload : fontsPayload;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return () => {
    globalThis.fetch = real;
  };
}

/**
 * The design system's root surface.
 *
 * Every component here takes its background and text colour from the document
 * body: globals.css styles `body` with `hsl(var(--background))` /
 * `hsl(var(--foreground))`, and src/app/layout.tsx carries the same classes.
 * Anything rendering these components outside that body — a preview card, a
 * generated design — must supply the surface itself or the components paint
 * white-on-white.
 *
 * Wired as `provider` in .design-sync/config.json so every preview card renders
 * on it, and documented in the conventions header as the required root wrapper.
 */
export function DesignSurface({ children }: { children?: ReactNode }) {
  // Colour only, deliberately no layout. src/app/layout.tsx also puts
  // `flex min-h-full flex-col` on <body>, but that is for the app's full-height
  // shell; imposing it here stretches bare inline children (a lone Button spans
  // the full card width instead of hugging its label).
  return <div className="bg-background text-foreground">{children}</div>;
}

/**
 * Wraps children in a fixed catalog-shell context.
 *
 * Exported into the design-system bundle so every preview card can render
 * context-dependent catalog components.
 */
export function CatalogPreviewProvider({
  children,
  value = PREVIEW_SHELL_VALUE,
}: {
  children?: ReactNode;
  value?: FontCatalogShellContextValue;
}) {
  return (
    <FontCatalogShellContext.Provider value={value}>
      {children}
    </FontCatalogShellContext.Provider>
  );
}
