import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AreaChart, type AreaSeries } from "@/components/dashboard/area-chart";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { ErrorState, LoadingState } from "@/components/dashboard/states";
import {
  colorForSeriesIndex,
  formatBucketLabel,
  formatBucketTime,
} from "@/lib/chart";
import {
  dayEndIso,
  dayStartIso,
  formatDayLabel,
  shiftDay,
  todayLocal,
} from "@/lib/dates";
import { useBuildingEnergy } from "@/lib/hooks/use-building-energy";
import { useBuildingEnergyByZone } from "@/lib/hooks/use-building-energy-by-zone";
import { cn, fmtNum } from "@/lib/utils";

const BUCKET_OPTIONS = [
  { value: "1h", label: "1 hour" },
  { value: "15min", label: "15 min" },
] as const;

const VIEW_OPTIONS = [
  { value: "total", label: "Total" },
  { value: "by_zone", label: "By zone" },
] as const;

type View = (typeof VIEW_OPTIONS)[number]["value"];

export default function EnergyPage() {
  // Empty `day` means "let the server pick the default range" — also
  // avoids a hydration mismatch from a Date.now()-derived initial state.
  const [day, setDay] = useState<string>("");
  const [bucket, setBucket] = useState<"15min" | "1h">("1h");
  const [view, setView] = useState<View>("total");
  // Storing the exclusion set (vs inclusion) means the default "show all"
  // doesn't need the zone names to be known at state-init time.
  const [hiddenZones, setHiddenZones] = useState<Set<string>>(new Set());

  const params = useMemo(
    () =>
      day ? { from: dayStartIso(day), to: dayEndIso(day), bucket } : { bucket },
    [day, bucket]
  );

  // Fire both unconditionally so toggling Total ↔ By Zone is instant.
  const totalQuery = useBuildingEnergy(params);
  const zoneQuery = useBuildingEnergyByZone(params);

  const active = view === "total" ? totalQuery : zoneQuery;
  const { isLoading, isError, error, isFetching } = active;

  const totalPoints = totalQuery.data ?? [];
  const zonePoints = zoneQuery.data ?? [];

  // Backend pivots with a stable shape (every row carries every zone).
  const zoneKeys = useMemo(() => {
    if (zonePoints.length === 0) return [] as string[];
    return Object.keys(zonePoints[0]).filter((k) => k !== "bucket");
  }, [zonePoints]);

  // Pin each zone's colour by ORIGINAL index so the hue stays stable
  // when other zones are toggled off (legend ↔ chart wouldn't drift).
  const allZoneSeries: AreaSeries[] = useMemo(
    () =>
      zoneKeys.map((zone, i) => ({
        key: zone,
        name: zone,
        color: colorForSeriesIndex(i),
      })),
    [zoneKeys]
  );

  const visibleZoneSeries = useMemo(
    () => allZoneSeries.filter((s) => !hiddenZones.has(s.key)),
    [allZoneSeries, hiddenZones]
  );

  const toggleZone = (zone: string) => {
    setHiddenZones((prev) => {
      const next = new Set(prev);
      if (next.has(zone)) next.delete(zone);
      else next.add(zone);
      return next;
    });
  };

  // Stats follow the active view; by-zone sums to total per bucket so
  // numbers stay identical when toggling.
  const statValues = useMemo(() => {
    if (view === "total") return totalPoints.map((p) => p.total_kw);
    return zonePoints.map((p) =>
      Object.entries(p)
        .filter(([k]) => k !== "bucket")
        .reduce((sum, [, v]) => sum + (typeof v === "number" ? v : 0), 0)
    );
  }, [view, totalPoints, zonePoints]);

  const peak = statValues.length ? Math.max(...statValues) : 0;
  const avg = statValues.length
    ? statValues.reduce((s, v) => s + v, 0) / statValues.length
    : 0;
  const count = statValues.length;

  // Captured once from the initial Total response and pinned thereafter.
  const [latestDataDay, setLatestDataDay] = useState<string>("");
  useEffect(() => {
    if (!day && !latestDataDay && totalPoints.length > 0) {
      setLatestDataDay(totalPoints[totalPoints.length - 1].bucket.slice(0, 10));
    }
  }, [day, latestDataDay, totalPoints]);

  const goPrev = () => {
    const anchor = day || latestDataDay || todayLocal();
    setDay(shiftDay(anchor, -1));
  };

  const goNext = () => {
    if (!day) return;
    const next = shiftDay(day, 1);
    const cap = latestDataDay || todayLocal();
    if (next > cap) return;
    setDay(next);
  };

  const canGoForward = !!day && day < (latestDataDay || todayLocal());

  return (
    <>
      <Head>
        <title>Energy · ThermalOS</title>
      </Head>

      <div className="flex items-baseline justify-between gap-4">
        <h1 className="mt-0 text-2xl font-semibold">Energy</h1>
        <p className="text-xs text-muted-foreground">Building-wide power</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            data-testid="energy-prev-day"
            variant="outline"
            size="sm"
            onClick={goPrev}
          >
            <ChevronLeft className="size-3" aria-hidden />
            Prev day
          </Button>
          <div
            data-testid="energy-day-label"
            className="min-w-[10rem] text-center text-sm font-medium"
          >
            {day ? formatDayLabel(day) : "Last 24 hours"}
          </div>
          <Button
            data-testid="energy-next-day"
            variant="outline"
            size="sm"
            disabled={!canGoForward}
            onClick={goNext}
          >
            Next day
            <ChevronRight className="size-3" aria-hidden />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SegmentedToggle
            options={VIEW_OPTIONS}
            value={view}
            onChange={(v) => setView(v as View)}
            testIdPrefix="energy-view"
          />
          <SegmentedToggle
            options={BUCKET_OPTIONS}
            value={bucket}
            onChange={(v) => setBucket(v as "15min" | "1h")}
            testIdPrefix="energy-bucket"
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <KpiCard
          label="Peak"
          value={`${fmtNum(peak)} kW`}
          testId="energy-peak"
        />
        <KpiCard
          label="Average"
          value={`${fmtNum(avg)} kW`}
          testId="energy-avg"
        />
        <KpiCard
          label="Data points"
          value={count.toLocaleString()}
          testId="energy-count"
        />
      </div>

      {view === "by_zone" && allZoneSeries.length > 0 && (
        <ZoneLegend
          series={allZoneSeries}
          hiddenZones={hiddenZones}
          onToggle={toggleZone}
          onShowAll={() => setHiddenZones(new Set())}
          onHideAll={() =>
            setHiddenZones(new Set(allZoneSeries.map((s) => s.key)))
          }
        />
      )}

      <div className="mt-4 rounded-lg border border-border bg-card p-4 text-card-foreground">
        {isLoading ? (
          <LoadingState
            message="Loading energy data…"
            testId="energy-loading"
          />
        ) : isError ? (
          <ErrorState
            message={`Failed to load energy data: ${
              error instanceof Error ? error.message : "unknown error"
            }`}
            testId="energy-error"
          />
        ) : count === 0 ? (
          <p
            className="p-6 text-center text-sm text-muted-foreground"
            data-testid="energy-empty"
          >
            No data {day ? `for ${formatDayLabel(day)}` : "in range"}.
          </p>
        ) : (
          <>
            {view === "total" ? (
              <AreaChart
                data={totalPoints}
                xKey="bucket"
                series={[{ key: "total_kw", name: "Total" }]}
                xTickFormatter={(v) => formatBucketTime(v as string)}
                yTickFormatter={(v) => `${fmtNum(v as number, 0)} kW`}
                tooltipLabelFormatter={(v) => formatBucketLabel(v as string)}
                tooltipFormatter={(v) => [`${fmtNum(v as number)} kW`, "Total"]}
              />
            ) : visibleZoneSeries.length === 0 ? (
              <p
                className="p-6 text-center text-sm text-muted-foreground"
                data-testid="energy-no-zones"
              >
                No zones selected. Tick at least one in the legend above.
              </p>
            ) : (
              <AreaChart
                data={zonePoints}
                xKey="bucket"
                series={visibleZoneSeries}
                stacked
                xTickFormatter={(v) => formatBucketTime(v as string)}
                yTickFormatter={(v) => `${fmtNum(v as number, 0)} kW`}
                tooltipLabelFormatter={(v) => formatBucketLabel(v as string)}
                tooltipFormatter={(v, name) => [
                  `${fmtNum(v as number)} kW`,
                  name,
                ]}
              />
            )}
            {isFetching && !isLoading && (
              <div className="mt-2 flex justify-end">
                <span
                  className="inline-flex items-center gap-1.5 text-xs leading-none text-muted-foreground"
                  role="status"
                  aria-live="polite"
                  data-testid="energy-refreshing"
                >
                  <Loader2
                    className="size-3 shrink-0 animate-spin"
                    aria-hidden
                  />
                  <span>Refreshing</span>
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/**
 * Small button-group toggle used for the View (Total/By zone) and
 * Bucket (1h/15min) selectors. Active option uses the primary
 * background; inactive options have a hover.
 */
function ZoneLegend({
  series,
  hiddenZones,
  onToggle,
  onShowAll,
  onHideAll,
}: {
  series: AreaSeries[];
  hiddenZones: Set<string>;
  onToggle: (zone: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}) {
  const allHidden = hiddenZones.size === series.length;
  const allVisible = hiddenZones.size === 0;

  return (
    <div className="mt-4 rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Zones ({series.length - hiddenZones.size}/{series.length})
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onShowAll}
            disabled={allVisible}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:no-underline disabled:opacity-40"
            data-testid="energy-zone-show-all"
          >
            Show all
          </button>
          <span className="text-xs text-muted-foreground">·</span>
          <button
            type="button"
            onClick={onHideAll}
            disabled={allHidden}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:no-underline disabled:opacity-40"
            data-testid="energy-zone-hide-all"
          >
            Hide all
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 md:grid-cols-4">
        {series.map((s) => {
          const checked = !hiddenZones.has(s.key);
          return (
            <label
              key={s.key}
              className={cn(
                "flex cursor-pointer select-none items-center gap-2 text-xs transition-opacity",
                !checked && "opacity-50"
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(s.key)}
                className="size-3.5 cursor-pointer accent-primary"
                data-testid={`energy-zone-${s.key.replace(/\s+/g, "-")}`}
              />
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ background: s.color }}
                aria-hidden
              />
              <span>{s.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  testIdPrefix,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  testIdPrefix?: string;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          data-testid={
            testIdPrefix ? `${testIdPrefix}-${opt.value}` : undefined
          }
          type="button"
          onClick={() => onChange(opt.value)}
          className={
            value === opt.value
              ? "rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
              : "rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
