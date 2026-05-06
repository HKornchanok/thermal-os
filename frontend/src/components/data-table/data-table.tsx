import {
  type ColumnDef,
  flexRender,
  type RowData,
  type Table as TanStackTable,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { ErrorState, LoadingState } from "@/components/dashboard/states";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Declaration-merges with column-filter.tsx — TS accumulates the fields.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Per-column minimum width in px; overrides cellMinWidthClass. */
    minWidth?: number;
  }
}

/**
 * Reusable shell. Owns: rendering, loading/error/empty branches,
 * optional pagination footer. Does NOT own: the TanStack Table
 * instance, filter UI, or filter state — pages handle those.
 */
type PaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  pageSizeOptions: readonly number[];
  onPageSizeChange: (size: number) => void;
};

interface DataTableProps<TData, TValue> {
  table: TanStackTable<TData>;
  /** colSpan target for the empty-state row. */
  columns: ColumnDef<TData, TValue>[];

  isLoading?: boolean;
  isError?: boolean;
  /** TanStack Query `isFetching` drives the inline "Refreshing" spinner. */
  isFetching?: boolean;
  error?: unknown;

  loadingMessage?: string;
  errorMessage?: string;
  emptyMessage?: string;

  /** Renders the pagination footer when supplied. */
  pagination?: PaginationProps;

  testIds?: {
    table?: string;
    loading?: string;
    error?: string;
    empty?: string;
    refreshing?: string;
    pageSize?: string;
    paginationStatus?: string;
    prev?: string;
    next?: string;
    clearFilters?: string;
  };

  /** Defaults to a 120px minimum. */
  cellMinWidthClass?: string;
}

export function DataTable<TData, TValue>({
  table,
  columns,
  isLoading,
  isError,
  isFetching,
  error,
  loadingMessage = "Loading…",
  errorMessage = "Failed to load.",
  emptyMessage = "No results.",
  pagination,
  testIds,
  cellMinWidthClass = "min-w-[120px]",
}: DataTableProps<TData, TValue>) {
  if (isLoading) {
    return <LoadingState message={loadingMessage} testId={testIds?.loading} />;
  }

  if (isError) {
    const detail = error instanceof Error ? error.message : "unknown error";
    return (
      <ErrorState
        message={`${errorMessage}: ${detail}`}
        testId={testIds?.error}
      />
    );
  }

  const rows = table.getRowModel().rows;

  return (
    <>
      <Table data-testid={testIds?.table}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const explicit = header.column.columnDef.meta?.minWidth;
                return (
                  <TableHead
                    key={header.id}
                    className={cn(
                      "relative after:absolute after:right-0 after:top-1/4 after:h-1/2 after:w-px after:bg-border after:content-[''] last:after:hidden",
                      cellMinWidthClass
                    )}
                    style={explicit ? { minWidth: `${explicit}px` } : undefined}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            // Inside <TableBody> so header filters stay visible.
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="p-6 text-center text-sm text-muted-foreground"
                data-testid={testIds?.empty}
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => {
                  const explicit = cell.column.columnDef.meta?.minWidth;
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(cellMinWidthClass)}
                      style={
                        explicit ? { minWidth: `${explicit}px` } : undefined
                      }
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {pagination && (
        <DataTableFooter
          table={table}
          pagination={pagination}
          isFetching={isFetching}
          testIds={testIds}
        />
      )}
    </>
  );
}

function DataTableFooter<TData>({
  table,
  pagination,
  isFetching,
  testIds,
}: {
  table: TanStackTable<TData>;
  pagination: PaginationProps;
  isFetching?: boolean;
  testIds?: DataTableProps<unknown, unknown>["testIds"];
}) {
  const {
    page,
    totalPages,
    onPageChange,
    pageSize,
    pageSizeOptions,
    onPageSizeChange,
  } = pagination;
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const hasActiveFilter = table.getState().columnFilters.length > 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
      <div className="flex min-h-8 items-center gap-3">
        <label className="flex items-center gap-2">
          Per page
          <select
            data-testid={testIds?.pageSize ?? "page-size"}
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {isFetching && (
          <span
            className="inline-flex items-center gap-1.5 leading-none"
            role="status"
            aria-live="polite"
            data-testid={testIds?.refreshing}
          >
            <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
            <span>Refreshing</span>
          </span>
        )}
        {hasActiveFilter && (
          <Button
            data-testid={testIds?.clearFilters ?? "clear-filters"}
            variant="ghost"
            size="sm"
            onClick={() => table.resetColumnFilters()}
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span data-testid={testIds?.paginationStatus}>
          {totalPages > 0 ? `Page ${page} of ${totalPages}` : "Page 0 of 0"}
        </span>
        <div className="flex gap-2">
          <Button
            data-testid={testIds?.prev}
            variant="outline"
            size="sm"
            disabled={!canPrev}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            <ChevronLeft className="size-3" aria-hidden />
            Previous
          </Button>
          <Button
            data-testid={testIds?.next}
            variant="outline"
            size="sm"
            disabled={!canNext}
            onClick={() => onPageChange(page + 1)}
          >
            Next
            <ChevronRight className="size-3" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
