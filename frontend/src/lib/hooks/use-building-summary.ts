import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, type BuildingSummary } from "@/lib/api";

/**
 * Single-row building snapshot used for the Overview KPIs:
 * total / active / inactive machines, current total power, today's
 * kWh + day-over-day trend, average ON-AC temperature.
 *
 * Server computes against MAX(recorded_at) — not wall-clock now() —
 * so seeded data still reads as "today". Refetch every 30s so the
 * KPIs tick over while the page is open.
 */
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
