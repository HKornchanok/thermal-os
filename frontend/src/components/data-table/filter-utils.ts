import type { ColumnFiltersState } from "@tanstack/react-table";

import { dayEndIso, dayStartIso } from "@/lib/dates";

import type { DateFilterValue } from "./column-filter";

// =====================================================================
// Datetime helpers specific to the column-filter operators.
//
// `<input type="datetime-local">` produces "YYYY-MM-DDTHH:MM" (no zone),
// which `new Date(local)` parses in the browser's local zone. Output is
// always ISO 8601 UTC ready for the backend's `from`/`to` params.
//
// Date-only helpers (`<input type="date">` shape) are imported from
// `@/lib/dates` so /energy, /compare, and the column-filter operators
// all share one canonical implementation.
// =====================================================================

/** Convert a datetime-local value to ISO UTC. */
export function localDatetimeToIso(local: string): string {
  return new Date(local).toISOString();
}

/** One second after the given local datetime, as ISO UTC. */
export function plusOneSecondIso(local: string): string {
  const d = new Date(local);
  d.setSeconds(d.getSeconds() + 1);
  return d.toISOString();
}

// =====================================================================
// Operator-aware translation for the date filter variant.
//
//   between A..B    → from = A,        to = B + 1s   (inclusive both ends)
//   on D            → from = startOf(D), to = startOf(D + 1d)
//   before T        → to   = T            (strictly < T)
//   same_or_before T→ to   = T + 1s       (≤ T)
//   after T         → from = T + 1s       (strictly > T)
//   same_or_after T → from = T            (≥ T)
//
// The backend's filter contract is half-open: `recorded >= from AND
// recorded < to`. The translations above implement each operator
// against that contract.
// =====================================================================

export function dateFilterToRange(v: DateFilterValue): {
  from?: string;
  to?: string;
} {
  switch (v.op) {
    case "between": {
      const out: { from?: string; to?: string } = {};
      if (v.from) out.from = localDatetimeToIso(v.from);
      if (v.to) out.to = plusOneSecondIso(v.to);
      return out;
    }
    case "on":
      return v.value
        ? { from: dayStartIso(v.value), to: dayEndIso(v.value) }
        : {};
    case "before":
      return v.value ? { to: localDatetimeToIso(v.value) } : {};
    case "same_or_before":
      return v.value ? { to: plusOneSecondIso(v.value) } : {};
    case "after":
      return v.value ? { from: plusOneSecondIso(v.value) } : {};
    case "same_or_after":
      return v.value ? { from: localDatetimeToIso(v.value) } : {};
  }
}

// =====================================================================
// Generic extractors over TanStack Table's columnFilters state.
//
// Each filter column knows its own value shape (declared via meta);
// these helpers find the filter for a given column id and translate it
// into the API param the backend expects. Pages compose the results.
// =====================================================================

// TanStack stores filter values as `unknown`. Validate the shape at the
// boundary instead of casting, so a column whose `filterVariant` got
// wired to a different value shape doesn't silently corrupt downstream
// API params. The runtime cost is negligible — these run once per
// render's filter list (typically 0–3 entries).

const KNOWN_DATE_OPS = new Set([
  "between",
  "on",
  "before",
  "same_or_before",
  "after",
  "same_or_after",
]);

function isDateFilterValue(v: unknown): v is DateFilterValue {
  if (!v || typeof v !== "object") return false;
  const op = (v as { op?: unknown }).op;
  return typeof op === "string" && KNOWN_DATE_OPS.has(op);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Read a date filter from columnFilters and translate it into half-open
 * `{ from?, to? }` ISO UTC ranges via dateFilterToRange. Returns `{}`
 * when the column isn't filtered or the filter value is missing required
 * fields.
 */
export function extractDateRangeFromColumnFilters(
  filters: ColumnFiltersState,
  columnId: string
): { from?: string; to?: string } {
  const f = filters.find((x) => x.id === columnId);
  if (!f || !isDateFilterValue(f.value)) return {};
  return dateFilterToRange(f.value);
}

/**
 * Read a multiselect filter (string[] of selected option values) from
 * columnFilters. Returns `undefined` when the column isn't filtered or
 * the selection is empty — easier to spread into hook params than an
 * empty array, which would still serialise to `?action=`.
 */
export function extractMultiselectFromColumnFilters<T extends string = string>(
  filters: ColumnFiltersState,
  columnId: string
): T[] | undefined {
  const f = filters.find((x) => x.id === columnId);
  if (!f || !isStringArray(f.value) || f.value.length === 0) return undefined;
  return f.value as T[];
}
