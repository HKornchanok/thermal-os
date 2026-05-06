import type { Machine } from "@/lib/api";
import { cn } from "@/lib/utils";

import { StatusBadge } from "./status-badge";

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

  // Fans show speed; everything else shows power.
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
        isInteractive && "cursor-pointer hover:bg-muted",
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
