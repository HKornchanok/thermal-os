import type { ColumnFiltersState } from "@tanstack/react-table";

import type { DateFilterValue } from "./column-filter";

// =====================================================================
// Datetime helpers
//
// All inputs here are wall-clock strings as produced by HTML inputs:
//   <input type="date">           → "YYYY-MM-DD"
//   <input type="datetime-local"> → "YYYY-MM-DDTHH:MM"
// Both are interpreted in the user's BROWSER timezone (`new Date(...)`
// without a Z suffix). The output is always ISO 8601 UTC, ready to send
// to the backend.
// =====================================================================

/** Convert a datetime-local value to ISO UTC. */
export function localDatetimeToIso(local: string): string {
  return new Date(local).toISOString();
}

/** Local-zone midnight of the given YYYY-MM-DD, as ISO UTC. */
export function localDateStart(yyyyMmDd: string): string {
  return new Date(`${yyyyMmDd}T00:00:00`).toISOString();
}

/** Next day's local midnight, as ISO UTC — exclusive end-of-day. */
export function localDateAfter(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
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
        ? { from: localDateStart(v.value), to: localDateAfter(v.value) }
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
  if (!f) return {};
  const value = f.value as DateFilterValue | undefined;
  if (!value) return {};
  return dateFilterToRange(value);
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
  if (!f) return undefined;
  const value = f.value as T[] | undefined;
  if (!value || value.length === 0) return undefined;
  return value;
}
