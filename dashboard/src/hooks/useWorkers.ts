import { useQuery } from '@tanstack/react-query';
import { fetchWorkers } from '../api';
import type { WorkersResponse } from '../api/types';

// DEPRECATED: Use useWebSocketStore(s => s.workers) instead
export function useWorkers() {
  return useQuery<WorkersResponse | null>({
    queryKey: ['workers'],
    queryFn: async () => {
      const workers = await fetchWorkers();
      if (Array.isArray(workers)) {
        return { workers };
      }
      return workers as WorkersResponse | null;
    },
    enabled: false, // Disabled - WebSocket provides real-time data
  });
}
