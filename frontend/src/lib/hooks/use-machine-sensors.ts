import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, toSearchParams, type SensorSeriesPoint } from "@/lib/api";

export type MachineMetric =
  | "power_kw"
  | "temperature"
  | "setpoint"
  | "speed_pct";
export type MachineSensorBucket = "5min" | "15min" | "1h" | "1d";

export type MachineSensorsParams = {
  machineId: number;
  metric?: MachineMetric;
  bucket?: MachineSensorBucket;
  from?: string;
  to?: string;
};

/**
 * Time-bucketed sensor readings for a single machine.
 *
 * Server-side smart defaults:
 *   - metric defaults to "power_kw"
 *   - bucket defaults to "5min"
 *   - from / to default to the day of MAX(recorded_at) for that machine
 *     (chart always has data on first load even if the seed is older
 *      than the wall clock)
 *
 * `keepPreviousData` keeps the previous metric / bucket visible while the
 * new request is in flight, so toggling Tabs doesn't blank the chart.
 * `enabled` gates on a non-zero machineId so the hook is no-op until the
 * user picks a machine in the grid.
 */
export function useMachineSensors({
  machineId,
  metric,
  bucket,
  from,
  to,
}: MachineSensorsParams) {
  const { data: session } = useSession();
  const token = session?.accessToken ?? null;

  return useQuery<SensorSeriesPoint[]>({
    queryKey: ["machine-sensors", { machineId, metric, bucket, from, to }],
    queryFn: ({ signal }) => {
      const path = `/api/machines/${machineId}/sensors/${toSearchParams({
        metric,
        bucket,
        from,
        to,
      })}`;
      return apiFetch<SensorSeriesPoint[]>(path, { token, signal });
    },
    enabled: !!token && machineId > 0,
    placeholderData: keepPreviousData,
  });
}
