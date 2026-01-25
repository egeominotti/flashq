//! Async Write Queue for SQLite persistence.
//!
//! Non-blocking writes with background batching for maximum throughput.
//! Trade-off: ~100ms window of potential data loss on crash.
//!
//! Uses MessagePack for data serialization (~37% smaller than JSON).

use parking_lot::Mutex;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;
use tracing::{debug, error, info, warn};

use crate::protocol::Job;

/// Serialize data to MessagePack bytes for storage.
/// Logs a warning if serialization fails (rare but possible with special values).
#[inline]
fn serialize_data(data: &Value) -> Vec<u8> {
    rmp_serde::to_vec(data).unwrap_or_else(|e| {
        warn!(error = %e, "Failed to serialize job data to MessagePack, using empty");
        Vec::new()
    })
}

/// Serialize a vector to JSON string if not empty, otherwise return None.
/// Used for small arrays (depends_on, tags, children_ids) where JSON is fine.
#[inline]
fn serialize_if_not_empty<T: Serialize>(v: &[T]) -> Option<String> {
    if v.is_empty() {
        None
    } else {
        Some(serde_json::to_string(v).unwrap_or_default())
    }
}

/// Write operation types for the async queue.
#[derive(Debug)]
#[allow(dead_code)]
pub enum WriteOp {
    /// Insert or update a job
    InsertJob { job: Box<Job>, state: String },
    /// Insert multiple jobs in batch
    InsertJobsBatch { jobs: Vec<Job>, state: String },
    /// Acknowledge job completion
    AckJob { job_id: u64, result: Option<Value> },
    /// Acknowledge multiple jobs
    AckJobsBatch { ids: Vec<u64> },
    /// Fail job (for retry)
    FailJob {
        job_id: u64,
        new_run_at: u64,
        attempts: u32,
    },
    /// Move job to DLQ
    MoveToDlq {
        job: Box<Job>,
        error: Option<String>,
    },
    /// Cancel a job
    CancelJob { job_id: u64 },
    /// Update job state
    UpdateState { job_id: u64, state: String },
    /// Update job progress
    UpdateProgress {
        job_id: u64,
        progress: u8,
        message: Option<String>,
    },
    /// Change job priority
    ChangePriority { job_id: u64, priority: i32 },
    /// Flush all pending writes (for graceful shutdown)
    Flush,
}

/// Configuration for the async writer.
#[derive(Debug, Clone)]
pub struct AsyncWriterConfig {
    /// Batch interval in milliseconds (default: 50ms)
    pub batch_interval_ms: u64,
    /// Maximum batch size before forced flush (default: 1000)
    pub max_batch_size: usize,
    /// Queue capacity (default: 100_000)
    pub queue_capacity: usize,
}

impl Default for AsyncWriterConfig {
    fn default() -> Self {
        Self {
            batch_interval_ms: 50,
            max_batch_size: 5_000,
            queue_capacity: 100_000,
        }
    }
}

/// Statistics for the async writer.
#[derive(Debug, Default)]
pub struct AsyncWriterStats {
    pub ops_queued: AtomicU64,
    pub ops_written: AtomicU64,
    pub batches_written: AtomicU64,
    pub queue_high_water: AtomicU64,
}

/// Async Write Queue for non-blocking SQLite persistence.
pub struct AsyncWriter {
    /// Write queue
    queue: Mutex<VecDeque<WriteOp>>,
    /// Notify when new ops are added
    notify: Notify,
    /// Database path
    db_path: PathBuf,
    /// Configuration (initial values)
    #[allow(dead_code)]
    config: AsyncWriterConfig,
    /// Runtime batch interval (atomic for runtime changes)
    batch_interval_ms: AtomicU64,
    /// Runtime max batch size (atomic for runtime changes)
    max_batch_size: AtomicUsize,
    /// Statistics
    stats: Arc<AsyncWriterStats>,
    /// Running flag
    running: AtomicBool,
    /// Shutdown complete notify
    shutdown_complete: Notify,
}

impl AsyncWriter {
    /// Create a new async writer.
    pub fn new(db_path: PathBuf, config: AsyncWriterConfig) -> Arc<Self> {
        Arc::new(Self {
            queue: Mutex::new(VecDeque::with_capacity(config.queue_capacity)),
            notify: Notify::new(),
            db_path,
            batch_interval_ms: AtomicU64::new(config.batch_interval_ms),
            max_batch_size: AtomicUsize::new(config.max_batch_size),
            config,
            stats: Arc::new(AsyncWriterStats::default()),
            running: AtomicBool::new(true),
            shutdown_complete: Notify::new(),
        })
    }

