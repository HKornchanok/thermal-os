import type { ColumnFiltersState } from "@tanstack/react-table";

import { dayEndIso, dayStartIso } from "@/lib/dates";

import type { DateFilterValue } from "./column-filter";

/** Datetime-local value → ISO UTC. */
export function localDatetimeToIso(local: string): string {
  return new Date(local).toISOString();
}

/** Datetime-local + 1 second → ISO UTC. Used for `same_or_…` operators. */
export function plusOneSecondIso(local: string): string {
  const d = new Date(local);
  d.setSeconds(d.getSeconds() + 1);
  return d.toISOString();
}

/**
 * Translate a date-filter operator to the backend's half-open
 * `{ from?, to? }` range (recorded >= from AND recorded < to).
 *
 *   between A..B     → from=A, to=B+1s
 *   on D             → from=startOf(D), to=startOf(D+1d)
 *   before T         → to=T
 *   same_or_before T → to=T+1s
 *   after T          → from=T+1s
 *   same_or_after T  → from=T
 */
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

// TanStack stores filter values as `unknown`. Validate at the boundary
// so a misconfigured column doesn't silently corrupt API params.

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

export function extractDateRangeFromColumnFilters(
  filters: ColumnFiltersState,
  columnId: string
): { from?: string; to?: string } {
  const f = filters.find((x) => x.id === columnId);
  if (!f || !isDateFilterValue(f.value)) return {};
  return dateFilterToRange(f.value);
}

/** undefined (not []) when no selection — empty array still serialises. */
export function extractMultiselectFromColumnFilters<T extends string = string>(
  filters: ColumnFiltersState,
  columnId: string
): T[] | undefined {
  const f = filters.find((x) => x.id === columnId);
  if (!f || !isStringArray(f.value) || f.value.length === 0) return undefined;
  return f.value as T[];
}
