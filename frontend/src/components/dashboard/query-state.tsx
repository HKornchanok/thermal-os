import type { ReactNode } from "react";

import { ErrorState, LoadingState } from "@/components/dashboard/states";

/**
 * Standard loading → error → render pattern for a TanStack Query.
 * Pages with custom empty states should branch inside `children`.
 */
export interface QueryLike<T> {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
}

export interface QueryStateRendererProps<T> {
  query: QueryLike<T>;
  loadingMessage: string;
  errorPrefix: string;
  loadingTestId?: string;
  errorTestId?: string;
  children: (data: T) => ReactNode;
}

export function QueryStateRenderer<T>({
  query,
  loadingMessage,
  errorPrefix,
  loadingTestId,
  errorTestId,
  children,
}: QueryStateRendererProps<T>) {
  if (query.isLoading) {
    return <LoadingState message={loadingMessage} testId={loadingTestId} />;
  }
  if (query.isError) {
    const detail =
      query.error instanceof Error ? query.error.message : "unknown error";
    return (
      <ErrorState message={`${errorPrefix}: ${detail}`} testId={errorTestId} />
    );
  }
  if (query.data === undefined) return null;
  return <>{children(query.data)}</>;
}
