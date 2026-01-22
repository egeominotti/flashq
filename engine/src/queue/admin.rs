//! Admin operations - job browser, metrics, workers, events.
//!
//! Job browsing, metrics history, worker registration, and event broadcasting.

use tokio::sync::broadcast;

use super::manager::QueueManager;
use super::types::{now_ms, Worker};
use crate::protocol::{JobBrowserItem, JobEvent, JobState, MetricsHistoryPoint, WorkerInfo};

impl QueueManager {
    // ============== Job Browser ==============

    /// List all jobs with filtering options.
    /// Returns jobs sorted by created_at descending (newest first).
    pub fn list_jobs(
        &self,
        queue_filter: Option<&str>,
        state_filter: Option<JobState>,
        limit: usize,
        offset: usize,
    ) -> Vec<JobBrowserItem> {
        let now = now_ms();
        let mut jobs: Vec<JobBrowserItem> = Vec::new();

        // Collect jobs from all shards
        for shard in &self.shards {
            let shard = shard.read();

            // Jobs in queues (waiting/delayed)
            for (queue_name, heap) in &shard.queues {
                if let Some(filter) = queue_filter {
                    if &**queue_name != filter {
                        continue;
                    }
                }
                for job in heap.iter() {
                    let state = if job.run_at > now {
                        JobState::Delayed
                    } else {
                        JobState::Waiting
                    };
                    if let Some(sf) = state_filter {
                        if sf != state {
                            continue;
                        }
                    }
                    jobs.push(JobBrowserItem {
                        job: job.clone(),
                        state,
                    });
                }
            }

            // Jobs in DLQ (failed)
            for (queue_name, dlq) in &shard.dlq {
                if let Some(filter) = queue_filter {
                    if &**queue_name != filter {
                        continue;
                    }
                }
                if let Some(sf) = state_filter {
                    if sf != JobState::Failed {
                        continue;
                    }
                }
                for job in dlq.iter() {
                    jobs.push(JobBrowserItem {
                        job: job.clone(),
                        state: JobState::Failed,
                    });
                }
            }

            // Jobs waiting for dependencies
            for job in shard.waiting_deps.values() {
                if let Some(filter) = queue_filter {
                    if job.queue != filter {
                        continue;
                    }
                }
                if let Some(sf) = state_filter {
                    if sf != JobState::WaitingChildren {
                        continue;
                    }
                }
                jobs.push(JobBrowserItem {
                    job: job.clone(),
                    state: JobState::WaitingChildren,
                });
            }
        }

        // Add jobs in processing (active) - iterate all shards
        for shard in &self.processing_shards {
            let processing = shard.read();
            for job in processing.values() {
                if let Some(filter) = queue_filter {
                    if job.queue != filter {
                        continue;
                    }
                }
                if let Some(sf) = state_filter {
                    if sf != JobState::Active {
                        continue;
                    }
                }
                jobs.push(JobBrowserItem {
                    job: job.clone(),
                    state: JobState::Active,
                });
            }
        }

        // Add completed jobs from completed_jobs_data
        if state_filter.is_none() || state_filter == Some(JobState::Completed) {
            let completed_data = self.completed_jobs_data.read();
            for (job, _completed_at, _result) in completed_data.iter() {
                if let Some(filter) = queue_filter {
                    if job.queue != filter {
                        continue;
                    }
                }
                jobs.push(JobBrowserItem {
                    job: job.clone(),
                    state: JobState::Completed,
                });
            }
        }

        // Sort by created_at descending (newest first)
        jobs.sort_by(|a, b| b.job.created_at.cmp(&a.job.created_at));

        // Apply offset and limit
        jobs.into_iter().skip(offset).take(limit).collect()
    }

    // ============== Metrics History ==============

    /// Get metrics history for charts.
    pub fn get_metrics_history(&self) -> Vec<MetricsHistoryPoint> {
        self.metrics_history.read().iter().cloned().collect()
    }

