import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Compact label-and-value card. Used for summary stats on data pages
 * (Energy: peak / avg / data points) and for the headline KPIs on the
 * Overview (total machines, today's kWh, avg temperature, etc.).
 *
 * The `hint` slot is intentionally a `ReactNode` so callers can render
 * a coloured trend indicator, units, or anything else under the value
 * without forcing a specific shape on the component. Pages stay in
 * charge of their own wording and formatting; the card only owns the
 * surface, padding, and typography.
 */
export interface KpiCardProps {
  label: string;
  value: ReactNode;
  /** Optional second line under the value (trend %, units, "as of..."). */
  hint?: ReactNode;
  /** Hooks the value text for E2E selectors. */
  testId?: string;
  className?: string;
}

export function KpiCard({ label, value, hint, testId, className }: KpiCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3 text-card-foreground",
        className
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold" data-testid={testId}>
        {value}
      </p>
      {hint !== undefined && hint !== null && (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
