import type { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import type { Decision, DecisionAction } from "@/lib/api";

// =====================================================================
// Lookup tables shared with the page (filter dropdown, badge variants).
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
// Column definitions for the AI Decisions table.
//
// Kept separate from the page so the page itself stays focused on filter
// state, pagination, and loading/error/empty branches. Cell renderers
// import from the shared theme primitives so the table inherits the
// app's look-and-feel automatically.
// =====================================================================

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export const decisionColumns: ColumnDef<Decision>[] = [
  {
    accessorKey: "decided_at",
    header: "When",
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
        {formatDateTime(getValue<string>())}
      </span>
    ),
  },
  {
    accessorKey: "machine_name",
    header: "Machine",
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
    header: "Action",
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
    header: "Value",
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
    header: "Reason",
    cell: ({ getValue }) => (
      <span className="text-sm text-foreground/90">{getValue<string>()}</span>
    ),
  },
];
