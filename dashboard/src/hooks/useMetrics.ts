import { useQuery } from '@tanstack/react-query';
import { fetchMetrics, fetchMetricsHistory } from '../api';

// DEPRECATED: Use useWebSocketStore(s => s.metrics) instead
export function useMetrics() {
  return useQuery({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
    enabled: false, // Disabled - WebSocket provides real-time data
  });
}

// DEPRECATED: Use useWebSocketStore(s => s.metricsHistory) instead
export function useMetricsHistory() {
  return useQuery({
    queryKey: ['metricsHistory'],
    queryFn: fetchMetricsHistory,
    enabled: false, // Disabled - WebSocket provides real-time data
  });
}
