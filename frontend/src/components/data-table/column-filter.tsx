import type { Column, RowData } from "@tanstack/react-table";
import { Filter as FilterIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Per-column filter trigger + input.
 *
 * Each filterable column declares a `meta.filterVariant` (plus
 * `meta.filterOptions` for "select"). This component renders a
 * funnel-icon button next to the column label; clicking it opens a
 * popover holding the matching input. Reads/writes filter state via
 * the standard TanStack column API (`column.getFilterValue` /
 * `column.setFilterValue`).
 *
 * Pattern follows the official guide:
 *   https://tanstack.com/table/v8/docs/guide/column-filtering
 *
 * Adding a new variant: extend the declare-module block + add a branch
 * in <FilterInput />. Columns just declare `meta`; they never own the
 * input markup or the trigger UI.
 */

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Which input renders inside the popover for this column. */
    filterVariant?: "select" | "dateRange";
    /** Required for variant="select". Empty value = "no filter". */
    filterOptions?: { value: string; label: string }[];
    /** Optional human label used in the popover heading + aria. */
    filterLabel?: string;
  }
}

export type DateRangeFilterValue = { from?: string; to?: string };

const INPUT_CLASS =
  "rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

interface ColumnFilterProps<TData> {
  column: Column<TData, unknown>;
}

/**
 * Treat empty objects (`{}`) and empty strings as inactive. dateRange
 * clears to `undefined` so this is mostly defensive against partial
 * resets that leave behind `{ from: undefined, to: undefined }`.
 */
function isFilterActive(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(
      (v) => v !== undefined && v !== ""
    );
  }
  return true;
}

export function ColumnFilter<TData>({ column }: ColumnFilterProps<TData>) {
  if (!column.getCanFilter()) return null;

  const variant = column.columnDef.meta?.filterVariant;
  if (!variant) return null;

  const value = column.getFilterValue();
  const active = isFilterActive(value);
  const label = column.columnDef.meta?.filterLabel ?? "Filter";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative size-7",
            active && "bg-accent text-accent-foreground"
          )}
          aria-label={`${active ? "Edit" : "Add"} ${label.toLowerCase()}`}
          aria-pressed={active}
          data-testid={`filter-toggle-${column.id}`}
        >
          <FilterIcon className="size-3.5" aria-hidden />
          {active && (
            <span
              aria-hidden
              className="absolute right-0.5 top-0.5 block size-1.5 rounded-full bg-primary"
            />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto min-w-[12rem]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-muted-foreground">
            {label}
          </span>
          {active && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => column.setFilterValue(undefined)}
              data-testid={`filter-clear-${column.id}`}
            >
              <X className="size-3" aria-hidden />
              Clear
            </Button>
          )}
        </div>
        <div className="mt-2">
          <FilterInput column={column} variant={variant} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterInput<TData>({
  column,
  variant,
}: {
  column: Column<TData, unknown>;
  variant: NonNullable<
    NonNullable<Column<TData, unknown>["columnDef"]["meta"]>["filterVariant"]
  >;
}) {
  if (variant === "select") {
    const options = column.columnDef.meta?.filterOptions ?? [];
    const value = (column.getFilterValue() as string | undefined) ?? "";
    return (
      <select
        data-testid={`filter-${column.id}`}
        aria-label={`Filter ${column.id}`}
        value={value}
        onChange={(e) =>
          column.setFilterValue(
            e.target.value === "" ? undefined : e.target.value
          )
        }
        className={cn(INPUT_CLASS, "w-full")}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (variant === "dateRange") {
    const value =
      (column.getFilterValue() as DateRangeFilterValue | undefined) ?? {};
    const update = (next: DateRangeFilterValue) => {
      // Clear entirely when both bounds are empty so the filter doesn't
      // linger as { from: undefined, to: undefined } in columnFilters.
      if (!next.from && !next.to) column.setFilterValue(undefined);
      else column.setFilterValue(next);
    };
    return (
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <input
            type="date"
            data-testid={`filter-${column.id}-from`}
            value={value.from ?? ""}
            onChange={(e) =>
              update({ ...value, from: e.target.value || undefined })
            }
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <input
            type="date"
            data-testid={`filter-${column.id}-to`}
            value={value.to ?? ""}
            onChange={(e) =>
              update({ ...value, to: e.target.value || undefined })
            }
            className={INPUT_CLASS}
          />
        </label>
      </div>
    );
  }

  return null;
}
