"use client";

import { useStatsStrip } from "@/hooks/use-stats-strip";
import { cn } from "@/lib/utils";

/**
 * Policy-only stats — tabular figures, quiet chrome.
 */
export function StatsStrip({ className }: { className?: string }) {
  const stats = useStatsStrip();

  return (
    <div
      {...stats.rootProps}
      className={cn(
        "flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[0.75rem] text-muted-foreground",
        className,
      )}
    >
      <span className="tabular-nums text-foreground/80">
        {stats.headerStatus}
      </span>
      {stats.failureProps ? (
        <span
          {...stats.failureProps}
          className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"
        >
          <span>Statistics unavailable.</span>
          <button
            {...stats.retryProps}
            className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-sm px-1.5 text-foreground underline decoration-foreground/40 underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50"
          >
            Retry statistics
          </button>
        </span>
      ) : (
        stats.items.map((item) => (
          <span key={item.key} className="tabular-nums">
            <span className="text-muted-foreground">
              {item.label}{" "}
            </span>
            {item.value}
          </span>
        ))
      )}
    </div>
  );
}
