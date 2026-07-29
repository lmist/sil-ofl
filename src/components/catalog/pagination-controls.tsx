"use client";

import { usePaginationControls } from "@/hooks/use-pagination-controls";
import { cn } from "@/lib/utils";

const btnClass =
  "h-9 border border-border px-3 text-[0.75rem] text-foreground transition-[border-color,opacity] duration-[var(--dur-fast)] hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none";

/**
 * Policy-only prev / next / clear — handlers from catalog machine.
 */
export function PaginationControls({ className }: { className?: string }) {
  const page = usePaginationControls();

  return (
    <div
      {...page.rootProps}
      className={cn("flex items-end gap-2 self-end", className)}
    >
      <span className="mr-1 hidden text-[0.75rem] tabular-nums text-muted-foreground sm:inline">
        {page.pageLabel}
      </span>
      <button {...page.prevProps} className={btnClass}>
        {page.prevLabel}
      </button>
      <button {...page.nextProps} className={btnClass}>
        {page.nextLabel}
      </button>
      <button {...page.clearProps} className={btnClass}>
        {page.clearLabel}
      </button>
    </div>
  );
}
