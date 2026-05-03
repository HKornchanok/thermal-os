import { AlertTriangle, CircleAlert } from "lucide-react";

import type { Alert } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Stack of alert rows shown above the KPIs on the Overview page.
 *
 * Each row is clickable when `onSelect` is supplied — clicking jumps
 * the user to /machines?selected=<id> so they can inspect the offending
 * machine's chart immediately.
 *
 * Severity styling:
 *   critical → destructive border + tinted background, AlertTriangle
 *   warning  → default border + muted background, CircleAlert
 *
 * Both severities share the same row layout so the banner stays
 * compact and scans top-to-bottom in one glance.
 */
export interface AlertBannerProps {
  alerts: Alert[];
  /** Optional click handler — receives the alert's machine_id. */
  onSelect?: (machineId: number) => void;
  className?: string;
}

export function AlertBanner({ alerts, onSelect, className }: AlertBannerProps) {
  if (alerts.length === 0) return null;

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      data-testid="alert-banner"
      role="status"
      aria-live="polite"
    >
      {alerts.map((a, i) => (
        <AlertRow
          key={`${a.machine_id}-${a.rule}-${i}`}
          alert={a}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function AlertRow({
  alert,
  onSelect,
}: {
  alert: Alert;
  onSelect?: (machineId: number) => void;
}) {
  const isCritical = alert.severity === "critical";
  const Icon = isCritical ? AlertTriangle : CircleAlert;
  const interactive = !!onSelect;
  const Component = interactive ? "button" : "div";

  return (
    <Component
      type={interactive ? "button" : undefined}
      onClick={interactive ? () => onSelect!(alert.machine_id) : undefined}
      data-testid={`alert-row-${alert.machine_name}`}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
        isCritical
          ? "border-destructive/50 bg-destructive/10 text-foreground"
          : "border-border bg-muted/40 text-foreground",
        interactive && "cursor-pointer hover:bg-muted"
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          isCritical ? "text-destructive" : "text-muted-foreground"
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="truncate">
          <span
            className={cn(
              "mr-2 font-mono text-[10px] uppercase tracking-wide",
              isCritical ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {alert.severity}
          </span>
          <span className="font-mono font-semibold">{alert.machine_name}</span>
          <span className="text-muted-foreground"> · </span>
          <span>{alert.message}</span>
        </p>
      </div>
    </Component>
  );
}
