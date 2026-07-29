"use client";

import { useMemo } from "react";
import { useFontCatalogShellContext } from "@/hooks/use-font-catalog-shell";

/**
 * Headless stats strip — TanStack Query stats + live connection count.
 */
export function useStatsStrip() {
  const shell = useFontCatalogShellContext();

  const rootProps = useMemo(
    () =>
      ({
        "aria-label": "Catalog statistics",
        "data-stats-strip": true,
      }) as const,
    [],
  );

  const items = useMemo(() => {
    const s = shell.stats;
    if (!s) {
      return [
        {
          key: "status",
          label: "Status",
          value: shell.statsLoading ? "…" : shell.statsError ? "—" : "…",
        },
      ] as const;
    }
    return [
      {
        key: "fonts",
        label: "Fonts",
        value: s.fontFiles.toLocaleString(),
      },
      {
        key: "repos",
        label: "Repos",
        value: s.repos.toLocaleString(),
      },
      {
        key: "owners",
        label: "Owners",
        value: s.owners.toLocaleString(),
      },
      {
        key: "matched",
        label: "Matched",
        value: shell.connection
          ? shell.totalCount.toLocaleString()
          : "…",
      },
    ] as const;
  }, [
    shell.stats,
    shell.statsLoading,
    shell.statsError,
    shell.connection,
    shell.totalCount,
  ]);

  return {
    rootProps,
    items,
    headerStatus: shell.headerStatus,
  } as const;
}

export type UseStatsStripReturn = ReturnType<typeof useStatsStrip>;
