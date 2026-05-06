import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  /** Optional second line — trend %, units, "as of…". */
  hint?: ReactNode;
  testId?: string;
  className?: string;
}

export function KpiCard({
  label,
  value,
  hint,
  testId,
  className,
}: KpiCardProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "rounded-lg border border-border bg-card p-3 text-card-foreground",
        className
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className="mt-1 font-mono text-lg font-semibold"
        data-testid={testId ? `${testId}-value` : undefined}
      >
        {value}
      </p>
      {hint !== undefined && hint !== null && (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
