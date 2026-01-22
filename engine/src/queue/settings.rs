//! Server management and runtime settings.
//!
//! Reset, cleanup, and runtime configuration.

use super::manager::{CleanupSettings, QueueDefaults, QueueManager};

impl QueueManager {
    // ============== Server Management ==============

    /// Reset all server memory - clears all queues, jobs, DLQ, metrics, etc.
    pub async fn reset(&self) {
        // Clear all shards
        for shard in self.shards.iter() {
            let mut shard = shard.write();
            shard.queues.clear();
            shard.dlq.clear();
            shard.unique_keys.clear();
            shard.waiting_deps.clear();
            shard.waiting_children.clear();
            shard.queue_state.clear();
        }

        // Clear global structures (sharded processing)
        for shard in &self.processing_shards {
            shard.write().clear();
        }
        self.cron_jobs.write().clear();
        self.completed_jobs.write().clear();
        self.job_results.write().clear();

        // Clear job index (DashMap)
        self.job_index.clear();

        // Clear workers
        self.workers.write().clear();

        // Clear metrics history
        self.metrics_history.write().clear();

        // Clear job logs
        self.job_logs.write().clear();

        // Clear stalled count
        self.stalled_count.write().clear();

        // Clear debounce cache
        self.debounce_cache.write().clear();

        // Clear custom ID map
        self.custom_id_map.write().clear();

        // Clear job waiters
        self.job_waiters.write().clear();

        // Clear completed retention
        self.completed_retention.write().clear();

        // Reset metrics counters
        self.metrics
            .total_pushed
            .store(0, std::sync::atomic::Ordering::Relaxed);
        self.metrics
            .total_completed
            .store(0, std::sync::atomic::Ordering::Relaxed);
        self.metrics
            .total_failed
            .store(0, std::sync::atomic::Ordering::Relaxed);
        self.metrics
            .total_timed_out
            .store(0, std::sync::atomic::Ordering::Relaxed);
    }

    /// Clear all queues (waiting jobs only).
    pub async fn clear_all_queues(&self) -> u64 {
        let mut total = 0u64;
        for shard in self.shards.iter() {
            let mut shard = shard.write();
            for queue in shard.queues.values_mut() {
                total += queue.len() as u64;
                queue.clear();
            }
        }
        self.job_index.clear();
        total
    }

    /// Clear all DLQ.
    pub async fn clear_all_dlq(&self) -> u64 {
        let mut total = 0u64;
        for shard in self.shards.iter() {
            let mut shard = shard.write();
            for dlq in shard.dlq.values_mut() {
                total += dlq.len() as u64;
                dlq.clear();
            }
        }
        total
    }

    /// Clear completed jobs.
    pub async fn clear_completed_jobs(&self) -> u64 {
        let total = self.completed_jobs.read().len() as u64;
        self.completed_jobs.write().clear();
        self.job_results.write().clear();
        self.completed_retention.write().clear();
        total
    }

    /// Reset metrics.
    pub async fn reset_metrics(&self) {
        self.metrics
            .total_pushed
            .store(0, std::sync::atomic::Ordering::Relaxed);
        self.metrics
            .total_completed
            .store(0, std::sync::atomic::Ordering::Relaxed);
        self.metrics
            .total_failed
            .store(0, std::sync::atomic::Ordering::Relaxed);
        self.metrics
            .total_timed_out
            .store(0, std::sync::atomic::Ordering::Relaxed);
        self.metrics_history.write().clear();
    }

    // ============== Runtime Settings ==============

    /// Set auth tokens at runtime.
    pub fn set_auth_tokens(&self, tokens: Vec<String>) {
        let mut auth = self.auth_tokens.write();
        auth.clear();
        for token in tokens {
            if !token.is_empty() {
                auth.insert(token);
            }
        }
    }

    /// Set queue defaults at runtime.
    pub fn set_queue_defaults(
        &self,
        timeout: Option<u64>,
        max_attempts: Option<u32>,
        backoff: Option<u64>,
        ttl: Option<u64>,
    ) {
        let mut defaults = self.queue_defaults.write();
        defaults.timeout = timeout;
        defaults.max_attempts = max_attempts;
        defaults.backoff = backoff;
        defaults.ttl = ttl;
    }

    /// Get queue defaults.
    #[allow(dead_code)]
    pub fn get_queue_defaults(&self) -> QueueDefaults {
        self.queue_defaults.read().clone()
    }

    /// Set cleanup settings at runtime.
    pub fn set_cleanup_settings(
        &self,
        max_completed_jobs: Option<usize>,
        max_job_results: Option<usize>,
        cleanup_interval_secs: Option<u64>,
        metrics_history_size: Option<usize>,
    ) {
        let mut settings = self.cleanup_settings.write();
        if let Some(v) = max_completed_jobs {
            settings.max_completed_jobs = v;
        }
        if let Some(v) = max_job_results {
            settings.max_job_results = v;
        }
        if let Some(v) = cleanup_interval_secs {
            settings.cleanup_interval_secs = v;
        }
        if let Some(v) = metrics_history_size {
            settings.metrics_history_size = v;
        }
    }

    /// Get cleanup settings.
    #[allow(dead_code)]
    pub fn get_cleanup_settings(&self) -> CleanupSettings {
        self.cleanup_settings.read().clone()
    }

    /// Run cleanup immediately.
    pub fn run_cleanup(&self) {
        let settings = self.cleanup_settings.read().clone();

        // Cleanup completed jobs
        let mut completed = self.completed_jobs.write();
        if completed.len() > settings.max_completed_jobs {
            let to_remove = completed.len() - settings.max_completed_jobs / 2;
            let ids: Vec<_> = completed.iter().take(to_remove).copied().collect();
            for id in ids {
                completed.remove(&id);
            }
        }

        // Cleanup job results
        let mut results = self.job_results.write();
        if results.len() > settings.max_job_results {
            let to_remove = results.len() - settings.max_job_results / 2;
            let ids: Vec<_> = results.keys().take(to_remove).copied().collect();
            for id in ids {
                results.remove(&id);
            }
        }

        // Cleanup job index (DashMap - iterate and remove)
        let index_len = self.job_index.len();
        if index_len > 100000 {
            let to_remove = index_len - 50000;
            let ids: Vec<_> = self
                .job_index
                .iter()
                .take(to_remove)
                .map(|r| *r.key())
                .collect();
            for id in ids {
                self.job_index.remove(&id);
            }
        }
    }

    /// Get TCP connection count.
    pub fn connection_count(&self) -> usize {
        self.tcp_connection_count
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Increment TCP connection count.
    #[allow(dead_code)]
    pub fn increment_connections(&self) {
        self.tcp_connection_count
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    /// Decrement TCP connection count.
    #[allow(dead_code)]
    pub fn decrement_connections(&self) {
        self.tcp_connection_count
            .fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
    }
}
