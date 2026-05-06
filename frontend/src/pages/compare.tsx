import Head from "next/head";
import { useEffect, useMemo, useState } from "react";

import {
  AreaChart,
  type ChartTooltipProps,
} from "@/components/dashboard/area-chart";
import { ErrorState, LoadingState } from "@/components/dashboard/states";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Button } from "@/components/ui/button";
import { colorForSeriesIndex } from "@/lib/chart";
import {
  inputDateToIso,
  isoToLocalDate,
  minDateStr,
  shiftDay,
} from "@/lib/dates";
import { useBuildingEnergy } from "@/lib/hooks/use-building-energy";
import { useEnergyCompare } from "@/lib/hooks/use-energy-compare";
import { cn, fmtNum } from "@/lib/utils";

const SERIES_BEFORE = "Before AI";
const SERIES_AFTER = "After AI";

// Periods can differ in length; the shorter series pads with undefined
// so the line stops rather than wrapping back to row 0.
type CompareRow = {
  offsetHours: number;
  [seriesName: string]: number | undefined;
};

function mergeAlignedByHour(
  before: { bucket: string; total_kw: number }[] | undefined,
  after: { bucket: string; total_kw: number }[] | undefined
): CompareRow[] {
  const len = Math.max(before?.length ?? 0, after?.length ?? 0);
  const rows: CompareRow[] = [];
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
  const [aFrom, setAFrom] = useState("");
  const [aTo, setATo] = useState("");
  const [bFrom, setBFrom] = useState("");
  const [bTo, setBTo] = useState("");

  // Memoised so the queryKey doesn't churn on every parent re-render.
  const compareParams = useMemo(
    () => ({
      a_from: inputDateToIso(aFrom),
      a_to: inputDateToIso(aTo, true),
      b_from: inputDateToIso(bFrom),
      b_to: inputDateToIso(bTo, true),
    }),
    [aFrom, aTo, bFrom, bTo]
  );
  const compareQuery = useEnergyCompare(compareParams);
  const compare = compareQuery.data;

  // Bound each picker to its own half of the seed window — without this,
  // a Period A date inside the AI window would silently stop being a
  // manual-vs-AI comparison.
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

  // First 3 manual days vs first 3 AI days — equal-length windows so the
  // savings_pct delta isn't skewed by period length.
  const defaults = useMemo(() => {
    if (!periodARange || !periodBRange) return null;
    return {
      aFrom: periodARange.min,
      aTo: minDateStr(shiftDay(periodARange.min, 2), periodARange.max),
      bFrom: periodBRange.min,
      bTo: minDateStr(shiftDay(periodBRange.min, 2), periodBRange.max),
    };
  }, [periodARange, periodBRange]);

  // Populate the inputs with defaults once compare resolves. Gated on
  // `initialised` so user picks survive a compare-refetch.
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

  // Use server-resolved boundaries so the chart matches the KPI numbers
  // exactly even when the inputs are still empty.
  const beforeParams = useMemo(
    () =>
      compare?.before
        ? {
            from: compare.before.from,
            to: compare.before.to,
            bucket: "1h" as const,
          }
        : {},
    [compare?.before]
  );
  const afterParams = useMemo(
    () =>
      compare?.after
        ? {
            from: compare.after.from,
            to: compare.after.to,
            bucket: "1h" as const,
          }
        : {},
    [compare?.after]
  );
  const beforeQuery = useBuildingEnergy(beforeParams);
  const afterQuery = useBuildingEnergy(afterParams);

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
              series={[
                // Yellow = manual era, green = AI era.
                { key: SERIES_BEFORE, color: "var(--chart-2)" },
                { key: SERIES_AFTER, color: "var(--chart-1)" },
              ]}
              xTickFormatter={(v) => `${v}h`}
              yTickFormatter={(v) => `${fmtNum(v as number, 0)} kW`}
              tooltipContent={CompareDiffTooltip}
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
  minDate?: string;
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

function CompareDiffTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const beforeRow = payload.find((p) => p.name === SERIES_BEFORE);
  const afterRow = payload.find((p) => p.name === SERIES_AFTER);
  const before = typeof beforeRow?.value === "number" ? beforeRow.value : null;
  const after = typeof afterRow?.value === "number" ? afterRow.value : null;

  const hours = typeof label === "number" ? label : Number(label);
  const headerText = Number.isFinite(hours)
    ? hours >= 24
      ? `Day ${Math.floor(hours / 24) + 1}, h+${hours % 24}`
      : `h+${hours}`
    : String(label);

  // After − Before: negative ⇒ AI saves ⇒ green text.
  const diff = before !== null && after !== null ? after - before : null;
  const pct =
    diff !== null && before && before > 0 ? (diff / before) * 100 : null;

  return (
    <div
      className="rounded border border-border bg-card px-2.5 py-2 font-mono text-xs text-foreground shadow-sm"
      role="status"
    >
      <p className="mb-1 font-semibold">{headerText}</p>
      <div className="flex flex-col gap-0.5">
        <Row
          name={SERIES_BEFORE}
          value={before}
          color={beforeRow?.color ?? colorForSeriesIndex(0)}
        />
        <Row
          name={SERIES_AFTER}
          value={after}
          color={afterRow?.color ?? colorForSeriesIndex(1)}
        />
      </div>
      {diff !== null && (
        <div className="mt-1.5 border-t border-border pt-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Diff</span>
            <span
              className={cn(
                "font-semibold",
                diff < 0
                  ? "text-primary"
                  : diff > 0
                    ? "text-destructive"
                    : "text-foreground"
              )}
            >
              {diff > 0 ? "+" : diff < 0 ? "−" : ""}
              {fmtNum(Math.abs(diff))} kW
              {pct !== null
                ? ` (${diff > 0 ? "+" : diff < 0 ? "−" : ""}${Math.abs(pct).toFixed(1)}%)`
                : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  name,
  value,
  color,
}: {
  name: string;
  value: number | null;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block size-2 rounded-sm"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        {name}
      </span>
      <span>{value !== null ? `${fmtNum(value)} kW` : "—"}</span>
    </div>
  );
}
