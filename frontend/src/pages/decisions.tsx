import Head from "next/head";
import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
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
import { decisionColumns } from "@/features/decisions/columns";

const ACTION_FILTER_OPTIONS: { value: "" | DecisionAction; label: string }[] = [
  { value: "", label: "All actions" },
  { value: "turn_on", label: "Turn on" },
  { value: "turn_off", label: "Turn off" },
  { value: "set_temp", label: "Set temp" },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export default function DecisionsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [actionFilter, setActionFilter] = useState<"" | DecisionAction>("");

  const { data, isLoading, isError, error, isFetching } = useDecisions({
    page,
    page_size: pageSize,
    action: actionFilter || undefined,
  });

  // TanStack Table is configured for manual (server-side) pagination —
  // we only feed it the current page's rows; the API tells us total_pages.
  const table = useReactTable<Decision>({
    data: data?.results ?? [],
    columns: decisionColumns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: data?.total_pages ?? -1,
  });

  const totalPages = data?.total_pages ?? 0;
  const count = data?.count ?? 0;
  const canPrev = page > 1;
  const canNext = page < totalPages;

  // When the user changes a filter, reset back to page 1 — otherwise
  // they could request page 5 of a smaller filtered result and see [].
  const setActionAndResetPage = (next: "" | DecisionAction) => {
    setActionFilter(next);
    setPage(1);
  };
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
          Action
          <select
            data-testid="action-filter"
            value={actionFilter}
            onChange={(e) => setActionAndResetPage(e.target.value as "" | DecisionAction)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
          >
            {ACTION_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

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
        ) : data && data.results.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground" data-testid="decisions-empty">
            No decisions match the current filters.
          </p>
        ) : (
          <Table data-testid="decisions-table">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
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
