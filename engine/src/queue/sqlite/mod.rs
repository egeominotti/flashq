//! SQLite storage layer for flashQ persistence.
//!
//! Embedded, zero-dependency persistence with:
//! - WAL mode for durability
//! - Async write queue for maximum throughput
//! - Configurable snapshot intervals
//! - S3-compatible backup support (AWS S3, Cloudflare R2, MinIO)

mod async_writer;
mod backup;
mod jobs;
mod jobs_advanced;
mod migration;
mod snapshot;

#[cfg(test)]
mod tests;

use parking_lot::Mutex;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::info;

use crate::protocol::{CronJob, Job, WebhookConfig};
use serde_json::Value;

pub use async_writer::{AsyncWriter, AsyncWriterConfig, WriteOp};
pub use backup::{
    clear_runtime_s3_config, get_runtime_s3_config, set_runtime_s3_config, S3BackupConfig,
    S3BackupManager,
};
pub use jobs_advanced::PersistedQueueState;
pub use snapshot::SnapshotManager;

/// SQLite storage configuration
#[derive(Debug, Clone)]
pub struct SqliteConfig {
    /// Path to the database file
    pub path: PathBuf,
    /// Enable WAL mode (recommended)
    pub wal_mode: bool,
    /// Synchronous mode: 0=OFF, 1=NORMAL, 2=FULL
    pub synchronous: i32,
    /// Cache size in pages (negative = KB)
    pub cache_size: i32,
}

impl Default for SqliteConfig {
    fn default() -> Self {
        Self {
            path: PathBuf::from("flashq.db"),
            wal_mode: true,
            synchronous: 1,     // NORMAL - good balance of safety and speed
            cache_size: -64000, // 64MB cache
        }
    }
}

impl SqliteConfig {
    /// Create config from environment variables
    #[allow(dead_code)]
    pub fn from_env() -> Self {
        let path = std::env::var("DATA_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("flashq.db"));

        let synchronous = std::env::var("SQLITE_SYNCHRONOUS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1);

        let cache_size = std::env::var("SQLITE_CACHE_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(-64000);

        Self {
            path,
            wal_mode: true,
            synchronous,
            cache_size,
        }
    }
}

/// SQLite storage layer for flashQ persistence.
pub struct SqliteStorage {
    /// Database connection (protected by Mutex for thread safety)
    conn: Mutex<Connection>,
    /// Path to the database file
    pub path: PathBuf,
    /// Snapshot manager
    #[allow(dead_code)]
    snapshot_manager: Option<Arc<SnapshotManager>>,
    /// S3 backup manager
    #[allow(dead_code)]
    backup_manager: Option<Arc<S3BackupManager>>,
    /// Async writer for non-blocking persistence (optional)
    async_writer: Option<Arc<AsyncWriter>>,
}

impl SqliteStorage {
    /// Create a new SQLite storage connection.
    pub fn new(config: SqliteConfig) -> Result<Self, rusqlite::Error> {
        // Create parent directories if they don't exist
        if let Some(parent) = config.path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).ok();
            }
        }

        let conn = Connection::open(&config.path)?;

        // Configure SQLite for optimal performance
        conn.execute_batch(&format!(
            "PRAGMA journal_mode = {};
             PRAGMA synchronous = {};
             PRAGMA cache_size = {};
             PRAGMA temp_store = MEMORY;
             PRAGMA mmap_size = 268435456;
             PRAGMA page_size = 4096;",
            if config.wal_mode { "WAL" } else { "DELETE" },
            config.synchronous,
            config.cache_size,
        ))?;

        info!(path = %config.path.display(), "SQLite initialized");

        Ok(Self {
            conn: Mutex::new(conn),
            path: config.path,
            snapshot_manager: None,
            backup_manager: None,
            async_writer: None,
        })
    }

    /// Create with default configuration
    #[allow(dead_code)]
    pub fn default_config() -> Result<Self, rusqlite::Error> {
        Self::new(SqliteConfig::from_env())
    }

    /// Set snapshot manager
    #[allow(dead_code)]
    pub fn with_snapshot_manager(mut self, manager: Arc<SnapshotManager>) -> Self {
        self.snapshot_manager = Some(manager);
        self
    }

