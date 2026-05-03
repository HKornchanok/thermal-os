import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, type ZoneEnergyPoint } from "@/lib/api";

export type BuildingEnergyByZoneParams = {
  /** ISO 8601. Server defaults to `to` − 24 hours. */
  from?: string;
  /** ISO 8601. Server defaults to MAX(recorded_at). */
  to?: string;
  /** Backend allowlist: 15min | 1h. Defaults server-side to 1h. */
  bucket?: "15min" | "1h";
};

/**
 * Building power broken down by zone, pivoted server-side. Each row is
 *   { bucket: "<iso>", "Zone A (...)": 32.4, "Zone B (...)": 28.1, ... }
 * with one key per zone. The set of zone keys is stable across the
 * window — see /api/building/energy/by-zone/ implementation.
 *
 * Backed-by-30s refetchInterval like the Total view; keepPreviousData
 * keeps the visual stable when toggling Total ↔ By Zone or stepping
 * the date.
 */
export function useBuildingEnergyByZone(
  params: BuildingEnergyByZoneParams = {}
) {
  const { data: session } = useSession();
  const token = session?.accessToken ?? null;

  return useQuery<ZoneEnergyPoint[]>({
    queryKey: ["building-energy-by-zone", params],
    queryFn: ({ signal }) => {
      const sp = new URLSearchParams();
      if (params.from) sp.set("from", params.from);
      if (params.to) sp.set("to", params.to);
      if (params.bucket) sp.set("bucket", params.bucket);
      const path = `/api/building/energy/by-zone/${
        sp.toString() ? `?${sp}` : ""
      }`;
      return apiFetch<ZoneEnergyPoint[]>(path, { token, signal });
    },
    enabled: !!token,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}
