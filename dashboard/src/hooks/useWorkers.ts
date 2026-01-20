import { useQuery } from '@tanstack/react-query';
import { fetchWorkers } from '../api';
import type { WorkersResponse } from '../api/types';

export function useWorkers() {
  return useQuery<WorkersResponse | null>({
    queryKey: ['workers'],
    queryFn: async () => {
      const workers = await fetchWorkers();
      // Wrap in response object if array
      if (Array.isArray(workers)) {
        return { workers };
      }
      return workers as WorkersResponse | null;
    },
    refetchInterval: 5000,
  });
}
