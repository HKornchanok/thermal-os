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
    filterVariant?: "select" | "date";
    /** Required for variant="select". Empty value = "no filter". */
    filterOptions?: { value: string; label: string }[];
    /** Optional human label used in the popover heading + aria. */
    filterLabel?: string;
  }
}

// ---------------------------------------------------------------------
// Date filter shape — discriminated union by operator.
// ---------------------------------------------------------------------

export type DateFilterOp = "between" | "on" | "before" | "after";

export type DateFilterValue =
  | { op: "between"; from?: string; to?: string }
  | { op: "on"; value?: string }
  | { op: "before"; value?: string }
  | { op: "after"; value?: string };

const DATE_OP_OPTIONS: { value: DateFilterOp; label: string }[] = [
  { value: "between", label: "Between" },
  { value: "on", label: "On" },
  { value: "before", label: "Before" },
  { value: "after", label: "After" },
];

/** Treat a date filter as inactive if the operator's value(s) are blank. */
function isDateFilterActive(v: DateFilterValue | undefined): boolean {
  if (!v) return false;
  if (v.op === "between") return !!(v.from || v.to);
  return !!v.value;
}

// ---------------------------------------------------------------------
// Generic active-filter detection used for the trigger-button indicator.
// ---------------------------------------------------------------------

function isFilterActive(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "object") {
    const v = value as DateFilterValue & Record<string, unknown>;
    if (typeof v.op === "string") return isDateFilterActive(v);
    return Object.values(v).some((x) => x !== undefined && x !== "");
  }
  return true;
}

// ---------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------

const INPUT_CLASS =
  "rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

interface ColumnFilterProps<TData> {
  column: Column<TData, unknown>;
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

      <PopoverContent align="start" className="w-auto min-w-[14rem]">
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

  if (variant === "date") {
    const current = (column.getFilterValue() as DateFilterValue | undefined) ?? {
      op: "between",
    };

    const setOp = (op: DateFilterOp) => {
      // Reset the value side of the union when changing operator so we
      // don't carry stale `from`/`to` into single-date ops or vice versa.
      if (op === "between") column.setFilterValue({ op });
      else column.setFilterValue({ op });
    };

    return (
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Operator
          <select
            data-testid={`filter-${column.id}-op`}
            value={current.op}
            onChange={(e) => setOp(e.target.value as DateFilterOp)}
            className={cn(INPUT_CLASS, "w-full")}
          >
            {DATE_OP_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {current.op === "between" ? (
          <BetweenInputs column={column} value={current} />
        ) : (
          <SingleDateInput column={column} value={current} />
        )}
      </div>
    );
  }

  return null;
}

function BetweenInputs<TData>({
  column,
  value,
}: {
  column: Column<TData, unknown>;
  value: Extract<DateFilterValue, { op: "between" }>;
}) {
  const update = (next: Extract<DateFilterValue, { op: "between" }>) => {
    if (!next.from && !next.to) column.setFilterValue(undefined);
    else column.setFilterValue(next);
  };

  return (
    <>
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
    </>
  );
}

function SingleDateInput<TData>({
  column,
  value,
}: {
  column: Column<TData, unknown>;
  value: Extract<DateFilterValue, { op: "on" | "before" | "after" }>;
}) {
  const update = (next: string) => {
    if (!next) column.setFilterValue({ op: value.op });
    else column.setFilterValue({ op: value.op, value: next });
  };

  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      Date
      <input
        type="date"
        data-testid={`filter-${column.id}-value`}
        value={value.value ?? ""}
        onChange={(e) => update(e.target.value)}
        className={INPUT_CLASS}
      />
    </label>
  );
}
