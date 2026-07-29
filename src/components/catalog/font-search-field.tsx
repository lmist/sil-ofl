"use client";

import { useFontSearchField } from "@/hooks/use-font-search-field";
import { cn } from "@/lib/utils";

/**
 * Policy-only search field — instant input; debounce owned by catalog machine.
 */
export function FontSearchField({ className }: { className?: string }) {
  const { rootProps, labelProps, labelText, inputProps, hint } =
    useFontSearchField();

  return (
    <label
      {...labelProps}
      {...rootProps}
      className={cn(
        "flex min-w-[12rem] flex-1 flex-col gap-1",
        className,
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[0.6875rem] tracking-wide text-muted-foreground">
          {labelText}
        </span>
        {hint ? (
          <span
            className="text-[0.6875rem] tabular-nums text-muted-foreground/80"
            aria-live="polite"
          >
            {hint}
          </span>
        ) : null}
      </span>
      <input
        {...inputProps}
        className="h-9 border border-border bg-transparent px-3 text-[0.875rem] text-foreground outline-none transition-[border-color] duration-[var(--dur-fast)] placeholder:text-muted-foreground focus:border-foreground motion-reduce:transition-none"
      />
    </label>
  );
}
