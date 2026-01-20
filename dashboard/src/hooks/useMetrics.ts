import { useQuery } from '@tanstack/react-query';
import { fetchMetrics, fetchMetricsHistory } from '../api';

export function useMetrics() {
  return useQuery({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
    refetchInterval: 2000,
  });
}

export function useMetricsHistory() {
  return useQuery({
    queryKey: ['metricsHistory'],
    queryFn: fetchMetricsHistory,
    refetchInterval: 5000,
  });
}
