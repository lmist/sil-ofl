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

  const errorStatus = list.showError ? (
    <div
      className={cn(
        "border-b border-border px-[var(--gutter)] py-6 text-[0.8125rem] text-muted-foreground",
        className,
      )}
      role="alert"
      data-catalog-error
    >
      {list.error}{" "}
      {list.showList ? "Retained results may be stale. " : null}
      <button
        {...list.retryCatalogProps}
        type="button"
        className="underline underline-offset-4"
      >
        Retry
      </button>
      {list.canResetPagination ? (
        <>
          {" "}
          <button
            {...list.resetPaginationProps}
            aria-label="Reset"
            className="underline underline-offset-4"
          >
            Reset
          </button>
        </>
      ) : null}
    </div>
  ) : null;

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
        <p className="mt-2 max-w-md text-[0.8125rem] text-muted-foreground">
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

  if (!list.showList) return errorStatus;

  return (
    <>
      {errorStatus}
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
              <div
                key={row.key}
                role="listitem"
                aria-posinset={row.ariaPosInSet}
                aria-setsize={row.ariaSetSize}
                style={row.wrapperStyle}
              >
                <FontRow {...row.rowProps} />
              </div>
            ) : (
              <div key={row.key} style={row.wrapperStyle} />
            ),
          )}
        </div>
      </div>
    </>
  );
}
