"use client";

import { useFontFilterBar } from "@/hooks/use-font-filter-bar";
import { FontSearchField } from "@/components/catalog/font-search-field";
import { PaginationControls } from "@/components/catalog/pagination-controls";
import { cn } from "@/lib/utils";

const fieldClass =
  "h-9 border border-border bg-transparent px-2 text-[0.875rem] text-foreground outline-none transition-[border-color] duration-[var(--dur-fast)] focus:border-foreground motion-reduce:transition-none";

const labelClass =
  "text-[0.6875rem] tracking-wide text-muted-foreground";

const toggleClass =
  "h-9 border border-border px-3 text-[0.75rem] text-foreground transition-[border-color,opacity] duration-[var(--dur-fast)] hover:border-border-strong aria-pressed:border-foreground motion-reduce:transition-none";

/**
 * Policy-only filter strip under header — never a SaaS sidebar.
 * Instant FTS field (machine debounces); format/webfont/variable/minStars chips live below.
 */
export function FontFilterBar({ className }: { className?: string }) {
  const bar = useFontFilterBar();

  return (
    <div
      {...bar.rootProps}
      className={cn(
        "flex flex-wrap items-end gap-3 border-b border-border px-[var(--gutter)] py-3",
        className,
      )}
    >
      <FontSearchField />

      <label className="flex w-36 flex-col gap-1">
        <span className={labelClass}>Format</span>
        <select {...bar.formatSelectProps} className={fieldClass}>
          {bar.formatOptions.map((opt) => (
            <option key={opt.value || "any"} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex w-40 flex-col gap-1">
        <span className={labelClass}>Owner</span>
        <input
          {...bar.ownerInputProps}
          className={cn(fieldClass, "px-3 placeholder:text-muted-foreground")}
        />
      </label>

      <label className="flex w-28 flex-col gap-1">
        <span className={labelClass}>Min ★</span>
        <input
          {...bar.minStarsInputProps}
          className={cn(fieldClass, "tabular-nums px-3")}
        />
      </label>

      <label className="flex w-44 flex-col gap-1">
        <span className={labelClass}>Sort</span>
        <select {...bar.sortSelectProps} className={fieldClass}>
          {bar.sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-end gap-2">
        <button {...bar.webfontToggleProps} className={toggleClass}>
          {bar.webfontLabel}
        </button>
        <button {...bar.variableToggleProps} className={toggleClass}>
          {bar.variableLabel}
        </button>
        <button {...bar.denseModeToggleProps} className={toggleClass}>
          {bar.denseModeLabel}
        </button>
      </div>

      <PaginationControls className="ml-auto" />
    </div>
  );
}
