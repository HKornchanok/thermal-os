import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, toSearchParams, type ZoneEnergyPoint } from "@/lib/api";

export type BuildingEnergyByZoneParams = {
  from?: string;
  to?: string;
  bucket?: "15min" | "1h";
};

/**
 * Pivoted server-side: `{ bucket, "Zone A (...)": 32.4, ... }`. Live
 * (30s refetch); keepPreviousData smooths Total ↔ By Zone toggles.
 */
export function useBuildingEnergyByZone(
  params: BuildingEnergyByZoneParams = {}
) {
  const { data: session } = useSession();
  const token = session?.accessToken ?? null;

  return useQuery<ZoneEnergyPoint[]>({
    queryKey: ["building-energy-by-zone", params],
    queryFn: ({ signal }) => {
      const path = `/api/building/energy/by-zone/${toSearchParams(params)}`;
      return apiFetch<ZoneEnergyPoint[]>(path, { token, signal });
    },
    enabled: !!token,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}
