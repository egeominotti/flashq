//! Acknowledgment and failure operations for completed/failed jobs.
//!
//! Contains `ack`, `ack_batch`, `fail`, and `get_result` implementations.

use std::sync::atomic::Ordering;

use serde_json::Value;

use super::manager::QueueManager;
use super::types::{intern, now_ms, JobLocation};
use crate::protocol::JobEvent;

impl QueueManager {
    pub async fn ack(&self, job_id: u64, result: Option<Value>) -> Result<(), String> {
        let job = self.processing_remove(job_id);
        if let Some(job) = job {
            // Release concurrency, group, and unique key
            let idx = Self::shard_index(&job.queue);
            let queue_arc = intern(&job.queue);
            {
                let mut shard = self.shards[idx].write();
                shard.release_job_resources(
                    &queue_arc,
                    job.unique_key.as_ref(),
                    job.group_id.as_ref(),
                );
            }

            // Handle remove_on_complete option
            if job.remove_on_complete {
                // Don't store in completed_jobs or job_results
                self.unindex_job(job_id);
                // Clean up logs for this job
                self.job_logs.write().remove(&job_id);
                self.stalled_count.write().remove(&job_id);
                // Delete from SQLite (job was inserted at push, must be removed now)
                self.persist_delete(job_id);
            } else {
                // Store result if provided
                if let Some(ref res) = result {
                    self.job_results.write().insert(job_id, res.clone());
                }
                self.completed_jobs.write().insert(job_id);
                self.index_job(job_id, JobLocation::Completed);

                // Store completed job data for browsing (respects max_completed_jobs setting)
                {
                    let max_completed = self.cleanup_settings.read().max_completed_jobs;
                    let mut completed_data = self.completed_jobs_data.write();
                    completed_data.push_back((job.clone(), now_ms(), result.clone()));
                    while completed_data.len() > max_completed {
                        completed_data.pop_front();
                    }
                }
            }

            // Persist to SQLite - skip if remove_on_complete to save memory/disk
            if !job.remove_on_complete {
                if self.is_sync_persistence() {
                    let _ = self.persist_ack_sync(job_id, result.clone()).await;
                } else {
                    self.persist_ack(job_id, result.clone());
                }
            }
            self.metrics.record_complete(now_ms() - job.created_at);
            self.notify_subscribers("completed", &job.queue, &job);

            // OPTIMIZATION: Only allocate JobEvent if there are listeners
            if self.has_event_listeners() {
                self.broadcast_event(JobEvent {
                    event_type: "completed".to_string(),
                    queue: job.queue.clone(),
                    job_id: job.id,
                    timestamp: now_ms(),
                    data: result.clone(),
                    error: None,
                    progress: None,
                });
            }

            // Notify any waiters (finished() promise)
            self.notify_job_waiters(job.id, result.clone());

            // Store retention info if needed
            if job.keep_completed_age > 0 || job.keep_completed_count > 0 {
                self.completed_retention
                    .write()
                    .insert(job.id, (now_ms(), job.keep_completed_age, result));
            }

            // If this job has a parent (is part of a flow), notify the parent
            if let Some(parent_id) = job.parent_id {
                self.on_child_completed(parent_id);
            }

            return Ok(());
        }
        Err(format!("Job {} not found", job_id))
    }

    pub async fn ack_batch(&self, ids: &[u64]) -> usize {
        let mut acked = 0;
        let mut ids_to_persist: Vec<u64> = Vec::new();
        let mut ids_to_delete: Vec<u64> = Vec::new();
        // Collect IDs for bulk cleanup operations (avoid acquiring locks per-job)
        let mut logs_to_remove: Vec<u64> = Vec::new();
        let mut stalled_to_remove: Vec<u64> = Vec::new();
        let mut completed_to_insert: Vec<u64> = Vec::new();
        // CRITICAL OPTIMIZATION: Collect shard resources to release, then batch release
        // This prevents acquiring shard lock 100 times per batch (was causing lock convoy)
        // Group by shard index for efficient batching
        let mut shard_resources: std::collections::HashMap<
            usize,
            (
                compact_str::CompactString,
                Vec<Option<String>>,
                Vec<Option<String>>,
            ),
        > = std::collections::HashMap::new();

        // First pass: collect all jobs and their resource info WITHOUT acquiring shard locks
        for &id in ids {
            if let Some(job) = self.processing_remove(id) {
                let idx = Self::shard_index(&job.queue);
                let queue_arc = intern(&job.queue);

                // Collect resources for batch release
                let entry = shard_resources
                    .entry(idx)
                    .or_insert_with(|| (queue_arc.clone(), Vec::new(), Vec::new()));
                entry.1.push(job.unique_key.clone());
                entry.2.push(job.group_id.clone());

                // Handle remove_on_complete option - collect IDs for bulk operations
                if job.remove_on_complete {
                    self.unindex_job(id);
                    logs_to_remove.push(id);
                    stalled_to_remove.push(id);
                    ids_to_delete.push(id);
                } else {
                    completed_to_insert.push(id);
                    self.index_job(id, JobLocation::Completed);
                    ids_to_persist.push(id);
                }

                // Notify any waiters (finished() promise) - no result for batch ack
                self.notify_job_waiters(id, None);

                acked += 1;
            }
        }

        // CRITICAL: Release shard resources with SINGLE lock acquisition per shard
        // This reduces lock contention from O(n) to O(shards) lock acquisitions
        for (idx, (queue_arc, unique_keys, group_ids)) in shard_resources {
            let mut shard = self.shards[idx].write();
            let job_count = unique_keys.len();

            // Bulk release concurrency
            for _ in 0..job_count {
                shard.release_concurrency(&queue_arc);
            }

            // Bulk release groups
            for group_id in group_ids {
                shard.release_group(&queue_arc, group_id.as_ref());
            }

            // Bulk remove unique keys
            for unique_key in unique_keys {
                shard.remove_unique_key(&queue_arc, unique_key.as_ref());
            }
        }

        // OPTIMIZATION: Bulk operations with single lock acquisitions
        // This reduces lock contention from O(n) to O(1) lock acquisitions
        if !logs_to_remove.is_empty() {
            let mut job_logs = self.job_logs.write();
            for id in logs_to_remove {
                job_logs.remove(&id);
            }
        }
        if !stalled_to_remove.is_empty() {
            let mut stalled = self.stalled_count.write();
            for id in stalled_to_remove {
                stalled.remove(&id);
            }
        }
        if !completed_to_insert.is_empty() {
            let mut completed = self.completed_jobs.write();
            for id in completed_to_insert {
                completed.insert(id);
            }
        }

        // Persist only jobs without remove_on_complete
        if !ids_to_persist.is_empty() {
            self.persist_ack_batch(&ids_to_persist);
        }
        // Delete jobs with remove_on_complete from SQLite
        if !ids_to_delete.is_empty() {
            self.persist_delete_batch(&ids_to_delete);
        }

        // Update metrics: increment completed, decrement processing
        self.metrics
            .total_completed
            .fetch_add(acked as u64, Ordering::Relaxed);
        self.metrics
            .current_processing
            .fetch_sub(acked as u64, Ordering::Relaxed);
        acked
    }

