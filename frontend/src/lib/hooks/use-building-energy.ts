import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, toSearchParams, type BuildingEnergyPoint } from "@/lib/api";

export type BuildingEnergyParams = {
  from?: string;
  to?: string;
  bucket?: "15min" | "1h";
};

/** Live (30s refetch); keeps previous data visible while paging dates. */
export function useBuildingEnergy(params: BuildingEnergyParams = {}) {
  const { data: session } = useSession();
  const token = session?.accessToken ?? null;

  return useQuery<BuildingEnergyPoint[]>({
    queryKey: ["building-energy", params],
    queryFn: ({ signal }) => {
      const path = `/api/building/energy/${toSearchParams(params)}`;
      return apiFetch<BuildingEnergyPoint[]>(path, { token, signal });
    },
    enabled: !!token,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}
