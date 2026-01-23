//! Cleanup tasks for jobs, results, and memory.

use super::super::manager::QueueManager;
use super::super::types::{now_ms, JobLocation};

impl QueueManager {
    pub(crate) fn cleanup_completed_jobs(&self) {
        const MAX_COMPLETED: usize = 50_000;

        // CRITICAL: Collect IDs to remove FIRST, then release lock.
        let to_remove: Vec<u64> = {
            let completed = self.completed_jobs.read();
            let len = completed.len();
            if len > MAX_COMPLETED {
                completed
                    .iter()
                    .take(len - MAX_COMPLETED / 2)
                    .copied()
                    .collect()
            } else {
                return;
            }
        };

        // Remove from job_index (DashMap, lock-free)
        for &id in &to_remove {
            self.job_index.remove(&id);
        }

        // Clean custom_id_map separately - O(n) with HashSet lookup instead of O(n²)
        {
            let to_remove_set: std::collections::HashSet<u64> = to_remove.iter().copied().collect();
            let mut custom_id_map = self.custom_id_map.write();
            custom_id_map.retain(|_, &mut internal_id| !to_remove_set.contains(&internal_id));
        }

        // Remove from completed_jobs
        {
            let mut completed = self.completed_jobs.write();
            for id in to_remove {
                completed.remove(&id);
            }
        }
    }

    pub(crate) fn cleanup_job_results(&self) {
        const MAX_RESULTS: usize = 10_000;

        let mut results = self.job_results.write();
        let len = results.len();
        if len > MAX_RESULTS {
            let to_remove: Vec<_> = results
                .keys()
                .take(len - MAX_RESULTS / 2)
                .copied()
                .collect();
            for id in to_remove {
                results.remove(&id);
            }
        }
    }

    pub(crate) fn cleanup_completed_retention(&self) {
        let now = now_ms();
        let mut retention = self.completed_retention.write();

        retention.retain(|_job_id, (created_at, keep_age, _result)| {
            *keep_age == 0 || now - *created_at < *keep_age
        });
    }

    pub(crate) fn cleanup_stale_index_entries(&self) {
        const MAX_INDEX_SIZE: usize = 100_000;

        let index_len = self.job_index.len();
        if index_len <= MAX_INDEX_SIZE {
            return;
        }

        // Copy completed_jobs to local set FIRST
        let completed_jobs: std::collections::HashSet<u64> =
            self.completed_jobs.read().iter().copied().collect();

        // Collect processing job IDs
        let processing_ids: std::collections::HashSet<u64> = {
            let mut ids = std::collections::HashSet::new();
            for shard in &self.processing_shards {
                if let Some(guard) = shard.try_read() {
                    ids.extend(guard.keys().copied());
                }
            }
            ids
        };

        // Snapshot shard state ONCE per shard
        let mut shard_queue_ids: Vec<std::collections::HashSet<u64>> =
            vec![std::collections::HashSet::new(); self.shards.len()];
        let mut shard_dlq_ids: Vec<std::collections::HashSet<u64>> =
            vec![std::collections::HashSet::new(); self.shards.len()];
        let mut shard_waiting_deps: Vec<std::collections::HashSet<u64>> =
            vec![std::collections::HashSet::new(); self.shards.len()];
        let mut shard_waiting_children: Vec<std::collections::HashSet<u64>> =
            vec![std::collections::HashSet::new(); self.shards.len()];

        for (idx, shard_lock) in self.shards.iter().enumerate() {
            if let Some(shard) = shard_lock.try_read() {
                for heap in shard.queues.values() {
                    shard_queue_ids[idx].extend(heap.iter().map(|j| j.id));
                }
                for dlq in shard.dlq.values() {
                    shard_dlq_ids[idx].extend(dlq.iter().map(|j| j.id));
                }
                shard_waiting_deps[idx].extend(shard.waiting_deps.keys().copied());
                shard_waiting_children[idx].extend(shard.waiting_children.keys().copied());
            }
        }

        let target_remove = index_len - MAX_INDEX_SIZE / 2;
        let mut to_remove = Vec::with_capacity(target_remove);

        for entry in self.job_index.iter() {
            if to_remove.len() >= target_remove {
                break;
            }

            let id = *entry.key();
            let location = entry.value().clone();

            let is_stale = match location {
                JobLocation::Completed => !completed_jobs.contains(&id),
                JobLocation::Processing => !processing_ids.contains(&id),
                JobLocation::Queue { shard_idx, .. } => !shard_queue_ids[shard_idx].contains(&id),
                JobLocation::Dlq { shard_idx, .. } => !shard_dlq_ids[shard_idx].contains(&id),
                JobLocation::WaitingDeps { shard_idx } => {
                    !shard_waiting_deps[shard_idx].contains(&id)
                }
                JobLocation::WaitingChildren { shard_idx } => {
                    !shard_waiting_children[shard_idx].contains(&id)
                }
            };

            if is_stale {
                to_remove.push(id);
            }
        }

        if !to_remove.is_empty() {
            for &id in &to_remove {
                self.job_index.remove(&id);
            }
            let mut job_logs = self.job_logs.write();
            let mut stalled = self.stalled_count.write();
            for id in to_remove {
                job_logs.remove(&id);
                stalled.remove(&id);
            }
        }
    }

    /// Clean up orphaned webhook circuit breaker entries.
    /// Removes circuits for webhooks that no longer exist.
    pub(crate) fn cleanup_webhook_circuits(&self) {
        // Collect active webhook URLs
        let active_urls: std::collections::HashSet<String> = self
            .webhooks
            .read()
            .values()
            .map(|w| w.url.clone())
            .collect();

        // Remove circuit entries for URLs that are no longer active
        self.webhook_circuits
            .write()
            .retain(|url, _| active_urls.contains(url));
    }

    /// Shrink memory buffers to release unused capacity.
    pub(crate) fn shrink_memory_buffers(&self) {
        // Shrink queue heaps in all shards
        for shard in &self.shards {
            if let Some(mut s) = shard.try_write() {
                for heap in s.queues.values_mut() {
                    heap.shrink_to_fit();
                }
                s.queues.retain(|_, heap| !heap.is_empty());
                s.dlq.retain(|_, dlq| !dlq.is_empty());
                s.unique_keys.retain(|_, keys| !keys.is_empty());
                s.queues.shrink_to_fit();
                s.dlq.shrink_to_fit();
                s.waiting_deps.shrink_to_fit();
                s.waiting_children.shrink_to_fit();
                s.unique_keys.shrink_to_fit();
                s.active_groups.shrink_to_fit();
            }
        }

        // Shrink processing shards
        for shard in &self.processing_shards {
            if let Some(mut s) = shard.try_write() {
                s.shrink_to_fit();
            }
        }

        // Shrink other structures
        if let Some(mut guard) = self.completed_jobs.try_write() {
            guard.shrink_to_fit();
        }
        if let Some(mut guard) = self.job_results.try_write() {
            guard.shrink_to_fit();
        }
        if let Some(mut guard) = self.job_logs.try_write() {
            guard.shrink_to_fit();
        }
        if let Some(mut guard) = self.stalled_count.try_write() {
            guard.shrink_to_fit();
        }
        if let Some(mut guard) = self.custom_id_map.try_write() {
            guard.shrink_to_fit();
        }
        if let Some(mut guard) = self.completed_retention.try_write() {
            guard.shrink_to_fit();
        }
        if let Some(mut guard) = self.job_waiters.try_write() {
            guard.shrink_to_fit();
        }
    }
}
