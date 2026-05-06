import type { ReactNode } from "react";

import { ErrorState, LoadingState } from "@/components/dashboard/states";

/**
 * Standard `loading → error → render` pattern for a single TanStack
 * Query. Replaces ~8 copies of:
 *
 *     {q.isLoading ? <LoadingState /> :
 *      q.isError   ? <ErrorState message={`Failed: ${q.error...}`}/> :
 *      <Body data={q.data}/>}
 *
 * spread across the pages, each with hand-typed loading/error
 * messages and minor variations in test-id names.
 *
 * The render prop receives the resolved `data` (non-null/undefined
 * narrowed) so callers don't need to re-check after the loading +
 * error branches.
 *
 * Pages that need a different empty-state shape (e.g. "no data for
 * this metric") can compose this with their own conditional inside
 * the render prop — that case is page-specific copy, not a shared
 * pattern.
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
  if (query.data === undefined) {
    // Resolved-but-no-data: render nothing. Callers that want an
    // explicit empty state should handle it inside `children` since
    // "what counts as empty" varies (zero rows vs missing keys vs all
    // zero values).
    return null;
  }
  return <>{children(query.data)}</>;
}
