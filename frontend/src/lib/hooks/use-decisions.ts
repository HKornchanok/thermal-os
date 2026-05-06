import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import {
  apiFetch,
  toSearchParams,
  type Decision,
  type DecisionAction,
  type Paginated,
} from "@/lib/api";

export type DecisionsParams = {
  /** ISO 8601. Defaults server-side to `to - 7 days`. */
  from?: string;
  /** ISO 8601. Defaults server-side to MAX(recorded_at). */
  to?: string;
  /**
   * One or more actions to include. Serialised as a comma-separated
   * `?action=a,b` list. Empty array or undefined → no filter.
   */
  action?: DecisionAction[];
  page?: number;
  /** 1–100 inclusive. Default server-side: 20. */
  page_size?: number;
};

/**
 * Server-side paginated AI decision log.
 *
 * Uses `placeholderData: keepPreviousData` so paging through the table
 * doesn't flash an empty body on every fetch — the previous page stays
 * visible until the new one arrives. The TanStack v5 spelling for what
 * was `keepPreviousData: true` in v4.
 */
export function useDecisions(params: DecisionsParams = {}) {
  const { data: session } = useSession();
  const token = session?.accessToken ?? null;

  return useQuery<Paginated<Decision>>({
    queryKey: ["decisions", params],
    queryFn: ({ signal }) => {
      const path = `/api/decisions/${toSearchParams(params)}`;
      return apiFetch<Paginated<Decision>>(path, { token, signal });
    },
    enabled: !!token,
    placeholderData: keepPreviousData,
  });
}
