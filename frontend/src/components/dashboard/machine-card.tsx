import type { Machine } from "@/lib/api";
import { cn } from "@/lib/utils";

import { StatusBadge } from "./status-badge";

/**
 * One machine in the grid. Shows name, zone, current power (or speed
 * for fans), and ON/OFF status. Optionally clickable: when `onClick`
 * is supplied, the card becomes a button-like surface that highlights
 * on hover and renders a primary border when `selected` is true.
 *
 * The card stays presentational — the page owns selection state and
 * the URL `?selected=...` synchronization.
 */
interface MachineCardProps {
  machine: Machine;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

export function MachineCard({
  machine,
  selected,
  onClick,
  className,
}: MachineCardProps) {
  const r = machine.latest_reading;
  const isInteractive = !!onClick;

  // Primary metric for the card body: power for ACs/critical machines,
  // speed for fans (when available — fans store speed_pct, not power).
  const primary =
    machine.machine_type === "fan" &&
    r?.speed_pct !== null &&
    r?.speed_pct !== undefined
      ? `${r.speed_pct.toFixed(0)}%`
      : r
        ? `${r.power_kw.toFixed(1)} kW`
        : "—";

  const Component = isInteractive ? "button" : "div";

  return (
    <Component
      type={isInteractive ? "button" : undefined}
      onClick={onClick}
      data-testid={`machine-card-${machine.name}`}
      aria-pressed={isInteractive ? !!selected : undefined}
      className={cn(
        "rounded-lg border bg-card p-3 text-left text-card-foreground transition-colors",
        isInteractive &&
          "cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected ? "border-primary ring-1 ring-primary" : "border-border",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold">
            {machine.name}
          </p>
          <p
            className="truncate text-xs text-muted-foreground"
            title={machine.zone}
          >
            {machine.zone}
          </p>
        </div>
        {r && <StatusBadge status={r.status} />}
      </div>

      <p className="mt-2 font-mono text-lg font-semibold">{primary}</p>

      <p className="text-xs text-muted-foreground">
        {machine.machine_type === "fan" ? "Speed" : "Power"}
        {" · "}
        {machine.rated_power_kw.toFixed(0)} kW rated
      </p>
    </Component>
  );
}
