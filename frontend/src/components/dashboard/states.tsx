import type { ReactNode } from "react";
import { CircleAlert, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared status panels per DESIGN.md §1C.
 *
 *   <LoadingState />  spinner + message,   role="status"  for assistive tech
 *   <ErrorState />    destructive icon,    role="alert"
 *
 * Both stretch to fill the parent and centre their content. Pages drop
 * them straight into a card body — the parent owns the box; these own
 * the message.
 */

interface BaseProps {
  message?: ReactNode;
  className?: string;
  /** Test hook — page-specific value such as "decisions-loading". */
  testId?: string;
}

const SHELL_CLASS = "flex items-center justify-center gap-2 p-6 text-sm";

export function LoadingState({
  message = "Loading…",
  className,
  testId,
}: BaseProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      className={cn(SHELL_CLASS, "text-muted-foreground", className)}
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function ErrorState({
  message = "Something went wrong.",
  className,
  testId,
}: BaseProps) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className={cn(SHELL_CLASS, "text-destructive", className)}
    >
      <CircleAlert className="size-4" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
