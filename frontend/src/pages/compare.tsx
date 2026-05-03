import Head from "next/head";
import { useEffect, useMemo, useState } from "react";

import { AreaChart } from "@/components/dashboard/area-chart";
import { ErrorState, LoadingState } from "@/components/dashboard/states";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Button } from "@/components/ui/button";
import { useBuildingEnergy } from "@/lib/hooks/use-building-energy";
import { useEnergyCompare } from "@/lib/hooks/use-energy-compare";
import { fmtNum } from "@/lib/utils";

const SERIES_BEFORE = "Before AI";
const SERIES_AFTER = "After AI";

/**
 * Convert a "YYYY-MM-DD" local-date input value into the ISO 8601
 * timestamp the backend wants. Empty string → undefined so the hook
 * omits the param and the server falls back to its smart default.
 *
 * `endOfDay = true` adds 23:59:59 so a "to" boundary inclusively
 * covers the whole day.
 */
function localDateToIso(date: string, endOfDay = false): string | undefined {
  if (!date) return undefined;
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(
    y,
    m - 1,
    d,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0
  );
  return dt.toISOString();
}

function isoToLocalDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Add `n` days to a YYYY-MM-DD string and return the same format. */
function addDays(yyyyMmDd: string, n: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** Min of two YYYY-MM-DD strings (lexical order works for ISO dates). */
function minDateStr(a: string, b: string): string {
  return a < b ? a : b;
}

/**
 * Merge two time-aligned-by-index energy series into chart rows. Period
 * lengths can differ; rows pad the shorter side with `undefined` so the
 * line just stops rather than wrapping back. X axis is "hour offset
 * from each period's start", which lets the curves overlay despite
 * different absolute timestamps.
 */
function mergeAlignedByHour(
  before: { bucket: string; total_kw: number }[] | undefined,
  after: { bucket: string; total_kw: number }[] | undefined
) {
  const len = Math.max(before?.length ?? 0, after?.length ?? 0);
  const rows: {
    offsetHours: number;
    [SERIES_BEFORE]?: number;
    [SERIES_AFTER]?: number;
  }[] = [];
  for (let i = 0; i < len; i++) {
    rows.push({
      offsetHours: i,
      [SERIES_BEFORE]: before?.[i]?.total_kw,
      [SERIES_AFTER]: after?.[i]?.total_kw,
    });
  }
  return rows;
}

export default function ComparePage() {
  // Local state — empty strings let the server pick smart defaults
  // (split the seed window in half).
  const [aFrom, setAFrom] = useState("");
  const [aTo, setATo] = useState("");
  const [bFrom, setBFrom] = useState("");
  const [bTo, setBTo] = useState("");

  const compareQuery = useEnergyCompare({
    a_from: localDateToIso(aFrom),
    a_to: localDateToIso(aTo, true),
    b_from: localDateToIso(bFrom),
    b_to: localDateToIso(bTo, true),
  });
  const compare = compareQuery.data;

  // Each period stays inside its half of the seed window — Period A
  // (Before AI) is bounded to the manual period, Period B (After AI)
  // to the AI period. Without this, a user could pick a Period A date
  // that lives inside the AI window (or vice-versa) and the comparison
  // would silently stop being a manual-vs-AI comparison.
  const periodARange = useMemo(() => {
    if (!compare?.before) return null;
    return {
      min: isoToLocalDate(compare.before.from),
      max: isoToLocalDate(compare.before.to),
    };
  }, [compare]);
  const periodBRange = useMemo(() => {
    if (!compare?.after) return null;
    return {
      min: isoToLocalDate(compare.after.from),
      max: isoToLocalDate(compare.after.to),
    };
  }, [compare]);

  // Canonical default ranges — the brief frames the comparison as the
  // first 3 days of manual against the first 3 days of AI. Equal-length
  // windows make the savings_pct delta meaningful (comparing 3 days to
  // 4 days would skew the average against the longer side). We pin the
  // defaults to (range.min, range.min + 2 days), clamped to range.max
  // so a shorter seed window doesn't over-extend.
  const defaults = useMemo(() => {
    if (!periodARange || !periodBRange) return null;
    return {
      aFrom: periodARange.min,
      aTo: minDateStr(addDays(periodARange.min, 2), periodARange.max),
      bFrom: periodBRange.min,
      bTo: minDateStr(addDays(periodBRange.min, 2), periodBRange.max),
    };
  }, [periodARange, periodBRange]);

  // First-load: once the compare endpoint responds with its resolved
  // boundaries, populate the inputs with the canonical defaults. We
  // gate on `initialised` so the user's own picks aren't clobbered if
  // the underlying compare response refreshes (e.g. seed re-runs while
  // they're on the page).
  const [initialised, setInitialised] = useState(false);
  useEffect(() => {
    if (initialised || !defaults) return;
    setAFrom(defaults.aFrom);
    setATo(defaults.aTo);
    setBFrom(defaults.bFrom);
    setBTo(defaults.bTo);
    setInitialised(true);
  }, [initialised, defaults]);

  const usingCanonicalDefaults =
    !!defaults &&
    aFrom === defaults.aFrom &&
    aTo === defaults.aTo &&
    bFrom === defaults.bFrom &&
    bTo === defaults.bTo;

  // Once compare resolves, fetch the per-period 1h timeseries so we can
  // overlay them as lines. We use the server-resolved ISO boundaries
  // (compare.before/after.from/to) rather than the raw inputs so the
  // chart matches the KPI numbers exactly even when defaults are in play.
  const beforeQuery = useBuildingEnergy(
    compare?.before
      ? { from: compare.before.from, to: compare.before.to, bucket: "1h" }
      : {}
  );
  const afterQuery = useBuildingEnergy(
    compare?.after
      ? { from: compare.after.from, to: compare.after.to, bucket: "1h" }
      : {}
  );

  const chartData = useMemo(
    () => mergeAlignedByHour(beforeQuery.data, afterQuery.data),
    [beforeQuery.data, afterQuery.data]
  );

  const reset = () => {
    if (!defaults) {
      setAFrom("");
      setATo("");
      setBFrom("");
      setBTo("");
      return;
    }
    setAFrom(defaults.aFrom);
    setATo(defaults.aTo);
    setBFrom(defaults.bFrom);
    setBTo(defaults.bTo);
  };

  const isChartLoading =
    !!compare?.before &&
    !!compare?.after &&
    (beforeQuery.isLoading || afterQuery.isLoading);
  const isChartError = beforeQuery.isError || afterQuery.isError;

  return (
    <>
      <Head>
        <title>Before/After · ThermalOS</title>
      </Head>

      <div className="flex items-baseline justify-between gap-4">
        <h1 className="mt-0 text-2xl font-semibold">Before / After</h1>
        {!usingCanonicalDefaults && initialised && (
          <Button variant="outline" size="sm" onClick={reset}>
            Reset to defaults
          </Button>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Compare average building power between two equal-length periods.
        Defaults to the first 3 days of manual operations vs. the first 3 days
        of AI control — same window length, so the savings_pct delta is directly
        comparable. The chart overlays both periods on a shared "hours from
        period start" axis so the curves line up regardless of absolute date.
      </p>

      {/* Period pickers */}
      <section className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <PeriodPicker
          label="Period A — Before AI"
          from={aFrom}
          to={aTo}
          minDate={periodARange?.min}
          maxDate={periodARange?.max}
          onFromChange={setAFrom}
          onToChange={setATo}
          testIdPrefix="period-a"
        />
        <PeriodPicker
          label="Period B — After AI"
          from={bFrom}
          to={bTo}
          minDate={periodBRange?.min}
          maxDate={periodBRange?.max}
          onFromChange={setBFrom}
          onToChange={setBTo}
          testIdPrefix="period-b"
        />
      </section>

      {/* KPIs */}
      <section className="mt-4">
        {compareQuery.isLoading ? (
          <LoadingState
            message="Loading comparison…"
            testId="compare-loading"
          />
        ) : compareQuery.isError ? (
          <ErrorState
            message={`Failed to load comparison: ${
              compareQuery.error instanceof Error
                ? compareQuery.error.message
                : "unknown error"
            }`}
            testId="compare-error"
          />
        ) : compare?.before && compare?.after ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <KpiCard
              label="Before — avg power"
              value={`${fmtNum(compare.before.avg_kw)} kW`}
              hint="Period A"
              testId="kpi-before-avg"
            />
            <KpiCard
              label="After — avg power"
              value={`${fmtNum(compare.after.avg_kw)} kW`}
              hint="Period B"
              testId="kpi-after-avg"
            />
            <KpiCard
              label="Savings"
              value={
                compare.savings_pct !== null ? (
                  <span
                    className={
                      compare.savings_pct > 0
                        ? "text-primary"
                        : compare.savings_pct < 0
                          ? "text-destructive"
                          : "text-foreground"
                    }
                  >
                    {compare.savings_pct > 0
                      ? "−"
                      : compare.savings_pct < 0
                        ? "+"
                        : ""}
                    {Math.abs(compare.savings_pct).toFixed(1)}%
                  </span>
                ) : (
                  "—"
                )
              }
              hint="(before − after) ÷ before"
              testId="kpi-savings"
            />
          </div>
        ) : (
          <p
            className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground"
            data-testid="compare-empty"
          >
            No data available for the selected periods.
          </p>
        )}
      </section>

      {/* Overlaid line chart */}
      {compare?.before && compare?.after && (
        <section
          className="mt-4 rounded-lg border border-border bg-card p-3 text-card-foreground"
          data-testid="compare-chart"
        >
          {isChartLoading ? (
            <LoadingState
              message="Loading period timeseries…"
              testId="chart-loading"
            />
          ) : isChartError ? (
            <ErrorState
              message="Failed to load period timeseries."
              testId="chart-error"
            />
          ) : chartData.length === 0 ? (
            <p
              className="p-6 text-center text-sm text-muted-foreground"
              data-testid="chart-empty"
            >
              No timeseries data for the selected periods.
            </p>
          ) : (
            <AreaChart
              data={chartData}
              xKey="offsetHours"
              series={[{ key: SERIES_BEFORE }, { key: SERIES_AFTER }]}
              xTickFormatter={(v) => `${v}h`}
              yTickFormatter={(v) => `${fmtNum(v as number, 0)} kW`}
              tooltipLabelFormatter={(v) => {
                const hours = v as number;
                const days = Math.floor(hours / 24);
                const rem = hours % 24;
                return days > 0 ? `Day ${days + 1}, h+${rem}` : `h+${hours}`;
              }}
              tooltipFormatter={(v, name) => [
                `${fmtNum(v as number)} kW`,
                name,
              ]}
            />
          )}
        </section>
      )}
    </>
  );
}

function PeriodPicker({
  label,
  from,
  to,
  minDate,
  maxDate,
  onFromChange,
  onToChange,
  testIdPrefix,
}: {
  label: string;
  from: string;
  to: string;
  /** Earliest selectable date (this period's window start). */
  minDate?: string;
  /** Latest selectable date (this period's window end). */
  maxDate?: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-card-foreground">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <input
            type="date"
            value={from}
            min={minDate}
            max={to || maxDate}
            onChange={(e) => onFromChange(e.target.value)}
            data-testid={`${testIdPrefix}-from`}
            className="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <input
            type="date"
            value={to}
            min={from || minDate}
            max={maxDate}
            onChange={(e) => onToChange(e.target.value)}
            data-testid={`${testIdPrefix}-to`}
            className="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>
      </div>
      {(minDate || maxDate) && (
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">
          Available data: {minDate} → {maxDate}
        </p>
      )}
    </div>
  );
}
