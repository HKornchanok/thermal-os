import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AreaChart } from "@/components/dashboard/area-chart";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { ErrorState, LoadingState } from "@/components/dashboard/states";
import { formatBucketLabel, formatBucketTime } from "@/lib/chart";
import { useBuildingEnergy } from "@/lib/hooks/use-building-energy";

const BUCKET_OPTIONS = [
  { value: "1h", label: "1 hour" },
  { value: "15min", label: "15 min" },
] as const;

/** YYYY-MM-DD in the browser's local zone, suitable for `<input type=date>` and ISO conversion. */
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftDay(yyyyMmDd: string, deltaDays: number): string {
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayStartIso(yyyyMmDd: string): string {
  return new Date(`${yyyyMmDd}T00:00:00`).toISOString();
}

function dayEndIso(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function formatDayLabel(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export default function EnergyPage() {
  // `day` is the user's explicit selection. Empty means "show the
  // backend's default range" (last 24h anchored to MAX(recorded_at)) — a
  // sensible first-load view that doesn't depend on the client's
  // wall-clock date matching the seed's data window. Initialising empty
  // also avoids the SSR / hydration mismatch a `Date.now()`-derived
  // initial state would cause.
  const [day, setDay] = useState<string>("");
  const [bucket, setBucket] = useState<"15min" | "1h">("1h");

  const params = useMemo(
    () =>
      day
        ? { from: dayStartIso(day), to: dayEndIso(day), bucket }
        : { bucket },
    [day, bucket]
  );

  const { data, isLoading, isError, error, isFetching } = useBuildingEnergy(params);

  const points = data ?? [];

  // Summary stats over the visible range.
  const peak = points.length ? Math.max(...points.map((p) => p.total_kw)) : 0;
  const avg = points.length
    ? points.reduce((s, p) => s + p.total_kw, 0) / points.length
    : 0;

  // Latest day for which the backend has data. Captured ONCE from the
  // initial "no params" response (which the backend anchors to its own
  // MAX(recorded_at)). After that we keep it pinned, otherwise navigating
  // to e.g. Apr 29 would shrink latestDataDay to Apr 29 (the only date in
  // the new response) and the Next-day button would be wrongly disabled.
  const [latestDataDay, setLatestDataDay] = useState<string>("");
  useEffect(() => {
    if (!day && !latestDataDay && points.length > 0) {
      setLatestDataDay(points[points.length - 1].bucket.slice(0, 10));
    }
  }, [day, latestDataDay, points]);

  const goPrev = () => {
    const anchor = day || latestDataDay || todayLocal();
    setDay(shiftDay(anchor, -1));
  };

  const goNext = () => {
    if (!day) return;
    const next = shiftDay(day, 1);
    // Don't shift past the latest data day; if we don't know it (e.g.
    // first response was empty), allow up to today.
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

        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {BUCKET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              data-testid={`energy-bucket-${opt.value}`}
              type="button"
              onClick={() => setBucket(opt.value)}
              className={
                bucket === opt.value
                  ? "rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground"
                  : "rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <KpiCard label="Peak" value={`${peak.toFixed(1)} kW`} testId="energy-peak" />
        <KpiCard label="Average" value={`${avg.toFixed(1)} kW`} testId="energy-avg" />
        <KpiCard
          label="Data points"
          value={points.length.toLocaleString()}
          testId="energy-count"
        />
      </div>

      <div className="mt-4 rounded-lg border border-border bg-card p-4 text-card-foreground">
        {isLoading ? (
          <LoadingState message="Loading energy data…" testId="energy-loading" />
        ) : isError ? (
          <ErrorState
            message={`Failed to load energy data: ${
              error instanceof Error ? error.message : "unknown error"
            }`}
            testId="energy-error"
          />
        ) : points.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground" data-testid="energy-empty">
            No data {day ? `for ${formatDayLabel(day)}` : "in range"}.
          </p>
        ) : (
          <>
            <AreaChart
              data={points}
              xKey="bucket"
              series={[{ key: "total_kw", name: "Total" }]}
              xTickFormatter={(v) => formatBucketTime(v as string)}
              yTickFormatter={(v) => `${(v as number).toFixed(0)} kW`}
              tooltipLabelFormatter={(v) => formatBucketLabel(v as string)}
              tooltipFormatter={(v) => [
                `${(v as number).toFixed(1)} kW`,
                "Total",
              ]}
            />
            {isFetching && !isLoading && (
              <div className="mt-2 flex justify-end">
                <span
                  className="inline-flex items-center gap-1.5 text-xs leading-none text-muted-foreground"
                  role="status"
                  aria-live="polite"
                  data-testid="energy-refreshing"
                >
                  <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
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
