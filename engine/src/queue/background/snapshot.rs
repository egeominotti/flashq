//! Snapshot persistence using SQLite's backup API.

use std::sync::atomic::Ordering;

use tracing::{error, info};

use super::super::manager::QueueManager;
use super::super::types::now_ms;

impl QueueManager {
    /// Check if snapshot should be taken and execute it.
    pub(crate) async fn maybe_snapshot(&self) {
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
}