    /// Collect and store a metrics history point.
    pub(crate) fn collect_metrics_history(&self) {
        use std::sync::atomic::Ordering;

        let now = now_ms();
        let (queued, processing, _delayed, _dlq) = self.stats_sync();

        let total_completed = self.metrics.total_completed.load(Ordering::Relaxed);
        let total_failed = self.metrics.total_failed.load(Ordering::Relaxed);
        let latency_count = self.metrics.latency_count.load(Ordering::Relaxed);
        let avg_latency = if latency_count > 0 {
            self.metrics.latency_sum.load(Ordering::Relaxed) as f64 / latency_count as f64
        } else {
            0.0
        };

        // Calculate throughput from history
        let throughput = {
            let history = self.metrics_history.read();
            if history.len() >= 2 {
                let prev = &history[history.len() - 1];
                let time_diff = (now - prev.timestamp) as f64 / 1000.0;
                if time_diff > 0.0 {
                    (total_completed - prev.completed) as f64 / time_diff
                } else {
                    0.0
                }
            } else {
                0.0
            }
        };

        let point = MetricsHistoryPoint {
            timestamp: now,
            queued,
            processing,
            completed: total_completed,
            failed: total_failed,
            throughput,
            latency_ms: avg_latency,
        };

        let mut history = self.metrics_history.write();
        history.push_back(point);

        // Keep only last 60 points (5 minutes at 5s intervals)
        if history.len() > 60 {
            history.pop_front(); // O(1) with VecDeque
        }
    }

    /// Synchronous stats helper for internal use.
    /// Uses O(1) atomic counters instead of iterating all shards.
    fn stats_sync(&self) -> (usize, usize, usize, usize) {
        use std::sync::atomic::Ordering;

        // Use atomic counters for O(1) stats - no lock contention
        let queued = self.metrics.current_queued.load(Ordering::Relaxed) as usize;
        let processing = self.metrics.current_processing.load(Ordering::Relaxed) as usize;
        let dlq_count = self.metrics.current_dlq.load(Ordering::Relaxed) as usize;

        // Note: We don't distinguish queued vs delayed here (both in current_queued).
        // For detailed breakdown, use stats() which iterates shards.
        (queued, processing, 0, dlq_count)
    }

    // ============== Worker Registration ==============

    /// List active workers.
    pub async fn list_workers(&self) -> Vec<WorkerInfo> {
        let now = now_ms();
        let workers = self.workers.read();
        workers
            .values()
            .filter(|w| now - w.last_heartbeat < 30_000) // Active in last 30s
            .map(|w| WorkerInfo {
                id: w.id.clone(),
                queues: w.queues.clone(),
                concurrency: w.concurrency,
                last_heartbeat: w.last_heartbeat,
                jobs_processed: w.jobs_processed,
            })
            .collect()
    }

    /// Register worker heartbeat.
    pub async fn worker_heartbeat(
        &self,
        id: String,
        queues: Vec<String>,
        concurrency: u32,
        jobs_processed: u64,
    ) {
        let mut workers = self.workers.write();
        let worker = workers
            .entry(id.clone())
            .or_insert_with(|| Worker::new(id, queues.clone(), concurrency));
        worker.queues = queues;
        worker.concurrency = concurrency;
        worker.jobs_processed = jobs_processed;
        worker.last_heartbeat = now_ms();
    }

    /// Increment worker job count.
    #[allow(dead_code)]
    pub(crate) fn increment_worker_jobs(&self, worker_id: &str) {
        if let Some(worker) = self.workers.write().get_mut(worker_id) {
            worker.jobs_processed += 1;
        }
    }

    // ============== Event Broadcasting (SSE/WebSocket) ==============

    /// Subscribe to job events.
    pub fn subscribe_events(&self, _queue: Option<String>) -> broadcast::Receiver<JobEvent> {
        self.event_tx.subscribe()
    }

    /// Check if there are any event listeners (WebSocket/SSE subscribers or webhooks).
    /// OPTIMIZATION: Call this before allocating JobEvent to avoid unnecessary allocations.
    #[inline]
    pub(crate) fn has_event_listeners(&self) -> bool {
        self.event_tx.receiver_count() > 0 || !self.webhooks.read().is_empty()
    }

    /// Broadcast a job event.
    /// Optimized: early return if no webhooks and no broadcast receivers.
    /// NOTE: For best performance, call has_event_listeners() before allocating JobEvent.
    #[inline]
    pub(crate) fn broadcast_event(&self, event: JobEvent) {
        let has_receivers = self.event_tx.receiver_count() > 0;
        let has_webhooks = !self.webhooks.read().is_empty();

        // Early return if no one is listening
        if !has_receivers && !has_webhooks {
            return;
        }

        // Fire webhooks first (uses references, no clone needed)
        if has_webhooks {
            self.fire_webhooks(
                &event.event_type,
                &event.queue,
                event.job_id,
                event.data.as_ref(),
                event.error.as_deref(),
            );
        }

        // Then send to broadcast channel (consumes ownership)
        if has_receivers {
            let _ = self.event_tx.send(event);
        }
    }
}
