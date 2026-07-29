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

  const errorStatus = t.error ? (
    <div
      className="border-b border-border px-[var(--gutter)] py-6 text-[0.8125rem] text-muted-foreground"
      role="alert"
      data-catalog-error
    >
      {t.error} {t.rows.length > 0 ? "Retained results may be stale. " : null}
      <button
        {...t.retryCatalogProps}
        type="button"
        className="underline underline-offset-4"
      >
        Retry
      </button>
      {t.canResetPagination ? (
        <>
          {" "}
          <button
            {...t.resetPaginationProps}
            aria-label="Reset"
            className="underline underline-offset-4"
          >
            Reset
          </button>
        </>
      ) : null}
    </div>
  ) : null;

  if (t.empty) {
    if (errorStatus) return errorStatus;

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
    <>
      {errorStatus}
      <div
        className={cn(
          "w-full overflow-x-auto px-[var(--gutter)] pb-16",
          className,
        )}
        data-placeholder={t.isPlaceholderData ? "true" : "false"}
      >
        <table
          className="w-full min-w-[28rem] table-fixed border-collapse"
          data-dense-font-table
          data-placeholder={t.isPlaceholderData ? "true" : "false"}
          aria-label="Font catalog dense"
        >
          <colgroup>
            <col />
            <col className="w-20" />
            <col className="w-20" />
            <col className="w-1/4" />
          </colgroup>
          <thead>
            {t.headerGroups.map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="text-[0.6875rem] tracking-wide text-muted-foreground"
              >
                {headerGroup.headers.map((header) => {
                  const sort = t.getHeaderSortProps(
                    header.column.id,
                    header.column.getCanSort(),
                  );
                  const label = flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  );

                  return (
                    <th
                      key={header.id}
                      {...sort.headerProps}
                      scope="col"
                      className="border-b border-border py-2 pr-3 text-left font-normal last:pr-0"
                    >
                      {sort.buttonProps ? (
                        <button
                          {...sort.buttonProps}
                          className="inline-flex min-h-6 min-w-6 items-center text-left transition-colors duration-[var(--dur-fast)] hover:text-foreground motion-reduce:transition-none"
                        >
                          {label}
                          {sort.buttonProps["data-sorted"] === "asc"
                            ? " ↑"
                            : sort.buttonProps["data-sorted"] === "desc"
                              ? " ↓"
                              : ""}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {t.rows.map((row) => {
              const rowProps = t.getRowProps(row.original);
              return (
                <tr
                  key={row.id}
                  onClick={rowProps.onClick}
                  data-selected={rowProps.selected ? "true" : "false"}
                  className={cn(
                    "cursor-pointer border-b border-border text-[0.8125rem]",
                    "transition-[background-color] duration-[var(--dur-fast)] hover:bg-foreground/[0.03] motion-reduce:transition-none",
                    rowProps.selected && "bg-foreground/[0.05]",
                  )}
                >
                  {row.getVisibleCells().map((cell) => {
                    const content = flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext(),
                    );
                    const cellClassName = cn(
                      "overflow-hidden py-2.5 pr-3 align-middle last:pr-0",
                      cell.column.id === "stars" &&
                        "tabular-nums text-muted-foreground",
                      cell.column.id === "format" &&
                        "text-muted-foreground",
                      cell.column.id === "owner" &&
                        "text-muted-foreground",
                      cell.column.id === "family" &&
                        "tracking-tight text-foreground",
                    );

                    if (cell.column.id === "family") {
                      return (
                        <th
                          key={cell.id}
                          scope="row"
                          className={cn(cellClassName, "font-normal")}
                        >
                          <button
                            {...rowProps.selectionProps}
                            className="flex min-h-6 min-w-0 w-full items-center overflow-hidden text-ellipsis whitespace-nowrap text-left underline-offset-4 hover:underline"
                          >
                            <span className="sr-only">Select </span>
                            {rowProps.selected ? (
                              <span
                                className="mr-2 shrink-0 font-medium"
                                data-selection-indicator
                              >
                                Selected:{" "}
                              </span>
                            ) : null}
                            <span className="min-w-0 overflow-hidden text-ellipsis">
                              {content}
                            </span>
                          </button>
                        </th>
                      );
                    }

                    return (
                      <td
                        key={cell.id}
                        className={cellClassName}
                      >
                        <span className="block truncate">{content}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
