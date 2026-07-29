"use client";

import { useFontRow, type FontRowInput } from "@/hooks/use-font-row";
import { cn } from "@/lib/utils";

/**
 * Policy-only dense catalog row — large sample, quiet meta, hairline rule.
 * No cards, no shadows.
 */
export function FontRow(input: FontRowInput) {
  const row = useFontRow(input);

  return (
    <button
      {...row.rootProps}
      className={cn(
        "group flex h-full w-full flex-col justify-center gap-3 border-b border-border px-0 py-6 text-left",
        "transition-[background-color,opacity] duration-[var(--dur-fast)]",
        "hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.04]",
        "motion-reduce:transition-none",
        row.selected && "bg-foreground/[0.05]",
      )}
    >
      <span
        {...row.sampleProps}
        className={cn(
          "block max-w-full overflow-hidden text-ellipsis whitespace-nowrap tracking-tight text-foreground",
          !row.faceActive && "font-sans",
        )}
        style={{
          ...row.sampleProps.style,
          fontSize: "clamp(2rem, 6vw, 4.5rem)",
          lineHeight: 1.05,
          letterSpacing: "-0.02em",
        }}
      >
        {row.sampleText}
      </span>

      <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span
          {...row.nameProps}
          className={cn(
            "text-[0.8125rem] tracking-tight text-foreground",
            "underline-offset-4 group-hover:underline",
          )}
        >
          {row.name}
        </span>
        <span
          {...row.metaProps}
          className="shrink-0 text-[0.75rem] tabular-nums text-muted-foreground"
        >
          {row.meta}
        </span>
      </span>
    </button>
  );
}
