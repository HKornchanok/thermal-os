import type { ReadingStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * ON / OFF status pill with a coloured dot.
 *   ON  → primary (green) dot, primary text
 *   OFF → muted dot + muted text
 *
 * Used on /machines cards and the detail panel; the same primitive can
 * decorate any future row that needs to read "this thing is alive".
 */
export function StatusBadge({
  status,
  className,
}: {
  status: ReadingStatus;
  className?: string;
}) {
  const isOn = status === "ON";
  return (
    <span
      data-testid={`status-${status.toLowerCase()}`}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        isOn ? "text-primary" : "text-muted-foreground",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          isOn ? "bg-primary" : "bg-muted-foreground"
        )}
      />
      {status}
    </span>
  );
}
