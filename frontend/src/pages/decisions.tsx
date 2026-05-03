import Head from "next/head";
import { useMemo, useState } from "react";
import {
  type ColumnFiltersState,
  getCoreRowModel,
  type OnChangeFn,
  useReactTable,
} from "@tanstack/react-table";

import { DataTable } from "@/components/data-table/data-table";
import {
  extractDateRangeFromColumnFilters,
  extractMultiselectFromColumnFilters,
} from "@/components/data-table/filter-utils";
import { useDecisions } from "@/lib/hooks/use-decisions";
import type { Decision, DecisionAction } from "@/lib/api";
import { decisionColumns } from "@/features/decisions/columns";

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

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

  // Page-specific composition: the data-table package gives us per-column
  // extractors, the page just maps column ids to API params.
  const apiParams = useMemo(
    () => ({
      ...extractDateRangeFromColumnFilters(columnFilters, "decided_at"),
      action: extractMultiselectFromColumnFilters<DecisionAction>(
        columnFilters,
        "action_type"
      ),
    }),
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

  const count = data?.count ?? 0;
  const totalPages = data?.total_pages ?? 0;

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

      <div className="mt-4 rounded-lg border border-border bg-card text-card-foreground">
        <DataTable
          table={table}
          columns={decisionColumns}
          isLoading={isLoading}
          isError={isError}
          isFetching={isFetching}
          error={error}
          loadingMessage="Loading decisions…"
          errorMessage="Failed to load decisions"
          emptyMessage="No decisions match the current filters."
          pagination={{
            page,
            totalPages,
            onPageChange: setPage,
            pageSize,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            onPageSizeChange: setPageSizeAndResetPage,
          }}
          testIds={{
            table: "decisions-table",
            loading: "decisions-loading",
            error: "decisions-error",
            empty: "decisions-empty",
            refreshing: "decisions-refreshing",
            pageSize: "page-size",
            paginationStatus: "decisions-pagination-status",
            prev: "decisions-prev",
            next: "decisions-next",
            clearFilters: "clear-filters",
          }}
        />
      </div>
    </>
  );
}
