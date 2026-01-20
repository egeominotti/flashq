import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchCrons, createCron, deleteCron } from '../api';
import type { CronJob, CronsResponse } from '../api/types';

export function useCrons() {
  return useQuery<CronsResponse | null>({
    queryKey: ['crons'],
    queryFn: async () => {
      const crons = await fetchCrons();
      // Wrap in response object if array
      if (Array.isArray(crons)) {
        return { crons };
      }
      return crons as CronsResponse | null;
    },
    refetchInterval: 10000,
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
