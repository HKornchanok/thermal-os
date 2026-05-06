import type { ColumnDef } from "@tanstack/react-table";

import { ColumnFilter } from "@/components/data-table/column-filter";
import { Badge } from "@/components/ui/badge";
import type { Decision, DecisionAction } from "@/lib/api";

export const ACTION_LABELS: Record<DecisionAction, string> = {
  turn_on: "Turn on",
  turn_off: "Turn off",
  set_temp: "Set temp",
};

// turn_on = primary green (start), turn_off = outline (stop),
// set_temp = secondary yellow (adjustment).
export const ACTION_BADGE_VARIANT: Record<
  DecisionAction,
  "default" | "secondary" | "outline"
> = {
  turn_on: "default",
  turn_off: "outline",
  set_temp: "secondary",
};

const ACTION_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "turn_on", label: "Turn on" },
  { value: "turn_off", label: "Turn off" },
  { value: "set_temp", label: "Set temp" },
];

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

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
    // 200px fits "May 03, 2026, 16:05" + funnel without wrapping.
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
      <span className="text-foreground/90 text-sm">{getValue<string>()}</span>
    ),
  },
];
