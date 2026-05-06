import type { ReadingStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

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
