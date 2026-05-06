/**
 * Date helpers for the dashboard.
 *
 * The pages use two shapes of date strings:
 *   YYYY-MM-DD       — what `<input type="date">` produces / consumes
 *   ISO 8601 UTC     — what the backend's `from` / `to` query params expect
 *
 * Conversion is anchored at the BROWSER's local timezone (`new Date(local)`
 * with no Z suffix). A user in Bangkok picking "May 03" gets May 03 00:00
 * Bangkok local → 2026-05-02T17:00:00Z UTC; the backend stores in UTC and
 * the round-trip stays correct.
 *
 * Centralising here so /energy + /compare + the data-table column filters
 * all share one canonical implementation — previous versions had three
 * subtly-different copies.
 */

const PAD = (n: number) => String(n).padStart(2, "0");

/** Today's date in the browser's local zone, formatted YYYY-MM-DD. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}

/** Shift a YYYY-MM-DD by `n` days (positive or negative); returns same format. */
export function shiftDay(yyyyMmDd: string, n: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${PAD(dt.getMonth() + 1)}-${PAD(dt.getDate())}`;
}

/**
 * ISO timestamp at local midnight of the given YYYY-MM-DD.
 * Inclusive lower bound for backend `from`.
 */
export function dayStartIso(yyyyMmDd: string): string {
  return new Date(`${yyyyMmDd}T00:00:00`).toISOString();
}

/**
 * ISO timestamp at local midnight of the day AFTER the given YYYY-MM-DD.
 * Exclusive upper bound for backend `to`.
 */
export function dayEndIso(yyyyMmDd: string): string {
  return shiftDayToIso(yyyyMmDd, 1);
}

/**
 * ISO timestamp at end-of-day (23:59:59 local) of the given YYYY-MM-DD.
 * Use for `to` when the backend treats the bound as inclusive — the day-
 * end-second pattern.
 */
export function endOfDayIso(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59).toISOString();
}

/**
 * Convert a YYYY-MM-DD `<input type="date">` value into ISO UTC.
 * Empty string → undefined (so callers can spread into hook params and
 * the server falls back to its smart default).
 */
export function inputDateToIso(
  date: string,
  endOfDay = false
): string | undefined {
  if (!date) return undefined;
  return endOfDay ? endOfDayIso(date) : dayStartIso(date);
}

/** Inverse — extract YYYY-MM-DD (browser local) from an ISO UTC datetime. */
export function isoToLocalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}

/** Locale-formatted "Wed, May 07, 2026" header for a YYYY-MM-DD value. */
export function formatDayLabel(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

/**
 * Min of two YYYY-MM-DD strings — lexical order works for ISO dates so
 * we don't need to round-trip through Date.
 */
export function minDateStr(a: string, b: string): string {
  return a < b ? a : b;
}

// ---------------------------------------------------------------------------
// Internal — `shiftDay` returns a YYYY-MM-DD; this returns its ISO start.
// Keeps `dayEndIso` a single line without re-parsing.
// ---------------------------------------------------------------------------
function shiftDayToIso(yyyyMmDd: string, n: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d + n).toISOString();
}
