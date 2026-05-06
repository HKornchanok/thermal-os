import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";

import { AreaChart } from "@/components/dashboard/area-chart";
import { ErrorState, LoadingState } from "@/components/dashboard/states";
import { MachineCard } from "@/components/dashboard/machine-card";
import { QueryStateRenderer } from "@/components/dashboard/query-state";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBucketLabel, formatBucketTime } from "@/lib/chart";
import { useMachines } from "@/lib/hooks/use-machines";
import {
  type MachineMetric,
  useMachineSensors,
} from "@/lib/hooks/use-machine-sensors";
import type { Machine } from "@/lib/api";

const ALL_METRICS: { value: MachineMetric; label: string }[] = [
  { value: "power_kw", label: "Power" },
  { value: "temperature", label: "Temperature" },
  { value: "setpoint", label: "Setpoint" },
  { value: "speed_pct", label: "Speed" },
];

function metricsForMachine(machine: Machine | undefined): MachineMetric[] {
  if (!machine) return ["power_kw"];
  if (machine.machine_type === "fan") return ["power_kw", "speed_pct"];
  return ["power_kw", "temperature", "setpoint"];
}

const METRIC_UNITS: Record<MachineMetric, string> = {
  power_kw: "kW",
  temperature: "°C",
  setpoint: "°C",
  speed_pct: "%",
};

