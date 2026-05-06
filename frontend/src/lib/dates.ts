/**
 * Date helpers shared by /energy, /compare, and the data-table column
 * filters. All conversions anchor at the BROWSER's local timezone —
 * `<input type="date">` produces YYYY-MM-DD, the backend's from/to params
 * want ISO 8601 UTC.
 */

const PAD = (n: number) => String(n).padStart(2, "0");

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}

export function shiftDay(yyyyMmDd: string, n: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${PAD(dt.getMonth() + 1)}-${PAD(dt.getDate())}`;
}

/** Local midnight of the given day, as ISO UTC. Inclusive `from`. */
export function dayStartIso(yyyyMmDd: string): string {
  return new Date(`${yyyyMmDd}T00:00:00`).toISOString();
}

/** Local midnight of the next day, as ISO UTC. Exclusive `to`. */
export function dayEndIso(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d + 1).toISOString();
}

/** 23:59:59 local of the given day, for inclusive-`to` callers. */
export function endOfDayIso(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59).toISOString();
}

/** Empty string → undefined so callers can spread into hook params. */
export function inputDateToIso(
  date: string,
  endOfDay = false
): string | undefined {
  if (!date) return undefined;
  return endOfDay ? endOfDayIso(date) : dayStartIso(date);
}

export function isoToLocalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}

export function formatDayLabel(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

/** Lexical min — works for ISO dates without round-tripping through Date. */
export function minDateStr(a: string, b: string): string {
  return a < b ? a : b;
}
