"use client";

import { flexRender } from "@tanstack/react-table";
import { useDenseFontTable } from "@/hooks/use-dense-font-table";
import { cn } from "@/lib/utils";

/**
 * Policy-only dense table — family, format, stars, owner.
 * Header sort → SET_SORT on catalog machine. No @font-face in cells.
 */
export function DenseFontTable({ className }: { className?: string }) {
  const t = useDenseFontTable();

  if (t.empty) {
    return (
      <div
        className={cn(
          "px-[var(--gutter)] py-8 text-[0.8125rem] text-muted-foreground",
          className,
        )}
      >
        {t.isFetching ? "Loading catalog…" : "No fonts match these filters."}
      </div>
    );
  }

  return (
    <div
      className={cn("w-full overflow-x-auto px-[var(--gutter)] pb-16", className)}
      data-dense-font-table
      role="table"
      aria-label="Font catalog dense"
      aria-rowcount={t.rows.length}
    >
      <div role="rowgroup" className="border-b border-border">
        {t.headerGroups.map((hg) => (
          <div
            key={hg.id}
            role="row"
            className="grid grid-cols-[minmax(10rem,2fr)_5rem_5rem_minmax(6rem,1fr)] gap-3 py-2 text-[0.6875rem] tracking-wide text-muted-foreground"
          >
            {hg.headers.map((header) => {
              const canSort = header.column.getCanSort();
              const sortProps = t.getHeaderSortProps(header.column.id, canSort);
              const label = flexRender(
                header.column.columnDef.header,
                header.getContext(),
              );
              if (canSort) {
                return (
                  <button
                    key={header.id}
                    {...sortProps}
                    className="text-left transition-colors duration-[var(--dur-fast)] hover:text-foreground motion-reduce:transition-none"
                  >
                    {label}
                    {sortProps["data-sorted"] === "asc"
                      ? " ↑"
                      : sortProps["data-sorted"] === "desc"
                        ? " ↓"
                        : ""}
                  </button>
                );
              }
              return (
                <div key={header.id} {...sortProps}>
                  {label}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div role="rowgroup">
        {t.rows.map((row) => {
          const node = row.original;
          const rowProps = t.getRowProps(node);
          return (
            <button
              key={row.id}
              {...rowProps}
              className={cn(
                "grid w-full grid-cols-[minmax(10rem,2fr)_5rem_5rem_minmax(6rem,1fr)] gap-3 border-b border-border py-2.5 text-left text-[0.8125rem]",
                "transition-[background-color] duration-[var(--dur-fast)] hover:bg-foreground/[0.03] motion-reduce:transition-none",
                rowProps.selected && "bg-foreground/[0.05]",
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <span
                  key={cell.id}
                  role="cell"
                  className={cn(
                    cell.column.id === "stars" && "tabular-nums text-muted-foreground",
                    cell.column.id === "format" && "text-muted-foreground",
                    cell.column.id === "owner" && "text-muted-foreground",
                    cell.column.id === "family" && "tracking-tight text-foreground",
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </span>
              ))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