export default function MachinesPage() {
  const router = useRouter();
  const machinesQuery = useMachines();
  const machines = machinesQuery.data ?? [];

  // Selection lives in `?selected=<id>` so alerts can deep-link in.
  const selectedId = useMemo<number | null>(() => {
    const v = router.query.selected;
    const raw = Array.isArray(v) ? v[0] : v;
    const n = Number(raw);
    return raw && Number.isFinite(n) && n > 0 ? n : null;
  }, [router.query.selected]);

  const select = (id: number) => {
    router.replace(
      { pathname: router.pathname, query: { ...router.query, selected: id } },
      undefined,
      { shallow: true }
    );
  };

  const selectedMachine =
    selectedId != null ? machines.find((m) => m.id === selectedId) : undefined;

  const allowedMetrics = metricsForMachine(selectedMachine);
  const [metric, setMetric] = useState<MachineMetric>("power_kw");

  // Reset metric on machine-type change. Compute inside the effect so
  // we don't close over a stale `allowedMetrics`.
  useEffect(() => {
    if (!selectedMachine) return;
    const nextAllowed = metricsForMachine(selectedMachine);
    setMetric((current) =>
      nextAllowed.includes(current) ? current : (nextAllowed[0] ?? "power_kw")
    );
  }, [selectedMachine?.id, selectedMachine?.machine_type]);

  // Last 24h sliding from browser NOW; refreshes on machine change,
  // stable across metric-tab switches.
  const { fromIso, toIso } = useMemo(() => {
    const now = Date.now();
    return {
      toIso: new Date(now).toISOString(),
      fromIso: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    };
  }, [selectedId]);

  const sensorsQuery = useMachineSensors({
    machineId: selectedId ?? 0,
    metric,
    bucket: "5min",
    from: fromIso,
    to: toIso,
  });
  const sensorPoints = sensorsQuery.data ?? [];

  // 288 5-min ticks crowd the X axis — keep only the on-the-hour ones.
  const hourlyTicks = useMemo(
    () =>
      sensorPoints
        .map((p) => p.bucket)
        .filter((iso) => new Date(iso).getMinutes() === 0),
    [sensorPoints]
  );

  // Recharts uses a categorical X axis here, so ReferenceLine `x={...}`
  // only positions correctly when the value matches a real bucket. Snap
  // to the nearest bucket at-or-before NOW (a future bucket would draw
  // the line ahead of the actual data).
  const nowBucketIso = useMemo(() => {
    if (sensorPoints.length === 0) return undefined;
    const now = Date.now();
    let best: string | undefined;
    let bestDelta = Infinity;
    for (const p of sensorPoints) {
      const ts = new Date(p.bucket).getTime();
      if (ts > now) continue;
      const delta = now - ts;
      if (delta < bestDelta) {
        best = p.bucket;
        bestDelta = delta;
      }
    }
    return best ?? sensorPoints[0].bucket;
  }, [sensorPoints]);

  return (
    <>
      <Head>
        <title>Machines · ThermalOS</title>
      </Head>

      <div className="flex items-baseline justify-between gap-4">
        <h1 className="mt-0 text-2xl font-semibold">Machines</h1>
        <p className="text-xs text-muted-foreground">
          {machines.length || "…"} machines
        </p>
      </div>

      <section className="mt-4">
        <QueryStateRenderer
          query={machinesQuery}
          loadingMessage="Loading machines…"
          errorPrefix="Failed to load machines"
          loadingTestId="machines-loading"
          errorTestId="machines-error"
        >
          {(machines) => (
            <div
              data-testid="machines-grid"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
            >
              {machines.map((m) => (
                <MachineCard
                  key={m.id}
                  machine={m}
                  selected={selectedId === m.id}
                  onClick={() => select(m.id)}
                />
              ))}
            </div>
          )}
        </QueryStateRenderer>
      </section>

      {selectedMachine && (
        <section
          className="mt-6 rounded-lg border border-border bg-card p-4 text-card-foreground"
          data-testid="machine-detail"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="m-0 font-mono text-lg font-semibold">
                {selectedMachine.name}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {selectedMachine.zone} ·{" "}
                {selectedMachine.machine_type.replace("_", " ")}
              </p>
            </div>
            {selectedMachine.latest_reading && (
              <StatusBadge status={selectedMachine.latest_reading.status} />
            )}
          </div>

          <div className="mt-4">
            <Tabs
              value={metric}
              onValueChange={(v) => setMetric(v as MachineMetric)}
            >
              <TabsList>
                {ALL_METRICS.map((opt) => {
                  const enabled = allowedMetrics.includes(opt.value);
                  return (
                    <TabsTrigger
                      key={opt.value}
                      value={opt.value}
                      disabled={!enabled}
                      data-testid={`machine-metric-${opt.value}`}
                    >
                      {opt.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </div>

          <div className="mt-4">
            {sensorsQuery.isLoading ? (
              <LoadingState
                message="Loading sensor data…"
                testId="sensors-loading"
              />
            ) : sensorsQuery.isError ? (
              <ErrorState
                message={`Failed to load sensors: ${
                  sensorsQuery.error instanceof Error
                    ? sensorsQuery.error.message
                    : "unknown error"
                }`}
                testId="sensors-error"
              />
            ) : sensorPoints.length === 0 ? (
              <p
                className="p-6 text-center text-sm text-muted-foreground"
                data-testid="sensors-empty"
              >
                No data for {ALL_METRICS.find((m) => m.value === metric)?.label}
                .
              </p>
            ) : (
              <AreaChart
                data={sensorPoints}
                xKey="bucket"
                series={[
                  {
                    key: "value",
                    name:
                      ALL_METRICS.find((m) => m.value === metric)?.label ??
                      metric,
                  },
                ]}
                xTicks={hourlyTicks}
                nowLine={nowBucketIso}
                xTickFormatter={(v) => formatBucketTime(v as string)}
                yTickFormatter={(v) =>
                  `${(v as number).toFixed(metric === "power_kw" ? 0 : 1)}${
                    METRIC_UNITS[metric]
                  }`
                }
                tooltipLabelFormatter={(v) => formatBucketLabel(v as string)}
                tooltipFormatter={(v, name) => [
                  `${(v as number).toFixed(2)} ${METRIC_UNITS[metric]}`,
                  name,
                ]}
              />
            )}
          </div>
        </section>
      )}
    </>
  );
}
