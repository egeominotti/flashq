import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchQueues, pauseQueue, resumeQueue, retryDlq } from '../api';

export function useQueues() {
  return useQuery({
    queryKey: ['queues'],
    queryFn: fetchQueues,
    refetchInterval: 2000,
  });
}

export function usePauseQueue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => pauseQueue(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queues'] });
    },
  });
}

export function useResumeQueue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => resumeQueue(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queues'] });
    },
  });
}

export function useRetryDlq() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => retryDlq(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queues'] });
    },
  });
}
