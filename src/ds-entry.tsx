"use client";

/**
 * Public component surface of the SIL OFL Fonts design system.
 *
 * web-app is a private Next.js application rather than a published library, so
 * it has no `main`/`module`/`exports` entry a bundler can start from. This
 * module is that entry: it re-exports components the application already ships
 * and defines nothing new.
 *
 * Two consumers:
 *   - .design-sync/config.json (`entry`) — esbuild bundles it into
 *     `window.SilOflFontsDS` for claude.ai/design.
 *   - .design-sync/tsconfig.dts.json — emits the `.d.ts` tree that becomes each
 *     component's published prop contract.
 *
 * Imports are relative on purpose: the emitted declarations keep their module
 * specifiers verbatim, and `@/…` aliases would not resolve for the consumer
 * reading those declarations.
 */

// ── Primitives ──────────────────────────────────────────────────────────────
export { Button, buttonVariants, type ButtonProps } from "./components/ui/button";

// ── Catalog ─────────────────────────────────────────────────────────────────
export {
  CatalogIsland,
  CatalogIsland as FontCatalogShell,
  CatalogIsland as CatalogShell,
} from "./components/catalog/catalog-island";
export { CatalogErrorBoundary } from "./components/catalog/catalog-error-boundary";
export { CatalogSkeleton } from "./components/catalog/catalog-skeleton";
export { DenseFontTable } from "./components/catalog/dense-font-table";
export { FilterChips } from "./components/catalog/filter-chips";
export { FontFilterBar } from "./components/catalog/font-filter-bar";
export { FontList } from "./components/catalog/font-list";
export { FontRow } from "./components/catalog/font-row";
export { FontSearchField } from "./components/catalog/font-search-field";
export { FontSpecimen } from "./components/catalog/font-specimen";
export { FontUsePanel } from "./components/catalog/font-use-panel";
export { PaginationControls } from "./components/catalog/pagination-controls";
export { StatsStrip } from "./components/catalog/stats-strip";

// ── Providers and context ───────────────────────────────────────────────────
export { QueryProvider } from "./components/providers/query-provider";
export {
  FontCatalogShellContext,
  useFontCatalogShellContext,
  DEFAULT_SPECIMEN_TEXT,
  type FontCatalogShellContextValue,
} from "./hooks/use-font-catalog-shell";
export type { FontRowInput } from "./hooks/use-font-row";

// ── Utilities and domain types ──────────────────────────────────────────────
export { cn } from "./lib/utils";
export type {
  CatalogStats,
  FontConnection,
  FontFile,
  FontFormat,
  FontSort,
  FontsFilter,
} from "./types/catalog";
