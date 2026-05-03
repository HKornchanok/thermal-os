import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, type Machine } from "@/lib/api";

/**
 * All 12 machines plus each machine's most recent sensor reading.
 *
 * Live page — refetchInterval: 30s — so the status dot, latest power,
 * temperature, etc. on each MachineCard tick over without a manual
 * reload.
 */
export function useMachines() {
  const { data: session } = useSession();
  const token = session?.accessToken ?? null;

  return useQuery<Machine[]>({
    queryKey: ["machines"],
    queryFn: ({ signal }) =>
      apiFetch<Machine[]>("/api/machines/", { token, signal }),
    enabled: !!token,
    refetchInterval: 30_000,
  });
}
