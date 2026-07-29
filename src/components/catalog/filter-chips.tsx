"use client";

import { useFilterChips } from "@/hooks/use-filter-chips";
import { cn } from "@/lib/utils";

const chipClass =
  "inline-flex h-7 items-center gap-1.5 border border-border px-2 text-[0.6875rem] text-foreground transition-[border-color] duration-[var(--dur-fast)] hover:border-border-strong motion-reduce:transition-none";

/**
 * Policy-only active filter chips + matched totalCount.
 */
export function FilterChips({ className }: { className?: string }) {
  const bar = useFilterChips();

  if (!bar.hasChips && !bar.showTotal) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-b border-border px-[var(--gutter)] py-2",
        className,
      )}
    >
      {bar.showTotal ? (
        <span
          className="mr-1 text-[0.75rem] tabular-nums text-muted-foreground"
          data-total-count
          aria-live="polite"
        >
          {bar.isDebouncing
            ? "Searching…"
            : bar.isFetching && bar.totalCount === 0
              ? "Loading…"
              : `${bar.totalCount.toLocaleString()} match${bar.totalCount === 1 ? "" : "es"}`}
        </span>
      ) : null}

      {bar.hasChips ? (
        <ul {...bar.rootProps} className="flex flex-wrap items-center gap-1.5">
          {bar.chips.map((chip) => (
            <li key={chip.id} role="listitem">
              <button
                type="button"
                className={chipClass}
                onClick={chip.onRemove}
                aria-label={`Remove filter ${chip.label}`}
              >
                <span>{chip.label}</span>
                <span aria-hidden className="opacity-60">
                  ×
                </span>
              </button>
            </li>
          ))}
          <li role="listitem">
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
