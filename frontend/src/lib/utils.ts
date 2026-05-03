import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combine class names with Tailwind-aware deduplication.
 * Standard shadcn helper — every UI primitive uses it.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format a number with locale-aware thousand separators and a fixed
 * decimal precision. The rule from DESIGN §"Number Formatting": if a
 * value above 999 is plausible (kWh totals, building-wide power, etc.)
 * use `fmtNum()`. Stays-small values (temperature, %, machine count)
 * skip it — the separators would be visual noise.
 *
 * Locale defaults to the runtime's, which is what the user expects in
 * a dashboard. Pass `decimals` to control precision; `1` is the
 * common case for kW / kWh.
 */
export function fmtNum(value: number, decimals = 1): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
