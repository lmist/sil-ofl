"use client";

import dynamic from "next/dynamic";
import { Suspense, type ReactNode } from "react";
import { QueryProvider } from "@/components/providers/query-provider";
import {
  FontCatalogShellContext,
  useFontCatalogShell,
  type FontCatalogShellContextValue,
} from "@/hooks/use-font-catalog-shell";
import { FontFilterBar } from "@/components/catalog/font-filter-bar";
import { FilterChips } from "@/components/catalog/filter-chips";
import { StatsStrip } from "@/components/catalog/stats-strip";
import { CatalogErrorBoundary } from "@/components/catalog/catalog-error-boundary";
import { CatalogSkeleton } from "@/components/catalog/catalog-skeleton";
import { cn } from "@/lib/utils";

/**
 * Heavy list/table/specimen islands — code-split so home chrome JS stays small.
 * @tanstack/react-virtual only loads with FontList; table with DenseFontTable.
 */
const FontList = dynamic(
  () =>
    import("@/components/catalog/font-list").then((m) => m.FontList),
  {
    ssr: false,
    loading: () => (
      <div
        className="px-[var(--gutter)] py-8 text-[0.8125rem] text-muted-foreground"
        aria-busy="true"
      >
        Loading list…
      </div>
    ),
  },
);

const DenseFontTable = dynamic(
  () =>
    import("@/components/catalog/dense-font-table").then(
      (m) => m.DenseFontTable,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="px-[var(--gutter)] py-8 text-[0.8125rem] text-muted-foreground"
        aria-busy="true"
      >
        Loading table…
      </div>
    ),
  },
);

const FontSpecimen = dynamic(
  () =>
    import("@/components/catalog/font-specimen").then((m) => m.FontSpecimen),
  { ssr: false },
);

const FontUsePanel = dynamic(
  () =>
    import("@/components/catalog/font-use-panel").then((m) => m.FontUsePanel),
  { ssr: false },
);

function FontCatalogShellProvider({
  value,
  children,
}: {
  value: FontCatalogShellContextValue;
  children: ReactNode;
}) {
  return (
    <FontCatalogShellContext.Provider value={value}>
      {children}
    </FontCatalogShellContext.Provider>
  );
}

/**
 * Client catalog island: XState machines + TanStack Query + virtualizer.
 * Page/layout remain Server Components; this is the only home client root.
 */
function CatalogIslandInner({ className }: { className?: string }) {
  const shell = useFontCatalogShell();

  return (
    <FontCatalogShellProvider value={shell}>
      <section
        {...shell.shellProps}
        className={cn("flex min-h-0 flex-1 flex-col", className)}
      >
        <header className="flex min-h-[var(--header-height)] shrink-0 items-center justify-between border-b border-border px-[var(--gutter)]">
          <h1 className="text-[0.8125rem] tracking-tight text-foreground">
            SIL OFL Fonts
          </h1>
          <StatsStrip />
        </header>

        <FontFilterBar />
        <FilterChips />
        <FontSpecimen />
        <FontUsePanel />
        <CatalogErrorBoundary
          label="font list"
          onRetry={shell.onRetryCatalogBoundary}
        >
          {shell.denseMode ? <DenseFontTable /> : <FontList />}
        </CatalogErrorBoundary>
      </section>
    </FontCatalogShellProvider>
  );
}

/**
 * Catalog entry for the home route — QueryProvider scoped to this island.
 */
export function CatalogIsland({ className }: { className?: string }) {
  return (
    <QueryProvider>
      <Suspense fallback={<CatalogSkeleton />}>
        <CatalogIslandInner className={className} />
      </Suspense>
    </QueryProvider>
  );
}
