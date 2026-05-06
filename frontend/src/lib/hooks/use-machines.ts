import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, type Machine } from "@/lib/api";

/** All machines + latest reading; live (30s refetch). */
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
