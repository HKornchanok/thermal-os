import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, type BuildingSummary } from "@/lib/api";

/** Overview KPI snapshot; live (30s refetch). */
export function useBuildingSummary() {
  const { data: session } = useSession();
  const token = session?.accessToken ?? null;

  return useQuery<BuildingSummary>({
    queryKey: ["building-summary"],
    queryFn: ({ signal }) =>
      apiFetch<BuildingSummary>("/api/building/summary/", { token, signal }),
    enabled: !!token,
    refetchInterval: 30_000,
  });
}
