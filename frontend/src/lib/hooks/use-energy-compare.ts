import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, toSearchParams, type EnergyCompare } from "@/lib/api";

export type EnergyCompareParams = {
  a_from?: string;
  a_to?: string;
  b_from?: string;
  b_to?: string;
};

/** Server fills missing params from MIN/MAX(recorded_at) split at midpoint. */
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
