import { useMemo } from 'react';

/**
 * Custom hook to generate sparkline data from metrics history.
 * Follows DRY principle by centralizing sparkline data extraction.
 *
 * @param history - Array of metrics history points
 * @param field - The field to extract values from
 * @param count - Number of data points to include (default: 20)
 */
export function useSparklineData<T>(
  history: T[] | null | undefined,
  field: keyof T,
  count: number = 20
): number[] {
  return useMemo(
    () => history?.slice(-count).map((p) => (p[field] as number) || 0) || [],
    [history, count, field]
  );
}
