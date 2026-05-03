import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, type BuildingEnergyPoint } from "@/lib/api";

export type BuildingEnergyParams = {
  /** ISO 8601. Server defaults to `to` − 24 hours. */
  from?: string;
  /** ISO 8601. Server defaults to MAX(recorded_at). */
  to?: string;
  /** Backend allowlist: 15min | 1h. Defaults server-side to 1h. */
  bucket?: "15min" | "1h";
};

/**
 * Building-wide power timeseries.
 *
 * Lives on the Energy page, which is a "live" view — refetchInterval is
 * set to 30s per DESIGN.md §1C. keepPreviousData keeps the previous
 * window visible while paging the date back/forward, so the area
 * chart doesn't flash empty between requests.
 */
export function useBuildingEnergy(params: BuildingEnergyParams = {}) {
  const { data: session } = useSession();
  const token = session?.accessToken ?? null;

  return useQuery<BuildingEnergyPoint[]>({
    queryKey: ["building-energy", params],
    queryFn: ({ signal }) => {
      const sp = new URLSearchParams();
      if (params.from) sp.set("from", params.from);
      if (params.to) sp.set("to", params.to);
      if (params.bucket) sp.set("bucket", params.bucket);
      const path = `/api/building/energy/${sp.toString() ? `?${sp}` : ""}`;
      return apiFetch<BuildingEnergyPoint[]>(path, { token, signal });
    },
    enabled: !!token,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}
