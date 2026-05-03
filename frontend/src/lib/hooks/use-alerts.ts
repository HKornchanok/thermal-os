import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, type Alert } from "@/lib/api";

/**
 * Derived alerts from the three rule queries on the backend:
 * power spike (>90% rated), temp drift (>2°C from setpoint),
 * non-stop runtime (ON >16h continuous). Server returns the merged
 * list, critical first.
 *
 * Live page — refetchInterval 30s — so banners appear/disappear
 * without the user reloading.
 */
export function useAlerts() {
  const { data: session } = useSession();
  const token = session?.accessToken ?? null;

  return useQuery<Alert[]>({
    queryKey: ["alerts"],
    queryFn: ({ signal }) =>
      apiFetch<Alert[]>("/api/alerts/", { token, signal }),
    enabled: !!token,
    refetchInterval: 30_000,
  });
}