    /// Queue a write operation (non-blocking).
    /// Returns false if queue is full (backpressure), caller should retry or use sync path.
    #[inline]
    pub fn queue_op(&self, op: WriteOp) -> bool {
        let mut queue = self.queue.lock();

        // Backpressure: reject if queue is full
        let capacity = self.config.queue_capacity;
        if queue.len() >= capacity {
            drop(queue);
            warn!(
                capacity = capacity,
                "Async writer queue full, backpressure applied"
            );
            return false;
        }

        // Warn at 80% capacity
        let len = queue.len();
        if len > 0 && len == capacity * 8 / 10 {
            warn!(
                len = len,
                capacity = capacity,
                "Async writer queue at 80% capacity"
            );
        }

        queue.push_back(op);

        let len = queue.len() as u64;
        self.stats.ops_queued.fetch_add(1, Ordering::Relaxed);

        // Update high water mark
        let current_high = self.stats.queue_high_water.load(Ordering::Relaxed);
        if len > current_high {
            self.stats.queue_high_water.store(len, Ordering::Relaxed);
        }

        drop(queue);

        // Notify if batch size reached
        if len >= self.max_batch_size.load(Ordering::Relaxed) as u64 {
            self.notify.notify_one();
        }

        true
    }

    /// Queue multiple operations at once.
    #[inline]
    #[allow(dead_code)]
    pub fn queue_ops(&self, ops: impl IntoIterator<Item = WriteOp>) {
        let mut queue = self.queue.lock();
        let mut count = 0u64;
        for op in ops {
            queue.push_back(op);
            count += 1;
        }
        self.stats.ops_queued.fetch_add(count, Ordering::Relaxed);
        drop(queue);
        self.notify.notify_one();
    }

    /// Get current queue length.
    pub fn queue_len(&self) -> usize {
        self.queue.lock().len()
    }

    /// Get statistics.
    pub fn stats(&self) -> &Arc<AsyncWriterStats> {
        &self.stats
    }

    /// Get configuration.
    #[allow(dead_code)]
    pub fn config(&self) -> &AsyncWriterConfig {
        &self.config
    }

    /// Get current batch interval in milliseconds.
    pub fn get_batch_interval_ms(&self) -> u64 {
        self.batch_interval_ms.load(Ordering::Relaxed)
    }

    /// Get current max batch size.
    pub fn get_max_batch_size(&self) -> usize {
        self.max_batch_size.load(Ordering::Relaxed)
    }

    /// Set batch interval (takes effect immediately on next batch).
    pub fn set_batch_interval_ms(&self, interval_ms: u64) {
        let old = self.batch_interval_ms.swap(interval_ms, Ordering::SeqCst);
        info!(
            old_interval = old,
            new_interval = interval_ms,
            "Async writer batch interval updated"
        );
    }

    /// Set max batch size (takes effect immediately on next batch).
    pub fn set_max_batch_size(&self, size: usize) {
        let old = self.max_batch_size.swap(size, Ordering::SeqCst);
        info!(
            old_size = old,
            new_size = size,
            "Async writer max batch size updated"
        );
    }

    /// Request flush and wait for completion.
    #[allow(dead_code)]
    pub async fn flush(&self) {
        self.queue_op(WriteOp::Flush);
        self.notify.notify_one();
        // Wait a bit for flush to complete
        let interval = self.batch_interval_ms.load(Ordering::Relaxed);
        tokio::time::sleep(Duration::from_millis(interval * 2)).await;
    }

    /// Shutdown the writer gracefully.
    /// Waits up to 30 seconds for all pending writes to be flushed.
    #[allow(dead_code)]
    pub async fn shutdown(&self) {
        self.running.store(false, Ordering::SeqCst);
        self.notify.notify_one();

        // Wait for shutdown with generous timeout for large queues
        tokio::select! {
            _ = self.shutdown_complete.notified() => {
                info!("Async writer shutdown complete");
            }
            _ = tokio::time::sleep(Duration::from_secs(30)) => {
                warn!("Async writer shutdown timeout after 30s");
            }
        }
    }

    /// Start the background writer task.
    pub fn start(self: &Arc<Self>) -> tokio::task::JoinHandle<()> {
        let writer = Arc::clone(self);
        tokio::spawn(async move {
            writer.run_writer_loop().await;
        })
    }