    pub async fn fail(&self, job_id: u64, error: Option<String>) -> Result<(), String> {
        let job = self.processing_remove(job_id);
        if let Some(mut job) = job {
            let idx = Self::shard_index(&job.queue);
            let queue_arc = intern(&job.queue);

            job.attempts += 1;

            if job.should_go_to_dlq() {
                self.notify_subscribers("failed", &job.queue, &job);

                // Notify waiters that job failed (prevents memory leak in job_waiters)
                self.notify_job_waiters(job_id, None);

                // Handle remove_on_fail option
                if job.remove_on_fail {
                    // OPTIMIZATION: Single lock scope for release concurrency and group
                    {
                        let mut shard = self.shards[idx].write();
                        shard.release_concurrency(&queue_arc);
                        shard.release_group(&queue_arc, job.group_id.as_ref());
                    }
                    // Don't store in DLQ, just discard
                    self.unindex_job(job_id);
                    self.job_logs.write().remove(&job_id);
                    self.stalled_count.write().remove(&job_id);
                    // OPTIMIZATION: Update atomic counter (processing -> removed)
                    self.metrics.record_fail();
                    // Decrement processing counter manually since record_dlq() not called
                    self.metrics
                        .current_processing
                        .fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                } else {
                    self.index_job(job_id, JobLocation::Dlq { shard_idx: idx });
                    // Persist first (needs reference)
                    self.persist_dlq(&job, error.as_deref());
                    // Extract data for broadcast before moving
                    let queue_name = job.queue.clone();
                    let group_id_to_release = job.group_id.clone();

                    // OPTIMIZATION: Single lock scope for release concurrency, group + DLQ push
                    {
                        let mut shard = self.shards[idx].write();
                        shard.release_concurrency(&queue_arc);
                        shard.release_group(&queue_arc, group_id_to_release.as_ref());
                        shard.dlq.entry(queue_arc).or_default().push_back(job);
                    }

                    self.metrics.record_fail();
                    // OPTIMIZATION: Update atomic counter (processing -> DLQ)
                    self.metrics.record_dlq();

                    // OPTIMIZATION: Only allocate JobEvent if there are listeners
                    if self.has_event_listeners() {
                        self.broadcast_event(JobEvent {
                            event_type: "failed".to_string(),
                            queue: queue_name,
                            job_id,
                            timestamp: now_ms(),
                            data: None,
                            error,
                            progress: None,
                        });
                    }
                    return Ok(());
                }

                // OPTIMIZATION: Only allocate JobEvent if there are listeners
                if self.has_event_listeners() {
                    self.broadcast_event(JobEvent {
                        event_type: "failed".to_string(),
                        queue: job.queue.clone(),
                        job_id: job.id,
                        timestamp: now_ms(),
                        data: None,
                        error,
                        progress: None,
                    });
                }

                return Ok(());
            }

            // Job will be retried
            let backoff = job.next_backoff();
            let new_run_at = if backoff > 0 {
                now_ms() + backoff
            } else {
                job.run_at
            };
            job.run_at = new_run_at;
            job.started_at = 0;

            if let Some(err) = error {
                job.progress_msg = Some(err);
            }

            self.index_job(job_id, JobLocation::Queue { shard_idx: idx });

            // Persist first - use sync mode if enabled for durability
            if self.is_sync_persistence() {
                let _ = self
                    .persist_fail_sync(job_id, new_run_at, job.attempts)
                    .await;
            } else {
                self.persist_fail(job_id, new_run_at, job.attempts);
            }

            // OPTIMIZATION: Single lock scope for release concurrency, group + queue push
            {
                let mut shard = self.shards[idx].write();
                shard.release_concurrency(&queue_arc);
                shard.release_group(&queue_arc, job.group_id.as_ref());
                shard.queues.entry(queue_arc).or_default().push(job);
            }

            // OPTIMIZATION: Update atomic counter (processing -> queue)
            self.metrics.record_retry();

            self.notify_shard(idx);
            return Ok(());
        }
        Err(format!("Job {} not found", job_id))
    }

    pub async fn get_result(&self, job_id: u64) -> Option<Value> {
        self.job_results.read().get(&job_id).cloned()
    }
}
