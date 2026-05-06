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

/**
 * Merge two time-aligned-by-index energy series into chart rows. Period
 * lengths can differ; rows pad the shorter side with `undefined` so the
 * line just stops rather than wrapping back. X axis is "hour offset
 * from each period's start", which lets the curves overlay despite
 * different absolute timestamps.
 */
type CompareRow = {
  offsetHours: number;
  // Index signature instead of computed-key types — TypeScript treats
  // `[SERIES_BEFORE]?: number` in a type body as a property whose key
  // happens to be the literal "Before AI" only because the const is
  // narrowly inferred. Switching to an explicit string-indexed shape
  // makes the contract obvious to readers and to `noUncheckedIndexedAccess`.
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
  // Local state — empty strings let the server pick smart defaults
  // (split the seed window in half).
  const [aFrom, setAFrom] = useState("");
  const [aTo, setATo] = useState("");
  const [bFrom, setBFrom] = useState("");
  const [bTo, setBTo] = useState("");

  // Memoise the params object so the underlying useQuery's `queryKey`
  // identity only changes when an input changes — without this, a fresh
  // object literal on every render forces TanStack to recompute / re-key
  // the entry on each unrelated parent re-render.
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
      aTo: minDateStr(shiftDay(periodARange.min, 2), periodARange.max),
      bFrom: periodBRange.min,
      bTo: minDateStr(shiftDay(periodBRange.min, 2), periodBRange.max),
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
  // overlay them as lines. Use the server-resolved ISO boundaries
  // (compare.before/after.from/to) rather than the raw inputs so the
  // chart matches the KPI numbers exactly even when defaults are in play.
  // Both params memoised — same identity-stability concern as compareParams.
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
              series={[
                // Before AI = yellow (manual era), After AI = green (AI era).
                // Pinning explicitly so the colours track the narrative
                // ("AI is the green one") regardless of where these series
                // happen to sit in the default palette order.
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

/**
 * Custom Recharts tooltip for /compare. Adds a "Diff" footer row that
 * shows the savings (or regression) between the Before AI and After AI
 * series at the hovered hour — the whole point of this page is the
 * delta, so making the user mentally subtract two numbers is bad UX.
 *
 * Returns null when the cursor isn't active or either series has no
 * value at this offset (the periods can have different lengths; one
 * line stops sooner than the other).
 */
function CompareDiffTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const beforeRow = payload.find((p) => p.name === SERIES_BEFORE);
  const afterRow = payload.find((p) => p.name === SERIES_AFTER);
  const before = typeof beforeRow?.value === "number" ? beforeRow.value : null;
  const after = typeof afterRow?.value === "number" ? afterRow.value : null;

  // Header label — same translation as the page intro: "Day N, h+M".
  const hours = typeof label === "number" ? label : Number(label);
  const headerText = Number.isFinite(hours)
    ? hours >= 24
      ? `Day ${Math.floor(hours / 24) + 1}, h+${hours % 24}`
      : `h+${hours}`
    : String(label);

  // Diff is signed: AFTER − BEFORE. Negative ⇒ AI uses less ⇒ savings.
  const diff = before !== null && after !== null ? after - before : null;
  const pct =
    diff !== null && before && before > 0 ? (diff / before) * 100 : null;

  // Match the existing Recharts tooltip's surface styling — it normally
  // comes from CHART_TOOLTIP_CONTENT_STYLE on the wrapping <Tooltip>;
  // since `content` overrides the default body, we re-create the surface
  // here with Tailwind so light/dark theming + radius match.
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
