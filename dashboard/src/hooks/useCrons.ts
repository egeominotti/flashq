import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchCrons, createCron, deleteCron } from '../api';
import type { CronJob, CronsResponse } from '../api/types';

// DEPRECATED: Use useWebSocketStore(s => s.crons) instead
export function useCrons() {
  return useQuery<CronsResponse | null>({
    queryKey: ['crons'],
    queryFn: async () => {
      const crons = await fetchCrons();
      if (Array.isArray(crons)) {
        return { crons };
      }
      return crons as CronsResponse | null;
    },
    enabled: false, // Disabled - WebSocket provides real-time data
  });
}

export function useCreateCron() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, ...params }: CronJob) => createCron(name, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crons'] });
    },
  });
}

export function useDeleteCron() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => deleteCron(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crons'] });
    },
  });
}
