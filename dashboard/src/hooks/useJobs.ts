import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJobs, fetchJob, cancelJob } from '../api';
import type { JobsResponse } from '../api/types';

export function useJobs(queue?: string, state?: string, limit?: number, offset?: number) {
  return useQuery<JobsResponse | null>({
    queryKey: ['jobs', queue, state, limit, offset],
    queryFn: async () => {
      const jobs = await fetchJobs({
        queue: queue || undefined,
        state: state || undefined,
        limit,
        offset,
      });
      // Wrap in response object if array
      if (Array.isArray(jobs)) {
        return { jobs, total: jobs.length };
      }
      return jobs as JobsResponse | null;
    },
    refetchInterval: 5000, // Refresh every 5 seconds (WebSocket handles real-time)
  });
}

export function useJob(id: number) {
  return useQuery({
    queryKey: ['job', id],
    queryFn: () => fetchJob(id),
    enabled: id > 0,
  });
}

export function useCancelJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => cancelJob(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
