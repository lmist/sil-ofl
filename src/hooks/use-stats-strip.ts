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
      if (shell.statsError) return [];
      return [
        {
          key: "status",
          label: "Status",
          value: "…",
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
    shell.statsError,
    shell.connection,
    shell.totalCount,
  ]);

  const failureProps = useMemo(
    () =>
      shell.statsError
        ? ({
            role: "alert" as const,
            "aria-atomic": true,
          } as const)
        : null,
    [shell.statsError],
  );

  const retryProps = useMemo(
    () =>
      ({
        type: "button" as const,
        onClick: shell.onRetryStats,
        disabled: shell.statsFetching,
      }) as const,
    [shell.onRetryStats, shell.statsFetching],
  );

  return {
    rootProps,
    items,
    headerStatus: shell.headerStatus,
    failureProps,
    retryProps,
  } as const;
}

export type UseStatsStripReturn = ReturnType<typeof useStatsStrip>;
