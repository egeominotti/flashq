//! Monitoring operations.
//!
//! Metrics, statistics, and stalled job detection.

use std::sync::atomic::Ordering;

use super::manager::QueueManager;
use super::types::{intern, now_ms, JobLocation, Subscriber};
use crate::protocol::{MetricsData, QueueMetrics};

/// Memory usage statistics for debugging
#[derive(Debug, Clone, serde::Serialize)]
pub struct MemoryStats {
    pub completed_jobs_count: usize,
    pub completed_jobs_data_count: usize,
    pub job_results_count: usize,
    pub job_index_count: usize,
    pub processing_count: usize,
    pub job_logs_count: usize,
    pub stalled_count_entries: usize,
    pub custom_id_map_count: usize,
    pub debounce_cache_queues: usize,
    pub debounce_cache_entries: usize,
    pub job_waiters_count: usize,
    pub completed_retention_count: usize,
    pub subscribers_count: usize,
    pub webhooks_count: usize,
    pub workers_count: usize,
    pub cron_jobs_count: usize,
    pub metrics_history_count: usize,
    pub kv_store_count: usize,
    // Shard data
    pub total_queued_jobs: usize,
    pub total_dlq_jobs: usize,
    pub total_waiting_deps: usize,
    pub total_waiting_children: usize,
    pub total_unique_keys: usize,
}

impl QueueManager {
    /// Get detailed metrics for all queues.
    ///
    /// CRITICAL: This function previously held shard.read() while calling
    /// processing_count_by_queue(), which acquires all 32 processing_shards.read().
    /// This caused cascading deadlocks with write-preferring RwLock.
    /// Fixed by collecting queue info FIRST, releasing shard lock, THEN getting processing counts.
    pub async fn get_metrics(&self) -> MetricsData {
        let latency_count = self.metrics.latency_count.load(Ordering::Relaxed);
        let avg_latency = if latency_count > 0 {
            self.metrics.latency_sum.load(Ordering::Relaxed) as f64 / latency_count as f64
        } else {
            0.0
        };

        // PHASE 1: Collect basic queue info (pending, dlq, rate_limit) while holding shard.read()
        // Do NOT call processing_count_by_queue() here - that would cause cascading deadlock!
        let mut queue_info: Vec<(String, usize, usize, Option<u32>)> = Vec::new();

        for shard in &self.shards {
            let s = shard.read();
            for (name, heap) in &s.queues {
                let state = s.queue_state.get(name);
                queue_info.push((
                    name.to_string(),
                    heap.len(),
                    s.dlq.get(name).map_or(0, |d| d.len()),
                    state.and_then(|s| s.rate_limiter.as_ref().map(|r| r.limit)),
                ));
            }
        } // All shard.read() locks released here

        // PHASE 2: Get processing counts AFTER releasing shard locks
        // This is now safe - no shard locks held while acquiring processing_shards locks
        let queues: Vec<QueueMetrics> = queue_info
            .into_iter()
            .map(|(name, pending, dlq, rate_limit)| {
                let processing = self.processing_count_by_queue(&name);
                QueueMetrics {
                    name,
                    pending,
                    processing,
                    dlq,
                    rate_limit,
                }
            })
            .collect();

        MetricsData {
            total_pushed: self.metrics.total_pushed.load(Ordering::Relaxed),
            total_completed: self.metrics.total_completed.load(Ordering::Relaxed),
            total_failed: self.metrics.total_failed.load(Ordering::Relaxed),
            jobs_per_second: self.metrics.get_throughput(),
            avg_latency_ms: avg_latency,
            queues,
        }
    }

    /// Get summary statistics.
    /// Returns (ready, processing, delayed, dlq, completed).
    pub async fn stats(&self) -> (usize, usize, usize, usize, usize) {
        let now = now_ms();
        let (mut ready, mut delayed, mut dlq) = (0, 0, 0);
        let processing = self.processing_len();
        let completed = self.completed_jobs.read().len();

        for shard in &self.shards {
            let s = shard.read();
            for d in s.dlq.values() {
                dlq += d.len();
            }
            for heap in s.queues.values() {
                for job in heap.iter() {
                    if job.is_ready(now) {
                        ready += 1;
                    } else {
                        delayed += 1;
                    }
                }
            }
        }
        (ready, processing, delayed, dlq, completed)
    }

