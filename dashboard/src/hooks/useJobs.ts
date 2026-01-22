import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJobs, fetchJob, cancelJob } from '../api';
import type { JobsResponse } from '../api/types';

// Jobs list still uses React Query (paginated data not in WebSocket)
// But disable automatic polling - user can refresh manually
export function useJobs(queue?: string, state?: string, refetchInterval?: number) {
  return useQuery<JobsResponse | null>({
    queryKey: ['jobs', queue, state],
    queryFn: async () => {
      const jobs = await fetchJobs({
        queue: queue || undefined,
        state: state || undefined,
      });
      if (Array.isArray(jobs)) {
        return { jobs, total: jobs.length };
      }
      return jobs as JobsResponse | null;
    },
    refetchInterval: refetchInterval || false, // Disabled by default
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
