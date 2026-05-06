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
  from?: string;
  to?: string;
  action?: DecisionAction[];
  page?: number;
  page_size?: number;
};

/** keepPreviousData so paging doesn't flash an empty body. */
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
