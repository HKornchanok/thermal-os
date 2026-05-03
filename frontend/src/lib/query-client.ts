import { QueryClient } from "@tanstack/react-query";

/**
 * Project-wide TanStack Query defaults.
 *
 * - `staleTime: 60s` — DESIGN.md §1C standard. Live pages override with
 *   `refetchInterval: 30_000` for polling.
 * - `retry: 1` — one retry on failure is enough; more thrash than help on
 *   a slow backend.
 * - `refetchOnWindowFocus: false` — the dashboard polls on its own
 *   schedule, refocus refetches would create double traffic and the data
 *   doesn't change second-to-second on a 5-minute sensor cadence anyway.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}