    /// Set S3 backup manager
    #[allow(dead_code)]
    pub fn with_backup_manager(mut self, manager: Arc<S3BackupManager>) -> Self {
        self.backup_manager = Some(manager);
        self
    }

    /// Enable async writer for non-blocking persistence.
    /// Returns the async writer handle that must be started.
    pub fn enable_async_writer(&mut self, config: AsyncWriterConfig) -> Arc<AsyncWriter> {
        let writer = AsyncWriter::new(self.path.clone(), config);
        self.async_writer = Some(Arc::clone(&writer));
        info!("Async writer enabled");
        writer
    }

    /// Get async writer if enabled.
    pub fn async_writer(&self) -> Option<&Arc<AsyncWriter>> {
        self.async_writer.as_ref()
    }

    /// Check if async writer is enabled.
    #[allow(dead_code)]
    pub fn has_async_writer(&self) -> bool {
        self.async_writer.is_some()
    }

    /// Run database migrations
    pub fn migrate(&self) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        migration::migrate(&conn)
    }

    // ============== Job Operations ==============
    // These methods use async writer when enabled for non-blocking writes.

    /// Insert or update a job (async if writer enabled, falls back to sync if queue full)
    pub fn insert_job(&self, job: &Job, state: &str) -> Result<(), rusqlite::Error> {
        if let Some(ref writer) = self.async_writer {
            if writer.queue_op(WriteOp::InsertJob {
                job: Box::new(job.clone()),
                state: state.to_string(),
            }) {
                return Ok(());
            }
            // Fallback to sync if queue full
        }
        let conn = self.conn.lock();
        jobs::insert_job(&conn, job, state)
    }

    /// Insert multiple jobs in a batch (async if writer enabled, falls back to sync if queue full)
    pub fn insert_jobs_batch(&self, jobs: &[Job], state: &str) -> Result<(), rusqlite::Error> {
        if let Some(ref writer) = self.async_writer {
            if writer.queue_op(WriteOp::InsertJobsBatch {
                jobs: jobs.to_vec(),
                state: state.to_string(),
            }) {
                return Ok(());
            }
        }
        let conn = self.conn.lock();
        jobs::insert_jobs_batch(&conn, jobs, state)
    }

    /// Acknowledge a job as completed (async if writer enabled, falls back to sync if queue full)
    pub fn ack_job(&self, job_id: u64, result: Option<Value>) -> Result<(), rusqlite::Error> {
        if let Some(ref writer) = self.async_writer {
            if writer.queue_op(WriteOp::AckJob {
                job_id,
                result: result.clone(),
            }) {
                return Ok(());
            }
        }
        let conn = self.conn.lock();
        jobs::ack_job(&conn, job_id, result)
    }

    /// Acknowledge multiple jobs in a batch (async if writer enabled, falls back to sync if queue full)
    pub fn ack_jobs_batch(&self, ids: &[u64]) -> Result<(), rusqlite::Error> {
        if let Some(ref writer) = self.async_writer {
            if writer.queue_op(WriteOp::AckJobsBatch { ids: ids.to_vec() }) {
                return Ok(());
            }
        }
        let conn = self.conn.lock();
        jobs::ack_jobs_batch(&conn, ids)
    }

    /// Delete a job without storing result (for remove_on_complete)
    pub fn delete_job(&self, job_id: u64) -> Result<(), rusqlite::Error> {
        // Use cancel operation which just deletes the job
        if let Some(ref writer) = self.async_writer {
            if writer.queue_op(WriteOp::CancelJob { job_id }) {
                return Ok(());
            }
        }
        let conn = self.conn.lock();
        jobs::delete_job(&conn, job_id)
    }

    /// Delete multiple jobs without storing results (for remove_on_complete batch)
    pub fn delete_jobs_batch(&self, ids: &[u64]) -> Result<(), rusqlite::Error> {
        if ids.is_empty() {
            return Ok(());
        }
        // Use AckJobsBatch which just deletes without storing results
        if let Some(ref writer) = self.async_writer {
            if writer.queue_op(WriteOp::AckJobsBatch { ids: ids.to_vec() }) {
                return Ok(());
            }
        }
        let conn = self.conn.lock();
        jobs::delete_jobs_batch(&conn, ids)
    }

    /// Mark job as failed and update for retry (async if writer enabled, falls back to sync if queue full)
    pub fn fail_job(
        &self,
        job_id: u64,
        new_run_at: u64,
        attempts: u32,
    ) -> Result<(), rusqlite::Error> {
        if let Some(ref writer) = self.async_writer {
            if writer.queue_op(WriteOp::FailJob {
                job_id,
                new_run_at,
                attempts,
            }) {
                return Ok(());
            }
        }
        let conn = self.conn.lock();
        jobs::fail_job(&conn, job_id, new_run_at, attempts)
    }

    /// Move job to DLQ (async if writer enabled, falls back to sync if queue full)
    pub fn move_to_dlq(&self, job: &Job, error: Option<&str>) -> Result<(), rusqlite::Error> {
        if let Some(ref writer) = self.async_writer {
            if writer.queue_op(WriteOp::MoveToDlq {
                job: Box::new(job.clone()),
                error: error.map(String::from),
            }) {
                return Ok(());
            }
        }
        let conn = self.conn.lock();
        jobs::move_to_dlq(&conn, job, error)
    }

    /// Cancel a job (async if writer enabled, falls back to sync if queue full)
    pub fn cancel_job(&self, job_id: u64) -> Result<(), rusqlite::Error> {
        if let Some(ref writer) = self.async_writer {
            if writer.queue_op(WriteOp::CancelJob { job_id }) {
                return Ok(());
            }
        }
        let conn = self.conn.lock();
        jobs::cancel_job(&conn, job_id)
    }

    /// Load all pending jobs for recovery
    pub fn load_pending_jobs(&self) -> Result<Vec<(Job, String)>, rusqlite::Error> {
        let conn = self.conn.lock();
        jobs::load_pending_jobs(&conn)
    }

    /// Load DLQ jobs
    pub fn load_dlq_jobs(&self) -> Result<Vec<Job>, rusqlite::Error> {
        let conn = self.conn.lock();
        jobs::load_dlq_jobs(&conn)
    }

    /// Get the maximum job ID (for recovery)
    pub fn get_max_job_id(&self) -> Result<u64, rusqlite::Error> {
        let conn = self.conn.lock();
        jobs::get_max_job_id(&conn)
    }

    /// Load custom_id mappings for recovery
    pub fn load_custom_id_map(&self) -> Result<Vec<(u64, String)>, rusqlite::Error> {
        let conn = self.conn.lock();
        jobs::load_custom_id_map(&conn)
    }

    /// Load job results for recovery (limited to prevent OOM)
    pub fn load_job_results(
        &self,
        limit: usize,
    ) -> Result<Vec<(u64, serde_json::Value)>, rusqlite::Error> {
        let conn = self.conn.lock();
        jobs::load_job_results(&conn, limit)
    }

    /// Load completed job IDs for dependency tracking recovery (limited to prevent OOM)
    pub fn load_completed_job_ids(&self, limit: usize) -> Result<Vec<u64>, rusqlite::Error> {
        let conn = self.conn.lock();
        jobs::load_completed_job_ids(&conn, limit)
    }

    // ============== Cron Jobs ==============

    /// Save a cron job
    pub fn save_cron(&self, cron: &CronJob) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::save_cron(&conn, cron)
    }

    /// Delete a cron job
    pub fn delete_cron(&self, name: &str) -> Result<bool, rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::delete_cron(&conn, name)
    }

    /// Load all cron jobs
    pub fn load_crons(&self) -> Result<Vec<CronJob>, rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::load_crons(&conn)
    }

    /// Update cron next_run time
    pub fn update_cron_next_run(&self, name: &str, next_run: u64) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::update_cron_next_run(&conn, name, next_run)
    }

    // ============== Webhooks ==============

    /// Save a webhook
    pub fn save_webhook(&self, webhook: &WebhookConfig) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::save_webhook(&conn, webhook)
    }

    /// Delete a webhook
    pub fn delete_webhook(&self, id: &str) -> Result<bool, rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::delete_webhook(&conn, id)
    }

    /// Load all webhooks
    pub fn load_webhooks(&self) -> Result<Vec<WebhookConfig>, rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::load_webhooks(&conn)
    }

    // ============== Advanced Operations ==============

    /// Drain all waiting jobs from a queue
    pub fn drain_queue(&self, queue: &str) -> Result<u64, rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::drain_queue(&conn, queue)
    }

    /// Obliterate all data for a queue
    pub fn obliterate_queue(&self, queue: &str) -> Result<u64, rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::obliterate_queue(&conn, queue)
    }

    /// Change priority of a job
    pub fn change_priority(&self, job_id: u64, priority: i32) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::change_priority(&conn, job_id, priority)
    }

    /// Move a job to delayed state
    pub fn move_to_delayed(&self, job_id: u64, run_at: u64) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::move_to_delayed(&conn, job_id, run_at)
    }

    /// Promote a delayed job to waiting
    pub fn promote_job(&self, job_id: u64, run_at: u64) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::promote_job(&conn, job_id, run_at)
    }

    /// Update job data
    pub fn update_job_data(&self, job_id: u64, data: &Value) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::update_job_data(&conn, job_id, data)
    }

    /// Clean jobs by age and state
    pub fn clean_jobs(
        &self,
        queue: &str,
        cutoff: u64,
        state: &str,
    ) -> Result<u64, rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::clean_jobs(&conn, queue, cutoff, state)
    }

    /// Discard a job (move to DLQ)
    pub fn discard_job(&self, job_id: u64) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::discard_job(&conn, job_id)
    }

    /// Purge all DLQ entries for a queue
    pub fn purge_dlq(&self, queue: &str) -> Result<u64, rusqlite::Error> {
        let conn = self.conn.lock();
        let rows = conn.execute(
            "DELETE FROM dlq_jobs WHERE queue = ?1",
            rusqlite::params![queue],
        )?;
        Ok(rows as u64)
    }

    // ============== Snapshot Operations ==============

    /// Take a snapshot of all jobs
    #[allow(dead_code)]
    pub fn snapshot_all(
        &self,
        jobs: &[(Job, String)],
        dlq_jobs: &[(Job, Option<String>)],
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        snapshot::snapshot_all(&conn, jobs, dlq_jobs)
    }

    /// Create a backup file
    pub fn create_backup(&self, backup_path: &std::path::Path) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        snapshot::create_backup(&conn, backup_path)
    }

    /// Create a timestamped snapshot in the same directory
    pub fn create_snapshot(&self) -> Result<(), String> {
        let snapshot_dir = self
            .path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."));
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let snapshot_name = format!("flashq_snapshot_{}.db", timestamp);
        let snapshot_path = snapshot_dir.join(&snapshot_name);

        self.create_backup(&snapshot_path)
            .map_err(|e| format!("Snapshot failed: {}", e))?;

        info!(path = ?snapshot_path, "Snapshot created");
        Ok(())
    }

    /// Trigger S3 backup if configured
    #[allow(dead_code)]
    pub async fn trigger_s3_backup(&self) -> Result<(), String> {
        if let Some(ref manager) = self.backup_manager {
            manager.backup(&self.path).await
        } else {
            Ok(())
        }
    }

    /// Get snapshot manager
    #[allow(dead_code)]
    pub fn snapshot_manager(&self) -> Option<&Arc<SnapshotManager>> {
        self.snapshot_manager.as_ref()
    }

    /// Get backup manager
    #[allow(dead_code)]
    pub fn backup_manager(&self) -> Option<&Arc<S3BackupManager>> {
        self.backup_manager.as_ref()
    }

    // ============== Queue State ==============

    /// Save queue state (pause, rate limit, concurrency)
    pub fn save_queue_state(
        &self,
        state: &jobs_advanced::PersistedQueueState,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::save_queue_state(&conn, state)
    }

    /// Load all queue states for recovery
    pub fn load_queue_states(
        &self,
    ) -> Result<Vec<jobs_advanced::PersistedQueueState>, rusqlite::Error> {
        let conn = self.conn.lock();
        jobs_advanced::load_queue_states(&conn)
    }
}
