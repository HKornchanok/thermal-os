import Head from "next/head";
import { useMemo, useState } from "react";
import {
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  type OnChangeFn,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDecisions } from "@/lib/hooks/use-decisions";
import type { Decision, DecisionAction } from "@/lib/api";
import {
  type ActionFilter,
  type DateRangeFilter,
  decisionColumns,
} from "@/features/decisions/columns";

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

/**
 * Extract the API-shaped params from TanStack Table's columnFilters array.
 * Each filter column knows its own value shape; the page only knows the
 * `id`s and how to translate them into useDecisions params.
 */
function paramsFromColumnFilters(filters: ColumnFiltersState): {
  action?: DecisionAction;
  from?: string;
  to?: string;
} {
  const result: { action?: DecisionAction; from?: string; to?: string } = {};

  for (const f of filters) {
    if (f.id === "action_type") {
      const v = f.value as ActionFilter;
      if (v) result.action = v;
    } else if (f.id === "decided_at") {
      const v = (f.value ?? {}) as DateRangeFilter;
      // <input type="date"> gives YYYY-MM-DD. The backend filter is
      // `decided_at >= from AND decided_at < to`, so:
      //   from = "2026-04-15" → 2026-04-15T00:00:00Z (start of that day)
      //   to   = "2026-04-25" → 2026-04-26T00:00:00Z (start of NEXT day,
      //                          so April 25 is fully included)
      if (v.from) result.from = `${v.from}T00:00:00Z`;
      if (v.to) {
        const next = new Date(`${v.to}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        result.to = next.toISOString().replace(/\.\d+Z$/, "Z");
      }
    }
  }

  return result;
}

export default function DecisionsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Wrap the setter so any filter change resets to page 1 — page 5 of a
  // smaller filtered result would otherwise show an empty body.
  const handleColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (updater) => {
    setColumnFilters((prev) =>
      typeof updater === "function" ? updater(prev) : updater
    );
    setPage(1);
  };

  const apiParams = useMemo(
    () => paramsFromColumnFilters(columnFilters),
    [columnFilters]
  );

  const { data, isLoading, isError, error, isFetching } = useDecisions({
    page,
    page_size: pageSize,
    ...apiParams,
  });

  const table = useReactTable<Decision>({
    data: data?.results ?? [],
    columns: decisionColumns,
    state: { columnFilters },
    onColumnFiltersChange: handleColumnFiltersChange,
    getCoreRowModel: getCoreRowModel(),
    // Pagination AND filtering are both server-side. TanStack just stores
    // the values; useDecisions reads them and fires the request.
    manualPagination: true,
    manualFiltering: true,
    pageCount: data?.total_pages ?? -1,
  });

  const totalPages = data?.total_pages ?? 0;
  const count = data?.count ?? 0;
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const hasActiveFilter = columnFilters.length > 0;

  const setPageSizeAndResetPage = (next: number) => {
    setPageSize(next);
    setPage(1);
  };

  return (
    <>
      <Head>
        <title>AI Decisions · ThermalOS</title>
      </Head>

      <div className="flex items-baseline justify-between gap-4">
        <h1 className="mt-0 text-2xl font-semibold">AI Decisions</h1>
        <p className="text-xs text-muted-foreground">
          {count.toLocaleString()} decision{count === 1 ? "" : "s"} in range
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Per page
          <select
            data-testid="page-size"
            value={pageSize}
            onChange={(e) => setPageSizeAndResetPage(Number(e.target.value))}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        {hasActiveFilter && (
          <Button
            data-testid="clear-filters"
            variant="ghost"
            size="sm"
            onClick={() => {
              table.resetColumnFilters();
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}

        {isFetching && !isLoading && (
          <span className="text-xs text-muted-foreground">Refreshing…</span>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-border bg-card text-card-foreground">
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground" data-testid="decisions-loading">
            Loading decisions…
          </p>
        ) : isError ? (
          <p className="p-6 text-sm text-destructive" data-testid="decisions-error">
            Failed to load decisions: {error instanceof Error ? error.message : "unknown error"}
          </p>
        ) : (
          <Table data-testid="decisions-table">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="align-bottom">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={decisionColumns.length}
                    className="p-6 text-center text-sm text-muted-foreground"
                    data-testid="decisions-empty"
                  >
                    No decisions match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span data-testid="decisions-pagination-status">
          {totalPages > 0 ? `Page ${page} of ${totalPages}` : "Page 0 of 0"}
        </span>
        <div className="flex gap-2">
          <Button
            data-testid="decisions-prev"
            variant="outline"
            size="sm"
            disabled={!canPrev}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="size-3" aria-hidden />
            Previous
          </Button>
          <Button
            data-testid="decisions-next"
            variant="outline"
            size="sm"
            disabled={!canNext}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
            <ChevronRight className="size-3" aria-hidden />
          </Button>
        </div>
      </div>
    </>
  );
}
