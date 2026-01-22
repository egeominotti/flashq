import { useQuery } from '@tanstack/react-query';
import { fetchStats } from '../api';

// DEPRECATED: Use useWebSocketStore(s => s.stats) instead
export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
    enabled: false, // Disabled - WebSocket provides real-time data
  });
}