    /// Main writer loop.
    async fn run_writer_loop(&self) {
        let initial_batch_size = self.max_batch_size.load(Ordering::Relaxed);

        // Open dedicated connection for writing
        let conn = match Connection::open(&self.db_path) {
            Ok(c) => c,
            Err(e) => {
                error!(error = %e, "Failed to open SQLite connection for async writer");
                return;
            }
        };

        // Configure for maximum write performance
        if let Err(e) = conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = OFF;
             PRAGMA cache_size = -64000;
             PRAGMA temp_store = MEMORY;
             PRAGMA wal_autocheckpoint = 1000;",
        ) {
            error!(error = %e, "Failed to configure SQLite pragmas");
        }

        let mut ops_buffer: Vec<WriteOp> = Vec::with_capacity(initial_batch_size);

        while self.running.load(Ordering::SeqCst) {
            // Read current config values (allows runtime changes)
            let batch_interval =
                Duration::from_millis(self.batch_interval_ms.load(Ordering::Relaxed));
            let max_batch = self.max_batch_size.load(Ordering::Relaxed);

            // Wait for notification or timeout
            tokio::select! {
                _ = self.notify.notified() => {}
                _ = tokio::time::sleep(batch_interval) => {}
            }

            // Drain queue into buffer
            {
                let mut queue = self.queue.lock();
                while let Some(op) = queue.pop_front() {
                    let is_flush = matches!(op, WriteOp::Flush);
                    ops_buffer.push(op);
                    if is_flush || ops_buffer.len() >= max_batch {
                        break;
                    }
                }
            }

            // Process batch
            if !ops_buffer.is_empty() {
                let batch_size = ops_buffer.len();
                if let Err(e) = self.process_batch(&conn, &mut ops_buffer) {
                    error!(error = %e, batch_size, "Failed to process write batch");
                } else {
                    self.stats
                        .ops_written
                        .fetch_add(batch_size as u64, Ordering::Relaxed);
                    self.stats.batches_written.fetch_add(1, Ordering::Relaxed);
                    debug!(batch_size, "Write batch committed");
                }
                ops_buffer.clear();
            }
        }

        // Final flush on shutdown
        {
            let mut queue = self.queue.lock();
            while let Some(op) = queue.pop_front() {
                ops_buffer.push(op);
            }
        }

        if !ops_buffer.is_empty() {
            let batch_size = ops_buffer.len();
            info!(batch_size, "Flushing remaining writes on shutdown");
            if let Err(e) = self.process_batch(&conn, &mut ops_buffer) {
                error!(error = %e, "Failed to flush on shutdown");
            }
        }

