import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, toSearchParams, type EnergyCompare } from "@/lib/api";

export type EnergyCompareParams = {
  /** Period A (typically "before AI"). All four params optional. */
  a_from?: string;
  a_to?: string;
  /** Period B (typically "after AI"). */
  b_from?: string;
  b_to?: string;
};

/**
 * Average building power for two periods plus savings_pct.
 *
 * When all four params are omitted the server fills them from
 * MIN/MAX(recorded_at): Period A = [min, midpoint), Period B =
 * [midpoint, max]. Callers can override any subset.
 *
 * keepPreviousData smooths the chart while the user steps the date
 * inputs; staleTime is the default (60s from QueryClient) since this
 * is a slow-moving comparison, not a live dashboard.
 */
export function useEnergyCompare(params: EnergyCompareParams = {}) {
  const { data: session } = useSession();
  const token = session?.accessToken ?? null;

  return useQuery<EnergyCompare>({
    queryKey: ["energy-compare", params],
    queryFn: ({ signal }) => {
      const path = `/api/energy/compare/${toSearchParams(params)}`;
      return apiFetch<EnergyCompare>(path, { token, signal });
    },
    enabled: !!token,
    placeholderData: keepPreviousData,
  });
}
