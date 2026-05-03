import type { ColumnDef } from "@tanstack/react-table";

import { ColumnFilter } from "@/components/data-table/column-filter";
import { Badge } from "@/components/ui/badge";
import type { Decision, DecisionAction } from "@/lib/api";

// =====================================================================
// Lookup tables shared with the page (badge variants).
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

// =====================================================================
// Filter value shapes the page deserialises out of state.columnFilters.
// =====================================================================

/** action_type column stores an array of selected DecisionActions. */
export type ActionFilter = DecisionAction[];
// Re-export the shared discriminated union so the page can import a
// single canonical type instead of redeclaring it.
export type { DateFilterValue, DateFilterOp } from "@/components/data-table/column-filter";

// Multi-select options — "All" is implicit (empty selection = no filter),
// so the list contains only the actual action values.
const ACTION_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "turn_on", label: "Turn on" },
  { value: "turn_off", label: "Turn off" },
  { value: "set_temp", label: "Set temp" },
];

// =====================================================================
// Column definitions.
//
// Filterable columns declare `enableColumnFilter: true` and a
// `meta.filterVariant` (+ filterOptions / filterLabel where useful).
// Headers render the label plus a <ColumnFilter /> trigger; clicking
// the funnel opens a popover with the matching input.
// =====================================================================

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Compact header row: label pinned left, optional filter trigger pinned right. */
function HeaderShell({
  label,
  children,
}: {
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span>{label}</span>
      {children}
    </div>
  );
}

export const decisionColumns: ColumnDef<Decision>[] = [
  {
    accessorKey: "decided_at",
    enableColumnFilter: true,
    // 200px lets the formatted datetime ("May 03, 2026, 16:05") + the
    // funnel button breathe; the default 120px wraps awkwardly.
    meta: { filterVariant: "date", filterLabel: "Decided at", minWidth: 200 },
    header: ({ column }) => (
      <HeaderShell label="When">
        <ColumnFilter column={column} />
      </HeaderShell>
    ),
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
        {formatDateTime(getValue<string>())}
      </span>
    ),
  },
  {
    accessorKey: "machine_name",
    enableColumnFilter: false,
    header: () => <HeaderShell label="Machine" />,
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
    meta: {
      filterVariant: "multiselect",
      filterOptions: ACTION_FILTER_OPTIONS,
      filterLabel: "Actions",
    },
    header: ({ column }) => (
      <HeaderShell label="Action">
        <ColumnFilter column={column} />
      </HeaderShell>
    ),
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
    header: () => <HeaderShell label="Value" />,
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
    header: () => <HeaderShell label="Reason" />,
    cell: ({ getValue }) => (
      <span className="text-sm text-foreground/90">{getValue<string>()}</span>
    ),
  },
];
