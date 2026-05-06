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
 * Funnel-icon button + popover that owns one column's filter input.
 * Columns declare `meta.filterVariant`; this component renders the
 * matching <FilterInput /> and reads/writes via column.getFilterValue.
 * Adding a variant: extend the declare-module block + add a branch.
 */

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    filterVariant?: "select" | "multiselect" | "date";
    /** Required for select/multiselect; empty selection means no filter. */
    filterOptions?: { value: string; label: string }[];
    /** Heading + aria label inside the popover. */
    filterLabel?: string;
  }
}

// `value` for "on" is YYYY-MM-DD (whole day); other operators use
// datetime-local "YYYY-MM-DDTHH:MM" in the browser's zone.

export type DateFilterOp =
  | "between"
  | "on"
  | "before"
  | "same_or_before"
  | "after"
  | "same_or_after";

export type DateFilterValue =
  | { op: "between"; from?: string; to?: string }
  | { op: "on"; value?: string }
  | {
      op: "before" | "same_or_before" | "after" | "same_or_after";
      value?: string;
    };

const DATE_OP_OPTIONS: { value: DateFilterOp; label: string }[] = [
  { value: "between", label: "Between" },
  { value: "on", label: "On" },
  { value: "before", label: "Before" },
  { value: "same_or_before", label: "Same or before" },
  { value: "after", label: "After" },
  { value: "same_or_after", label: "Same or after" },
];

const DATE_ONLY_OPS = new Set<DateFilterOp>(["on"]);

/** Whether a date filter holds enough data to be considered active. */
function isDateFilterActive(v: DateFilterValue | undefined): boolean {
  if (!v) return false;
  if (v.op === "between") return !!(v.from || v.to);
  return !!v.value;
}

function isFilterActive(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    const v = value as DateFilterValue & Record<string, unknown>;
    if (typeof v.op === "string") return isDateFilterActive(v);
    return Object.values(v).some((x) => x !== undefined && x !== "");
  }
  return true;
}

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

  if (variant === "multiselect") {
    return <MultiSelectFilter column={column} />;
  }

  if (variant === "date") {
    const current =
      (column.getFilterValue() as DateFilterValue | undefined) ??
      ({ op: "between" } as DateFilterValue);

    // Clear value-side state on op change to avoid stale from/to leakage.
    const setOp = (op: DateFilterOp) => {
      column.setFilterValue({ op } as DateFilterValue);
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
          <SingleDateInput
            column={column}
            value={current}
            inputType={
              DATE_ONLY_OPS.has(current.op) ? "date" : "datetime-local"
            }
          />
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
          type="datetime-local"
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
          type="datetime-local"
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

function MultiSelectFilter<TData>({
  column,
}: {
  column: Column<TData, unknown>;
}) {
  const options = column.columnDef.meta?.filterOptions ?? [];
  // Empty / undefined means "no filter".
  const selected = (column.getFilterValue() as string[] | undefined) ?? [];
  const selectedSet = new Set(selected);

  const toggle = (value: string) => {
    const next = selectedSet.has(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    column.setFilterValue(next.length > 0 ? next : undefined);
  };

  const allChecked = options.length > 0 && selected.length === options.length;
  const someChecked = selected.length > 0 && !allChecked;

  const toggleAll = () => {
    if (allChecked || someChecked) column.setFilterValue(undefined);
    else column.setFilterValue(options.map((o) => o.value));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex cursor-pointer items-center gap-2 border-b border-border pb-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={allChecked}
          // Tri-state checkbox — indeterminate when partially selected.
          ref={(el) => {
            if (el) el.indeterminate = someChecked;
          }}
          onChange={toggleAll}
          className="size-3.5 cursor-pointer accent-primary"
          data-testid={`filter-${column.id}-all`}
        />
        All ({options.length})
      </label>
      {options.map((opt) => (
        <label
          key={opt.value}
          className="flex cursor-pointer items-center gap-2 text-xs"
        >
          <input
            type="checkbox"
            checked={selectedSet.has(opt.value)}
            onChange={() => toggle(opt.value)}
            className="size-3.5 cursor-pointer accent-primary"
            data-testid={`filter-${column.id}-${opt.value}`}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function SingleDateInput<TData>({
  column,
  value,
  inputType,
}: {
  column: Column<TData, unknown>;
  value: Extract<
    DateFilterValue,
    { op: "on" | "before" | "same_or_before" | "after" | "same_or_after" }
  >;
  inputType: "date" | "datetime-local";
}) {
  const update = (next: string) => {
    if (!next) column.setFilterValue({ op: value.op });
    else column.setFilterValue({ op: value.op, value: next });
  };

  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {inputType === "date" ? "Date" : "Date & time"}
      <input
        type={inputType}
        data-testid={`filter-${column.id}-value`}
        value={value.value ?? ""}
        onChange={(e) => update(e.target.value)}
        className={INPUT_CLASS}
      />
    </label>
  );
}
