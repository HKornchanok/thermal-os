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

/** keepPreviousData smooths metric-tab toggles; gated on a non-zero id. */
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
