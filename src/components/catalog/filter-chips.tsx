"use client";

import { useFilterChips } from "@/hooks/use-filter-chips";
import { cn } from "@/lib/utils";

const chipClass =
  "inline-flex h-7 max-w-full items-center gap-1.5 border border-border px-2 text-[0.6875rem] text-foreground transition-[border-color] duration-[var(--dur-fast)] hover:border-border-strong motion-reduce:transition-none";

/**
 * Policy-only active filter chips + matched totalCount.
 */
export function FilterChips({ className }: { className?: string }) {
  const bar = useFilterChips();

  if (!bar.hasChips && !bar.showStatus) return null;

  return (
    <div
      data-filter-chip-strip
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-2 border-b border-border px-[var(--gutter)] py-2",
        className,
      )}
    >
      {bar.showStatus ? (
        <span
          className="mr-1 text-[0.75rem] tabular-nums text-muted-foreground"
          data-total-count
          data-catalog-results-status
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {bar.statusText}
        </span>
      ) : null}

      {bar.hasChips ? (
        <ul
          {...bar.rootProps}
          className="flex min-w-0 max-w-full flex-1 flex-wrap items-center gap-1.5"
        >
          {bar.chips.map((chip) => (
            <li key={chip.id} role="listitem" className="min-w-0 max-w-full">
              <button
                type="button"
                className={chipClass}
                onClick={chip.onRemove}
                aria-label={`Remove filter ${chip.label}`}
              >
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {chip.label}
                </span>
                <span aria-hidden className="opacity-60">
                  ×
                </span>
              </button>
            </li>
          ))}
          <li role="listitem" className="max-w-full">
            <button
              {...bar.clearAllProps}
              type="button"
              className={cn(chipClass, "text-muted-foreground")}
            >
              Clear all
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
