import type { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import type { Decision, DecisionAction } from "@/lib/api";

// =====================================================================
// Lookup tables shared with the page (badge variants, filter options).
// =====================================================================

export const ACTION_LABELS: Record<DecisionAction, string> = {
  turn_on: "Turn on",
  turn_off: "Turn off",
  set_temp: "Set temp",
};

/**
 * Maps each action to a badge variant that uses the right theme token:
 *  - turn_on → primary (green) for "starting / activating"
 *  - turn_off → outline for the muted "stopping" case
 *  - set_temp → secondary (yellow) to signal an adjustment, not a state change
 */
export const ACTION_BADGE_VARIANT: Record<
  DecisionAction,
  "default" | "secondary" | "outline"
> = {
  turn_on: "default",
  turn_off: "outline",
  set_temp: "secondary",
};

const ACTION_FILTER_OPTIONS: { value: "" | DecisionAction; label: string }[] = [
  { value: "", label: "All" },
  { value: "turn_on", label: "Turn on" },
  { value: "turn_off", label: "Turn off" },
  { value: "set_temp", label: "Set temp" },
];

// =====================================================================
// Filter value shapes per column.
//
// We use TanStack Table's built-in column-filter API (column.getFilterValue
// / column.setFilterValue), but with `manualFiltering: true` so the values
// are just stored — the actual filtering happens server-side. Each filter
// column declares its filter-value shape here so the page can deserialise
// `state.columnFilters` into useDecisions params type-safely.
// =====================================================================

/** decided_at: a date range. Either bound is optional. */
export type DateRangeFilter = { from?: string; to?: string };
/** action_type: one of the allowed actions, or empty for "all". */
export type ActionFilter = "" | DecisionAction;

// =====================================================================
// Column definitions.
//
// Headers are two-row: a label, then a filter input where the column
// supports server-side filtering. Machine/Value/Reason aren't filterable
// by the backend yet — they render label-only headers with a spacer to
// keep the header row heights aligned.
// =====================================================================

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const HEADER_INPUT_CLASS =
  "rounded border border-input bg-background px-1.5 py-1 text-xs font-normal text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

const HEADER_FILTER_SPACER_HEIGHT = "h-[26px]"; // matches the filter input height

export const decisionColumns: ColumnDef<Decision>[] = [
  {
    accessorKey: "decided_at",
    enableColumnFilter: true,
    header: ({ column }) => {
      const filter = (column.getFilterValue() as DateRangeFilter | undefined) ?? {};
      return (
        <div className="flex flex-col gap-1">
          <span>When</span>
          <div className="flex items-center gap-1">
            <input
              type="date"
              data-testid="filter-from"
              value={filter.from ?? ""}
              onChange={(e) =>
                column.setFilterValue({ ...filter, from: e.target.value || undefined })
              }
              aria-label="Start date"
              className={HEADER_INPUT_CLASS}
            />
            <span className="text-muted-foreground">→</span>
            <input
              type="date"
              data-testid="filter-to"
              value={filter.to ?? ""}
              onChange={(e) =>
                column.setFilterValue({ ...filter, to: e.target.value || undefined })
              }
              aria-label="End date"
              className={HEADER_INPUT_CLASS}
            />
          </div>
        </div>
      );
    },
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
        {formatDateTime(getValue<string>())}
      </span>
    ),
  },
  {
    accessorKey: "machine_name",
    enableColumnFilter: false,
    header: () => (
      <div className="flex flex-col gap-1">
        <span>Machine</span>
        <div className={HEADER_FILTER_SPACER_HEIGHT} aria-hidden />
      </div>
    ),
    cell: ({ getValue }) => {
      const name = getValue<string | null>();
      return name ? (
        <span className="font-medium">{name}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  },
  {
    accessorKey: "action_type",
    enableColumnFilter: true,
    header: ({ column }) => {
      const filter = (column.getFilterValue() as ActionFilter | undefined) ?? "";
      return (
        <div className="flex flex-col gap-1">
          <span>Action</span>
          <select
            data-testid="filter-action"
            value={filter}
            onChange={(e) =>
              column.setFilterValue(
                e.target.value === "" ? undefined : (e.target.value as ActionFilter)
              )
            }
            aria-label="Action filter"
            className={HEADER_INPUT_CLASS}
          >
            {ACTION_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );
    },
    cell: ({ getValue }) => {
      const action = getValue<DecisionAction>();
      return (
        <Badge variant={ACTION_BADGE_VARIANT[action]}>
          {ACTION_LABELS[action]}
        </Badge>
      );
    },
  },
  {
    accessorKey: "value",
    enableColumnFilter: false,
    header: () => (
      <div className="flex flex-col gap-1">
        <span>Value</span>
        <div className={HEADER_FILTER_SPACER_HEIGHT} aria-hidden />
      </div>
    ),
    cell: ({ getValue, row }) => {
      const v = getValue<number | null>();
      if (v === null) return <span className="text-muted-foreground">—</span>;
      // Only set_temp carries a numeric setpoint. Suffix only there so
      // turn_on/turn_off would read naturally if they ever start populating.
      const suffix = row.original.action_type === "set_temp" ? "°C" : "";
      return (
        <span className="font-mono text-xs">
          {v.toFixed(1)}
          {suffix}
        </span>
      );
    },
  },
  {
    accessorKey: "reason",
    enableColumnFilter: false,
    header: () => (
      <div className="flex flex-col gap-1">
        <span>Reason</span>
        <div className={HEADER_FILTER_SPACER_HEIGHT} aria-hidden />
      </div>
    ),
    cell: ({ getValue }) => (
      <span className="text-sm text-foreground/90">{getValue<string>()}</span>
    ),
  },
];
