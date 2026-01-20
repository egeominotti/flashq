import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchSettings,
  listS3Backups,
  triggerS3Backup,
  restoreS3Backup,
  saveAuthSettings,
  saveQueueDefaults,
  saveCleanupSettings,
  runCleanup,
  clearAllQueues,
  clearAllDlq,
  clearCompletedJobs,
  resetMetrics,
} from '../api';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    refetchInterval: 10000,
  });
}

export function useS3Backups() {
  return useQuery({
    queryKey: ['s3Backups'],
    queryFn: listS3Backups,
    enabled: false, // Only fetch on demand
  });
}

export function useTriggerS3Backup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => triggerS3Backup(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['s3Backups'] });
    },
  });
}

export function useRestoreS3Backup() {
  return useMutation({
    mutationFn: (key: string) => restoreS3Backup(key),
  });
}

export function useSaveAuthSettings() {
  return useMutation({
    mutationFn: (tokens: string) => saveAuthSettings(tokens),
  });
}

export function useSaveQueueDefaults() {
  return useMutation({
    mutationFn: saveQueueDefaults,
  });
}

export function useSaveCleanupSettings() {
  return useMutation({
    mutationFn: saveCleanupSettings,
  });
}

export function useRunCleanup() {
  return useMutation({
    mutationFn: runCleanup,
  });
}

export function useClearAllQueues() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: clearAllQueues,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queues'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export function useClearAllDlq() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: clearAllDlq,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queues'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export function useClearCompletedJobs() {
  return useMutation({
    mutationFn: clearCompletedJobs,
  });
}

export function useResetMetrics() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: resetMetrics,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
    },
  });
}
