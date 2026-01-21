import { useQuery } from '@tanstack/react-query';
import { fetchStats } from '../api';

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
    refetchInterval: 3000, // Refresh every 3 seconds
  });
}
