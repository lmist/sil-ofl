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
      {stats.items.map((item) => (
        <span key={item.key} className="tabular-nums">
          <span className="text-muted-foreground/80">{item.label} </span>
          {item.value}
        </span>
      ))}
    </div>
  );
}
