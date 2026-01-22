//! Background tasks for flashQ (cleanup, cron, timeouts, snapshots).

use std::sync::atomic::Ordering;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use croner::Cron;
use tokio::time::{interval, Duration};
use tracing::{error, info};

use super::manager::QueueManager;
use super::types::{cleanup_interned_strings, intern, now_ms, JobLocation};

impl QueueManager {
    /// Run background tasks (cleanup, cron, metrics, snapshots).
    pub async fn background_tasks(self: Arc<Self>) {
        let mut wakeup_ticker = interval(Duration::from_millis(500));
        let mut cron_ticker = interval(Duration::from_secs(1));
        let mut cleanup_ticker = interval(Duration::from_secs(10));
        let mut timeout_ticker = interval(Duration::from_millis(500));
        let mut stalled_ticker = interval(Duration::from_secs(10));
        let mut metrics_ticker = interval(Duration::from_secs(5));
        let mut snapshot_ticker = interval(Duration::from_secs(1));

        info!("Background tasks started");

        loop {
            if self.is_shutdown() {
                info!("Background tasks received shutdown signal, stopping...");
                self.maybe_snapshot().await;
                info!("Background tasks stopped");
                return;
            }

            tokio::select! {
                _ = wakeup_ticker.tick() => {
                    self.notify_all();
                    self.check_dependencies().await;
                }
                _ = timeout_ticker.tick() => {
                    self.check_timed_out_jobs().await;
                }
                _ = stalled_ticker.tick() => {
                    self.check_stalled_jobs();
                }
                _ = cron_ticker.tick() => {
                    self.run_cron_jobs().await;
                }
                _ = cleanup_ticker.tick() => {
                    self.cleanup_completed_jobs();
                    self.cleanup_job_results();
                    self.cleanup_job_logs();
                    self.cleanup_stale_index_entries();
                    self.cleanup_debounce_cache();
                    self.cleanup_expired_kv();
                    self.cleanup_completed_retention();
                    cleanup_interned_strings();
                    // Shrink memory buffers to release unused capacity
                    self.shrink_memory_buffers();
                }
                _ = metrics_ticker.tick() => {
                    self.collect_metrics_history();
                }
                _ = snapshot_ticker.tick() => {
                    self.maybe_snapshot().await;
                }
            }
        }
    }

    /// Check if snapshot should be taken and execute it.
    async fn maybe_snapshot(&self) {
        let config = match &self.snapshot_config {
            Some(c) => c,
            None => return,
        };

        let now = now_ms();
        let last = self.last_snapshot.load(Ordering::Relaxed);
        let changes = self.snapshot_changes.load(Ordering::Relaxed);
        let interval_ms = config.interval_secs * 1000;

        if now - last >= interval_ms && changes >= config.min_changes {
            self.execute_snapshot().await;
        }
    }

    /// Execute a snapshot using SQLite's backup API.
    async fn execute_snapshot(&self) {
        let storage = match &self.storage {
            Some(s) => s,
            None => return,
        };

        let start = now_ms();

        if let Err(e) = storage.create_snapshot() {
            error!(error = %e, "Snapshot failed");
            return;
        }

        let elapsed = now_ms() - start;
        info!(elapsed_ms = elapsed, "Snapshot completed");

        self.last_snapshot.store(now_ms(), Ordering::Relaxed);
        self.snapshot_changes.store(0, Ordering::Relaxed);
    }

    pub(crate) async fn check_timed_out_jobs(&self) {
        let now = Self::now_ms();
        let mut timed_out = Vec::new();

        self.processing_iter(|job| {
            if job.is_timed_out(now) {
                timed_out.push(job.id);
            }
        });

        for job_id in timed_out {
            if let Some(mut job) = self.processing_remove(job_id) {
                let idx = Self::shard_index(&job.queue);
                let queue_arc = intern(&job.queue);
                {
                    let mut shard = self.shards[idx].write();
                    let state = shard.get_state(&queue_arc);
                    if let Some(ref mut conc) = state.concurrency {
                        conc.release();
                    }
                }

                job.attempts += 1;

                if job.should_go_to_dlq() {
                    self.notify_subscribers("timeout", &job.queue, &job);
                    self.index_job(job_id, JobLocation::Dlq { shard_idx: idx });
                    self.persist_dlq(&job, Some("Job timed out"));
                    self.metrics.record_timeout();
                    self.metrics.record_dlq();
                    self.shards[idx]
                        .write()
                        .dlq
                        .entry(queue_arc)
                        .or_default()
                        .push_back(job);
                } else {
                    let backoff = job.next_backoff();
                    let new_run_at = if backoff > 0 {
                        now + backoff
                    } else {
                        job.run_at
                    };
                    job.run_at = new_run_at;
                    job.started_at = 0;
                    job.progress_msg = Some("Job timed out".to_string());

                    self.index_job(job_id, JobLocation::Queue { shard_idx: idx });
                    self.persist_fail(job_id, new_run_at, job.attempts);
                    self.metrics.record_retry();
                    self.shards[idx]
                        .write()
                        .queues
                        .entry(queue_arc)
                        .or_default()
                        .push(job);
                    self.notify_shard(idx);
                }
            }
        }
    }

