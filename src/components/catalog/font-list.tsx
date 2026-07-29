"use client";

import { useFontList } from "@/hooks/use-font-list";
import { FontRow } from "@/components/catalog/font-row";
import { cn } from "@/lib/utils";

/**
 * Policy-only virtualized list. Virtualizer math lives in useFontList.
 * Offscreen rows never mount @font-face — only selected/hovered rows do.
 */
export function FontList({ className }: { className?: string }) {
  const list = useFontList();

  if (list.showError) {
    return (
      <div
        className={cn(
          "border-b border-border px-[var(--gutter)] py-6 text-[0.8125rem] text-muted-foreground",
          className,
        )}
        role="alert"
      >
        {list.error}{" "}
        <button
          {...list.retryCatalogProps}
          type="button"
          className="underline underline-offset-4"
        >
          Retry
        </button>
      </div>
    );
  }

  if (list.showEmpty) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col justify-center px-[var(--gutter)] py-[var(--catalog-row-gap)]",
          className,
        )}
        data-font-list-empty
      >
        <p
          className="max-w-4xl font-sans tracking-tight text-foreground"
          style={{
            fontSize: "clamp(2.5rem, 8vw, 7rem)",
            lineHeight: 1.02,
          }}
        >
          Type is the interface.
        </p>
        <p className="mt-6 max-w-md text-[0.9375rem] leading-[1.55] text-muted-foreground">
          {list.emptyHeadline}
        </p>
        <p className="mt-2 max-w-md text-[0.8125rem] text-muted-foreground/80">
          {list.emptySubcopy}
        </p>
        {list.totalCount === 0 && !list.isFetching ? (
          <p className="mt-4 text-[0.75rem] tabular-nums text-muted-foreground">
            0 matches
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      {...list.containerProps}
      className={cn(
        "w-full px-[var(--gutter)] pb-16",
        list.isFetching && "opacity-90",
        className,
      )}
    >
      <div style={list.spacerStyle}>
        {list.rows.map((row) =>
          row.rowProps ? (
            <div key={row.key} style={row.wrapperStyle}>
              <FontRow {...row.rowProps} />
            </div>
          ) : (
            <div key={row.key} style={row.wrapperStyle} />
          ),
        )}
      </div>
    </div>
  );
}