        // Checkpoint WAL
        if let Err(e) = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
            warn!(error = %e, "Failed to checkpoint WAL on shutdown");
        }

        self.shutdown_complete.notify_one();
    }

    /// Process a batch of operations in a single transaction.
    fn process_batch(
        &self,
        conn: &Connection,
        ops: &mut Vec<WriteOp>,
    ) -> Result<(), rusqlite::Error> {
        if ops.is_empty() {
            return Ok(());
        }

        let tx = conn.unchecked_transaction()?;

        for op in ops.drain(..) {
            match op {
                WriteOp::InsertJob { job, state } => {
                    self.exec_insert_job(&tx, &job, &state)?;
                }
                WriteOp::InsertJobsBatch { jobs, state } => {
                    for job in &jobs {
                        self.exec_insert_job(&tx, job, &state)?;
                    }
                }
                WriteOp::AckJob { job_id, result } => {
                    self.exec_ack_job(&tx, job_id, result)?;
                }
                WriteOp::AckJobsBatch { ids } => {
                    for id in ids {
                        tx.execute(
                            "DELETE FROM jobs WHERE id = ?1",
                            rusqlite::params![id as i64],
                        )?;
                    }
                }
                WriteOp::FailJob {
                    job_id,
                    new_run_at,
                    attempts,
                } => {
                    tx.execute(
                        "UPDATE jobs SET state = 'waiting', run_at = ?2, attempts = ?3, started_at = NULL WHERE id = ?1",
                        rusqlite::params![job_id as i64, new_run_at as i64, attempts],
                    )?;
                }
                WriteOp::MoveToDlq { job, error } => {
                    self.exec_move_to_dlq(&tx, &job, error.as_deref())?;
                }
                WriteOp::CancelJob { job_id } => {
                    tx.execute(
                        "DELETE FROM jobs WHERE id = ?1",
                        rusqlite::params![job_id as i64],
                    )?;
                }
                WriteOp::UpdateState { job_id, state } => {
                    tx.execute(
                        "UPDATE jobs SET state = ?2 WHERE id = ?1",
                        rusqlite::params![job_id as i64, state],
                    )?;
                }
                WriteOp::UpdateProgress {
                    job_id,
                    progress,
                    message,
                } => {
                    tx.execute(
                        "UPDATE jobs SET progress = ?2, progress_msg = ?3 WHERE id = ?1",
                        rusqlite::params![job_id as i64, progress as i32, message],
                    )?;
                }
                WriteOp::ChangePriority { job_id, priority } => {
                    tx.execute(
                        "UPDATE jobs SET priority = ?2 WHERE id = ?1",
                        rusqlite::params![job_id as i64, priority],
                    )?;
                }
                WriteOp::Flush => {
                    // Flush is handled by committing the transaction
                }
            }
        }

        tx.commit()
    }

    /// Execute insert job SQL.
    /// Data is serialized as MessagePack for ~37% smaller storage.
    fn exec_insert_job(
        &self,
        conn: &Connection,
        job: &Job,
        state: &str,
    ) -> Result<(), rusqlite::Error> {
        let data = serialize_data(&job.data);
        let depends_on = serialize_if_not_empty(&job.depends_on);
        let tags = serialize_if_not_empty(&job.tags);
        let children_ids = serialize_if_not_empty(&job.children_ids);

        conn.execute(
            "INSERT INTO jobs (id, queue, data, priority, created_at, run_at, started_at, attempts,
                max_attempts, backoff, ttl, timeout, unique_key, depends_on, progress, progress_msg, tags, state, lifo,
                custom_id, parent_id, children_ids, children_completed, group_id, keep_completed_age, keep_completed_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26)
             ON CONFLICT(id) DO UPDATE SET
                state = excluded.state,
                run_at = excluded.run_at,
                started_at = excluded.started_at,
                attempts = excluded.attempts,
                progress = excluded.progress,
                progress_msg = excluded.progress_msg,
                children_completed = excluded.children_completed",
            rusqlite::params![
                job.id as i64,
                job.queue,
                data,
                job.priority,
                job.created_at as i64,
                job.run_at as i64,
                if job.started_at > 0 { Some(job.started_at as i64) } else { None },
                job.attempts,
                job.max_attempts,
                job.backoff as i64,
                if job.ttl > 0 { Some(job.ttl as i64) } else { None },
                if job.timeout > 0 { Some(job.timeout as i64) } else { None },
                job.unique_key,
                depends_on,
                job.progress as i32,
                job.progress_msg,
                tags,
                state,
                job.lifo as i32,
                job.custom_id,
                job.parent_id.map(|id| id as i64),
                children_ids,
                job.children_completed as i32,
                job.group_id,
                job.keep_completed_age as i64,
                job.keep_completed_count as i32,
            ],
        )?;
        Ok(())
    }

    /// Execute ack job SQL.
    /// Result is serialized as MessagePack for smaller storage.
    fn exec_ack_job(
        &self,
        conn: &Connection,
        job_id: u64,
        result: Option<Value>,
    ) -> Result<(), rusqlite::Error> {
        let now = crate::queue::types::now_ms();
        conn.execute(
            "DELETE FROM jobs WHERE id = ?1",
            rusqlite::params![job_id as i64],
        )?;
        if let Some(res) = result {
            let result_bytes = serialize_data(&res);
            conn.execute(
                "INSERT OR REPLACE INTO job_results (job_id, result, completed_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![job_id as i64, result_bytes, now as i64],
            )?;
        }
        Ok(())
    }

    /// Execute move to DLQ SQL.
    /// Data is serialized as MessagePack for smaller storage.
    fn exec_move_to_dlq(
        &self,
        conn: &Connection,
        job: &Job,
        error: Option<&str>,
    ) -> Result<(), rusqlite::Error> {
        let now = crate::queue::types::now_ms();
        let data = serialize_data(&job.data);
        conn.execute(
            "DELETE FROM jobs WHERE id = ?1",
            rusqlite::params![job.id as i64],
        )?;
        conn.execute(
            "INSERT INTO dlq_jobs (job_id, queue, data, error, failed_at, attempts) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![job.id as i64, job.queue, data, error, now as i64, job.attempts],
        )?;
        Ok(())
    }
}