    pub(crate) async fn check_dependencies(&self) {
        if self.completed_jobs.read().is_empty() {
            return;
        }

        for (idx, shard) in self.shards.iter().enumerate() {
            let mut shard_w = shard.write();

            let ready_ids: Vec<u64> = {
                let completed = self.completed_jobs.read();
                shard_w
                    .waiting_deps
                    .iter()
                    .filter(|(_, job)| job.depends_on.iter().all(|dep| completed.contains(dep)))
                    .map(|(&id, _)| id)
                    .collect()
            };

            if ready_ids.is_empty() {
                continue;
            }

            for job_id in ready_ids {
                if let Some(job) = shard_w.waiting_deps.remove(&job_id) {
                    let queue_arc = intern(&job.queue);
                    shard_w.queues.entry(queue_arc).or_default().push(job);
                }
            }
            drop(shard_w);
            self.notify_shard(idx);
        }
    }

    pub(crate) fn cleanup_completed_jobs(&self) {
        const MAX_COMPLETED: usize = 50_000;

        let mut completed = self.completed_jobs.write();
        let len = completed.len();
        if len > MAX_COMPLETED {
            // Remove everything above threshold (aggressive cleanup)
            let to_remove: Vec<_> = completed
                .iter()
                .take(len - MAX_COMPLETED / 2)
                .copied()
                .collect();

            for &id in &to_remove {
                self.job_index.remove(&id);
            }

            {
                let mut custom_id_map = self.custom_id_map.write();
                custom_id_map.retain(|_, &mut internal_id| !to_remove.contains(&internal_id));
            }

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
            // Remove everything above threshold (aggressive cleanup)
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

    /// Cleanup expired entries from completed_retention map.
    /// Removes entries older than their keep_completed_age.
    pub(crate) fn cleanup_completed_retention(&self) {
        let now = now_ms();
        let mut retention = self.completed_retention.write();

        retention.retain(|_job_id, (created_at, keep_age, _result)| {
            // Keep if age limit is 0 (no expiry) or not expired yet
            *keep_age == 0 || now - *created_at < *keep_age
        });
    }

    pub(crate) fn cleanup_stale_index_entries(&self) {
        const MAX_INDEX_SIZE: usize = 100_000;

        let index_len = self.job_index.len();
        if index_len <= MAX_INDEX_SIZE {
            return;
        }

        // Aggressive: remove all stale entries above threshold
        let target_remove = index_len - MAX_INDEX_SIZE / 2;
        let mut to_remove = Vec::with_capacity(target_remove);
        let completed_jobs = self.completed_jobs.read();

        for entry in self.job_index.iter() {
            if to_remove.len() >= target_remove {
                break;
            }

            let id = *entry.key();
            let location = *entry.value();

            let is_stale = match location {
                JobLocation::Completed => !completed_jobs.contains(&id),
                JobLocation::Processing => !self.processing_contains(id),
                JobLocation::Queue { shard_idx } => {
                    let shard = self.shards[shard_idx].read();
                    !shard.queues.values().any(|heap| heap.contains(id))
                }
                JobLocation::Dlq { shard_idx } => {
                    let shard = self.shards[shard_idx].read();
                    !shard.dlq.values().any(|dlq| dlq.iter().any(|j| j.id == id))
                }
                JobLocation::WaitingDeps { shard_idx } => {
                    let shard = self.shards[shard_idx].read();
                    !shard.waiting_deps.contains_key(&id)
                }
                JobLocation::WaitingChildren { shard_idx } => {
                    let shard = self.shards[shard_idx].read();
                    !shard.waiting_children.contains_key(&id)
                }
            };

            if is_stale {
                to_remove.push(id);
            }
        }

        drop(completed_jobs);

        for id in to_remove {
            self.job_index.remove(&id);
            self.job_logs.write().remove(&id);
            self.stalled_count.write().remove(&id);
        }
    }

    /// Shrink memory buffers to release unused capacity back to the allocator.
    /// This is important after processing large batches of jobs.
    pub(crate) fn shrink_memory_buffers(&self) {
        // Shrink queue heaps in all shards
        for shard in &self.shards {
            let mut s = shard.write();
            for heap in s.queues.values_mut() {
                heap.shrink_to_fit();
            }
            // Remove empty queues entirely
            s.queues.retain(|_, heap| !heap.is_empty());
            s.dlq.retain(|_, dlq| !dlq.is_empty());
            s.unique_keys.retain(|_, keys| !keys.is_empty());
            // Shrink remaining structures
            s.queues.shrink_to_fit();
            s.dlq.shrink_to_fit();
            s.waiting_deps.shrink_to_fit();
            s.waiting_children.shrink_to_fit();
            s.unique_keys.shrink_to_fit();
            s.active_groups.shrink_to_fit();
        }

        // Shrink processing shards
        for shard in &self.processing_shards {
            shard.write().shrink_to_fit();
        }

        // Shrink other structures
        self.completed_jobs.write().shrink_to_fit();
        self.job_results.write().shrink_to_fit();
        self.job_logs.write().shrink_to_fit();
        self.stalled_count.write().shrink_to_fit();
        self.custom_id_map.write().shrink_to_fit();
        self.completed_retention.write().shrink_to_fit();
        self.job_waiters.write().shrink_to_fit();
    }

    pub(crate) async fn run_cron_jobs(&self) {
        let now = Self::now_ms();
        let mut to_run = Vec::new();
        let mut next_run_updates = Vec::new();
        let mut to_remove = Vec::new();

        {
            let mut crons = self.cron_jobs.write();
            for cron in crons.values_mut() {
                if cron.next_run <= now {
                    if let Some(limit) = cron.limit {
                        if cron.executions >= limit {
                            to_remove.push(cron.name.clone());
                            continue;
                        }
                    }

                    to_run.push((cron.queue.clone(), cron.data.clone(), cron.priority));
                    cron.executions += 1;

                    let new_next_run = if let Some(interval) = cron.repeat_every {
                        now + interval
                    } else if let Some(ref schedule) = cron.schedule {
                        Self::parse_next_cron_run(schedule, now)
                    } else {
                        now + 60_000
                    };
                    cron.next_run = new_next_run;
                    next_run_updates.push((cron.name.clone(), new_next_run));
                }
            }

            for name in &to_remove {
                crons.remove(name);
            }
        }

        for (name, next_run) in next_run_updates {
            self.persist_cron_next_run(&name, next_run);
        }

        for name in to_remove {
            self.persist_cron_delete(&name);
        }

        for (queue, data, priority) in to_run {
            let input = crate::protocol::JobInput::new(data).with_priority(priority);
            let _ = self.push(queue, input).await;
        }
    }

    pub(crate) fn parse_next_cron_run(schedule: &str, now: u64) -> u64 {
        if let Some(interval_str) = schedule.strip_prefix("*/") {
            if let Ok(secs) = interval_str.parse::<u64>() {
                return now + secs * 1000;
            }
        }

        if let Ok(cron) = Cron::new(schedule).with_seconds_optional().parse() {
            let now_secs = (now / 1000) as i64;
            if let Some(now_dt) = DateTime::<Utc>::from_timestamp(now_secs, 0) {
                if let Ok(next) = cron.find_next_occurrence(&now_dt, false) {
                    return (next.timestamp() as u64) * 1000;
                }
            }
        }

        now + 60_000
    }

    const MAX_CRON_SCHEDULE_LENGTH: usize = 256;

    pub(crate) fn validate_cron(schedule: &str) -> Result<(), String> {
        if schedule.len() > Self::MAX_CRON_SCHEDULE_LENGTH {
            return Err(format!(
                "Cron schedule too long ({} chars, max {} chars)",
                schedule.len(),
                Self::MAX_CRON_SCHEDULE_LENGTH
            ));
        }

        if let Some(interval_str) = schedule.strip_prefix("*/") {
            return interval_str
                .parse::<u64>()
                .map(|_| ())
                .map_err(|_| format!("Invalid interval format: {}", schedule));
        }

        Cron::new(schedule)
            .with_seconds_optional()
            .parse()
            .map(|_| ())
            .map_err(|e| format!("Invalid cron expression '{}': {}", schedule, e))
    }
}