    /// Get memory usage statistics for debugging
    pub fn memory_stats(&self) -> MemoryStats {
        let mut total_queued = 0;
        let mut total_dlq = 0;
        let mut total_waiting_deps = 0;
        let mut total_waiting_children = 0;
        let mut total_unique_keys = 0;

        for shard in &self.shards {
            let s = shard.read();
            for heap in s.queues.values() {
                total_queued += heap.len();
            }
            for dlq in s.dlq.values() {
                total_dlq += dlq.len();
            }
            total_waiting_deps += s.waiting_deps.len();
            total_waiting_children += s.waiting_children.len();
            for keys in s.unique_keys.values() {
                total_unique_keys += keys.len();
            }
        }

        let debounce_cache = self.debounce_cache.read();
        let debounce_queues = debounce_cache.len();
        let debounce_entries: usize = debounce_cache.values().map(|m| m.len()).sum();

        MemoryStats {
            completed_jobs_count: self.completed_jobs.read().len(),
            completed_jobs_data_count: self.completed_jobs_data.read().len(),
            job_results_count: self.job_results.read().len(),
            job_index_count: self.job_index.len(),
            processing_count: self.processing_len(),
            job_logs_count: self.job_logs.read().len(),
            stalled_count_entries: self.stalled_count.read().len(),
            custom_id_map_count: self.custom_id_map.read().len(),
            debounce_cache_queues: debounce_queues,
            debounce_cache_entries: debounce_entries,
            job_waiters_count: self.job_waiters.read().len(),
            completed_retention_count: self.completed_retention.read().len(),
            subscribers_count: self.subscribers.read().len(),
            webhooks_count: self.webhooks.read().len(),
            workers_count: self.workers.read().len(),
            cron_jobs_count: self.cron_jobs.read().len(),
            metrics_history_count: self.metrics_history.read().len(),
            kv_store_count: self.kv_store.len(),
            total_queued_jobs: total_queued,
            total_dlq_jobs: total_dlq,
            total_waiting_deps,
            total_waiting_children,
            total_unique_keys,
        }
    }

    // === Pub/Sub ===

    /// Subscribe to events for a queue.
    pub fn subscribe(
        &self,
        queue: String,
        events: Vec<String>,
        tx: tokio::sync::mpsc::UnboundedSender<String>,
    ) {
        let queue_arc = intern(&queue);
        self.subscribers.write().push(Subscriber {
            queue: queue_arc,
            events,
            tx,
        });
    }

    /// Unsubscribe from events for a queue.
    pub fn unsubscribe(&self, queue: &str) {
        let queue_arc = intern(queue);
        self.subscribers.write().retain(|s| s.queue != queue_arc);
    }

    // === Stalled Jobs Detection ===

    /// Send heartbeat for a job to prevent stall detection.
    pub fn heartbeat(&self, job_id: u64) -> Result<(), String> {
        let updated = self.processing_get_mut(job_id, |job| {
            job.last_heartbeat = now_ms();
        });
        if updated.is_some() {
            // Reset stall count on successful heartbeat
            self.stalled_count.write().remove(&job_id);
            Ok(())
        } else {
            Err(format!("Job {} not in processing", job_id))
        }
    }

    /// Check for stalled jobs and handle them.
    pub(crate) fn check_stalled_jobs(&self) {
        let now = now_ms();
        // Collect only job IDs and stall_count (no clone of entire Job)
        let mut stalled_job_ids: Vec<(u64, u32)> = Vec::new();

        // Find stalled jobs (iterate all processing shards)
        self.processing_iter(|job| {
            let stall_timeout = if job.stall_timeout > 0 {
                job.stall_timeout
            } else {
                30_000 // Default 30 seconds
            };

            // Check if job is stalled (no heartbeat within timeout)
            let last_activity = if job.last_heartbeat > 0 {
                job.last_heartbeat
            } else {
                job.started_at
            };

            if now > last_activity + stall_timeout {
                stalled_job_ids.push((job.id, job.stall_count));
            }
        });

        // Handle stalled jobs
        for (job_id, stall_count) in stalled_job_ids {
            let mut stall_counts = self.stalled_count.write();
            let count = stall_counts.entry(job_id).or_insert(0);
            *count += 1;

            if *count >= 3 {
                // Too many stalls, move to DLQ
                drop(stall_counts);
                if let Some(job) = self.processing_remove(job_id) {
                    let idx = Self::shard_index(&job.queue);
                    let queue_arc = intern(&job.queue);
                    // Persist first (needs reference), then move (consumes ownership)
                    self.persist_dlq(&job, Some("Job stalled"));
                    self.index_job(
                        job_id,
                        JobLocation::Dlq {
                            shard_idx: idx,
                            queue_name: queue_arc.clone(),
                        },
                    );
                    self.shards[idx]
                        .write()
                        .dlq
                        .entry(queue_arc)
                        .or_default()
                        .push_back(job); // Move, no clone!
                    self.metrics.record_fail();

                    // Log the stall event
                    let _ = self.add_job_log(
                        job_id,
                        "Job moved to DLQ after 3 stall detections".to_string(),
                        "error".to_string(),
                    );
                }
            } else {
                // Update last_heartbeat to give more time, but increment stall count
                drop(stall_counts);
                self.processing_get_mut(job_id, |job_mut| {
                    job_mut.last_heartbeat = now;
                    job_mut.stall_count = stall_count + 1;
                });

                // Log the stall warning
                let _ = self.add_job_log(
                    job_id,
                    format!("Job stall detected (count: {})", stall_count + 1),
                    "warn".to_string(),
                );
            }
        }
    }
}
