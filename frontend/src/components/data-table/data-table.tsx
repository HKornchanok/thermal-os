import {
  type ColumnDef,
  flexRender,
  type Table as TanStackTable,
} from "@tanstack/react-table";

import { ErrorState, LoadingState } from "@/components/dashboard/states";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Reusable data-table shell.
 *
 * Owns:
 *   - the visual rendering of headers, rows, cells (via shadcn Table primitives)
 *   - the three branching states the table itself shows: loading, error,
 *     empty (`<TableBody>`-internal so the header row with filter-funnel
 *     buttons stays visible when there are no results)
 *
 * Does NOT own:
 *   - the TanStack Table instance (`useReactTable` lives in the page so it
 *     can drive page-specific column defs, meta, manualPagination, etc.)
 *   - filter UI (rendered by per-column meta + `<ColumnFilter />`)
 *   - pagination controls (page state lives next to the data hook)
 *
 * Pages typically wrap this in a card div and stack a toolbar above it +
 * pagination below it. Drop-in replacement for the previous in-place
 * Table loop on /decisions.
 */
interface DataTableProps<TData, TValue> {
  /** TanStack Table instance, fully configured by the calling page. */
  table: TanStackTable<TData>;
  /** Used for the colSpan on the empty-state row. */
  columns: ColumnDef<TData, TValue>[];

  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;

  loadingMessage?: string;
  errorMessage?: string;
  emptyMessage?: string;

  /** Optional per-mount test ids for E2E selectors. */
  testIds?: {
    table?: string;
    loading?: string;
    error?: string;
    empty?: string;
  };

  /** Override the default 120px minimum cell width if needed. */
  cellMinWidthClass?: string;
}

export function DataTable<TData, TValue>({
  table,
  columns,
  isLoading,
  isError,
  error,
  loadingMessage = "Loading…",
  errorMessage = "Failed to load.",
  emptyMessage = "No results.",
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
    <Table data-testid={testIds?.table}>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead key={header.id} className={cn(cellMinWidthClass)}>
                {header.isPlaceholder
                  ? null
                  : flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          // Empty state lives inside <TableBody> so the header row (with
          // filter-funnel buttons) stays visible — users can adjust filters
          // without scrolling away.
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
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className={cn(cellMinWidthClass)}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
