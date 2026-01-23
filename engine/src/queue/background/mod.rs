//! Background tasks for flashQ (cleanup, cron, timeouts, snapshots).
//!
//! Module organization:
//! - `cleanup.rs` - Job and memory cleanup tasks
//! - `cron.rs` - Cron job execution
//! - `timeout.rs` - Timeout and dependency checking
//! - `snapshot.rs` - Snapshot persistence

mod cleanup;
mod cron;
mod snapshot;
mod timeout;

use std::sync::Arc;

use tokio::time::{interval, Duration};
use tracing::info;

use super::manager::QueueManager;

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
                    self.run_cleanup_tasks();
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

    /// Run all cleanup tasks
    fn run_cleanup_tasks(&self) {
        use super::types::cleanup_interned_strings;

        self.cleanup_completed_jobs();
        self.cleanup_job_results();
        self.cleanup_job_logs();
        self.cleanup_stale_index_entries();
        self.cleanup_debounce_cache();
        self.cleanup_expired_kv();
        self.cleanup_completed_retention();
        self.cleanup_webhook_circuits();
        cleanup_interned_strings();
        self.shrink_memory_buffers();
    }
}
