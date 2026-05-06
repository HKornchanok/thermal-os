import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, type Alert } from "@/lib/api";

/** Live (30s refetch); server merges rule results, critical first. */
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
