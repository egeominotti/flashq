//! Core QueueManager struct and constructors.
//!
//! Simplified single-node implementation with SQLite persistence.

use std::collections::VecDeque;
use std::hash::{BuildHasherDefault, Hash, Hasher};
use std::sync::Arc;

use dashmap::DashMap;
use gxhash::GxHasher;
use parking_lot::RwLock;
use serde_json::Value;

use super::sqlite::{S3BackupManager, SqliteConfig, SqliteStorage};
use super::types::{
    init_coarse_time, intern, now_ms, CircuitBreakerConfig, CircuitBreakerEntry, GlobalMetrics,
    GxHashMap, GxHashSet, JobLocation, Shard, Subscriber, Webhook, Worker,
};

/// Type alias for DashMap with GxHash for lock-free job index
pub type JobIndexMap = DashMap<u64, JobLocation, BuildHasherDefault<GxHasher>>;

/// Type alias for sharded processing maps
pub type ProcessingShard = RwLock<GxHashMap<u64, Job>>;

use crate::protocol::{set_id_counter, CronJob, Job, JobEvent, JobLogEntry, MetricsHistoryPoint};
use tokio::sync::broadcast;
use tracing::{error, info};

pub const NUM_SHARDS: usize = 32;

/// Constant-time byte slice comparison to prevent timing attacks.
#[inline]
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut result = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        result |= x ^ y;
    }
    result == 0
}

pub struct QueueManager {
    pub(crate) shards: Vec<RwLock<Shard>>,
    pub(crate) processing_shards: Vec<ProcessingShard>,
    pub(crate) storage: Option<Arc<SqliteStorage>>,
    pub(crate) cron_jobs: RwLock<GxHashMap<String, CronJob>>,
    pub(crate) completed_jobs: RwLock<GxHashSet<u64>>,
    /// Stores completed job data for browsing (job_id -> (Job, completed_at, result))
    pub(crate) completed_jobs_data: RwLock<VecDeque<(crate::protocol::Job, u64, Option<Value>)>>,
    pub(crate) job_results: RwLock<GxHashMap<u64, Value>>,
    pub(crate) subscribers: RwLock<Vec<Subscriber>>,
    pub(crate) auth_tokens: RwLock<GxHashSet<String>>,
    pub(crate) metrics: GlobalMetrics,
    pub(crate) job_index: JobIndexMap,
    pub(crate) workers: RwLock<GxHashMap<String, Worker>>,
    pub(crate) webhooks: RwLock<GxHashMap<String, Webhook>>,
    pub(crate) webhook_circuits: Arc<RwLock<GxHashMap<String, CircuitBreakerEntry>>>,
    pub(crate) circuit_breaker_config: CircuitBreakerConfig,
    pub(crate) event_tx: broadcast::Sender<JobEvent>,
    pub(crate) metrics_history: RwLock<VecDeque<MetricsHistoryPoint>>,
    pub(crate) snapshot_changes: std::sync::atomic::AtomicU64,
    pub(crate) last_snapshot: std::sync::atomic::AtomicU64,
    pub(crate) job_logs: RwLock<GxHashMap<u64, VecDeque<JobLogEntry>>>,
    pub(crate) stalled_count: RwLock<GxHashMap<u64, u32>>,
    pub(crate) sync_persistence: bool,
    pub(crate) debounce_cache:
        RwLock<GxHashMap<compact_str::CompactString, GxHashMap<compact_str::CompactString, u64>>>,
    pub(crate) custom_id_map: RwLock<GxHashMap<String, u64>>,
    #[allow(clippy::type_complexity)]
    pub(crate) job_waiters:
        RwLock<GxHashMap<u64, Vec<tokio::sync::oneshot::Sender<Option<Value>>>>>,
    #[allow(clippy::type_complexity)]
    pub(crate) completed_retention: RwLock<GxHashMap<u64, (u64, u64, Option<Value>)>>,
    pub(crate) queue_defaults: RwLock<QueueDefaults>,
    pub(crate) cleanup_settings: RwLock<CleanupSettings>,
    pub(crate) tcp_connection_count: std::sync::atomic::AtomicUsize,
    pub(crate) http_client: reqwest::Client,
    pub(crate) shutdown_flag: std::sync::atomic::AtomicBool,
    pub(crate) kv_store: DashMap<String, super::kv::KvValue, BuildHasherDefault<GxHasher>>,
    pub(crate) pubsub: super::pubsub::PubSub,
    #[allow(dead_code)]
    pub(crate) s3_backup: Option<Arc<S3BackupManager>>,
    #[allow(dead_code)]
    pub(crate) snapshot_config: Option<SnapshotConfig>,
}

/// Configuration for SQLite snapshots.
#[derive(Debug, Clone)]
pub struct SnapshotConfig {
    pub interval_secs: u64,
    pub min_changes: u64,
}

#[derive(Debug, Clone, Default)]
pub struct QueueDefaults {
    pub timeout: Option<u64>,
    pub max_attempts: Option<u32>,
    pub backoff: Option<u64>,
    pub ttl: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct CleanupSettings {
    pub max_completed_jobs: usize,
    pub max_job_results: usize,
    pub cleanup_interval_secs: u64,
    pub metrics_history_size: usize,
}

impl Default for CleanupSettings {
    fn default() -> Self {
        Self {
            max_completed_jobs: 5000, // Reduced from 50000 to prevent memory bloat
            max_job_results: 5000,
            cleanup_interval_secs: 60,
            metrics_history_size: 1000,
        }
    }
}

impl QueueManager {
    /// Create a new QueueManager without persistence (in-memory only).
    pub fn new(_persistence: bool) -> Arc<Self> {
        Self::create(None, None)
    }

    /// Create a new QueueManager with SQLite persistence.
    pub fn with_sqlite(config: SqliteConfig) -> Arc<Self> {
        match SqliteStorage::new(config) {
            Ok(mut storage) => {
                if let Err(e) = storage.migrate() {
                    error!(error = %e, "Failed to run SQLite migrations");
                }

                // Enable async writer for non-blocking persistence
                let async_writer_config = super::sqlite::AsyncWriterConfig::default();
                let async_writer = storage.enable_async_writer(async_writer_config);

                let storage = Arc::new(storage);
                let manager = Self::create(Some(storage.clone()), None);

                // Start async writer background task
                async_writer.start();
                info!("SQLite async writer started for maximum throughput");

                // Recover from SQLite
                manager.recover_from_sqlite(&storage);

                manager
            }
            Err(e) => {
                error!(error = %e, "Failed to open SQLite, running without persistence");
                Self::create(None, None)
            }
        }
    }

    /// Create with SQLite from environment variables.
    pub fn with_sqlite_from_env() -> Arc<Self> {
        let data_path = std::env::var("DATA_PATH").ok();

        if let Some(path) = data_path {
            let config = SqliteConfig {
                path: std::path::PathBuf::from(path),
                ..SqliteConfig::default()
            };
            Self::with_sqlite(config)
        } else {
            info!("No DATA_PATH set, running in-memory only");
            Self::new(false)
        }
    }

    /// Internal constructor.
    fn create(
        storage: Option<Arc<SqliteStorage>>,
        s3_backup: Option<Arc<S3BackupManager>>,
    ) -> Arc<Self> {
        use std::sync::atomic::AtomicU64;

        init_coarse_time();

        let shards = (0..NUM_SHARDS).map(|_| RwLock::new(Shard::new())).collect();
        let (event_tx, _) = broadcast::channel(1024);
        let has_storage = storage.is_some();
        let snapshot_config = if has_storage {
            Some(SnapshotConfig {
                interval_secs: std::env::var("SNAPSHOT_INTERVAL")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(60),
                min_changes: std::env::var("SNAPSHOT_MIN_CHANGES")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(100),
            })
        } else {
            None
        };

        let sync_persistence = std::env::var("SYNC_PERSISTENCE")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(false);

        let processing_shards: Vec<ProcessingShard> = (0..NUM_SHARDS)
            .map(|_| RwLock::new(GxHashMap::with_capacity_and_hasher(128, Default::default())))
            .collect();

        let manager = Arc::new(Self {
            shards,
            processing_shards,
            storage,
            cron_jobs: RwLock::new(GxHashMap::default()),
            completed_jobs: RwLock::new(GxHashSet::default()),
            completed_jobs_data: RwLock::new(VecDeque::with_capacity(5_000)), // Reduced from 50_000
            job_results: RwLock::new(GxHashMap::default()),
            subscribers: RwLock::new(Vec::new()),
            auth_tokens: RwLock::new(GxHashSet::default()),
            metrics: GlobalMetrics::new(),
            job_index: DashMap::with_capacity_and_hasher(65536, Default::default()),
            workers: RwLock::new(GxHashMap::default()),
            webhooks: RwLock::new(GxHashMap::default()),
            webhook_circuits: Arc::new(RwLock::new(GxHashMap::default())),
            circuit_breaker_config: CircuitBreakerConfig::default(),
            event_tx,
            metrics_history: RwLock::new(VecDeque::with_capacity(60)),
            snapshot_changes: AtomicU64::new(0),
            last_snapshot: AtomicU64::new(now_ms()),
            job_logs: RwLock::new(GxHashMap::default()),
            stalled_count: RwLock::new(GxHashMap::default()),
            sync_persistence,
            debounce_cache: RwLock::new(GxHashMap::with_capacity_and_hasher(
                64,
                Default::default(),
            )),
            custom_id_map: RwLock::new(GxHashMap::default()),
            job_waiters: RwLock::new(GxHashMap::default()),
            completed_retention: RwLock::new(GxHashMap::default()),
            queue_defaults: RwLock::new(QueueDefaults::default()),
            cleanup_settings: RwLock::new(CleanupSettings::default()),
            tcp_connection_count: std::sync::atomic::AtomicUsize::new(0),
            http_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .pool_max_idle_per_host(10)
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            shutdown_flag: std::sync::atomic::AtomicBool::new(false),
            kv_store: DashMap::with_capacity_and_hasher(1024, Default::default()),
            pubsub: super::pubsub::PubSub::new(),
            s3_backup,
            snapshot_config,
        });

        let mgr = Arc::clone(&manager);
        tokio::spawn(async move {
            mgr.background_tasks().await;
        });

        if has_storage {
            info!("SQLite persistence enabled");
        }
        if sync_persistence {
            info!("Sync persistence enabled (DURABLE MODE)");
        }

        manager
    }

    #[inline]
    pub fn is_sync_persistence(&self) -> bool {
        self.sync_persistence
    }

    pub fn with_auth_tokens(_persistence: bool, tokens: Vec<String>) -> Arc<Self> {
        let manager = Self::new(false);
        {
            let mut auth = manager.auth_tokens.write();
            for token in tokens {
                auth.insert(token);
            }
        }
        manager
    }

    /// Verify authentication token using constant-time comparison.
    #[inline]
    pub fn verify_token(&self, token: &str) -> bool {
        let tokens = self.auth_tokens.read();
        if tokens.is_empty() {
            return true;
        }
        let mut found = false;
        for valid_token in tokens.iter() {
            found |= constant_time_eq(token.as_bytes(), valid_token.as_bytes());
        }
        found
    }

    #[inline]
    #[allow(dead_code)]
    pub fn is_sqlite_connected(&self) -> bool {
        self.storage.is_some()
    }

    #[inline]
    pub fn has_storage(&self) -> bool {
        self.storage.is_some()
    }

    /// Get async writer stats if enabled.
    /// Returns: (queue_len, ops_queued, ops_written, batches_written, batch_interval_ms, max_batch_size)
    pub fn get_async_writer_stats(&self) -> Option<(usize, u64, u64, u64, u64, usize)> {
        self.storage.as_ref().and_then(|s| {
            s.async_writer().map(|w| {
                let stats = w.stats();
                (
                    w.queue_len(),
                    stats.ops_queued.load(std::sync::atomic::Ordering::Relaxed),
                    stats.ops_written.load(std::sync::atomic::Ordering::Relaxed),
                    stats
                        .batches_written
                        .load(std::sync::atomic::Ordering::Relaxed),
                    w.get_batch_interval_ms(),
                    w.get_max_batch_size(),
                )
            })
        })
    }

    /// Check if async writer is enabled.
    #[allow(dead_code)]
    pub fn has_async_writer(&self) -> bool {
        self.storage
            .as_ref()
            .map(|s| s.has_async_writer())
            .unwrap_or(false)
    }

    /// Update async writer configuration at runtime.
    /// Returns true if the configuration was updated, false if async writer is not enabled.
    pub fn update_async_writer_config(
        &self,
        batch_interval_ms: Option<u64>,
        max_batch_size: Option<usize>,
    ) -> bool {
        if let Some(storage) = &self.storage {
            if let Some(writer) = storage.async_writer() {
                if let Some(interval) = batch_interval_ms {
                    writer.set_batch_interval_ms(interval);
                }
                if let Some(size) = max_batch_size {
                    writer.set_max_batch_size(size);
                }
                return true;
            }
        }
        false
    }

    #[inline]
    #[allow(dead_code)]
    pub fn is_snapshot_mode(&self) -> bool {
        false // Simplified: always use direct persistence
    }

    #[inline]
    #[allow(dead_code)]
    pub(crate) fn record_change(&self) {
        self.snapshot_changes
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    #[inline]
    #[allow(dead_code)]
    pub fn snapshot_change_count(&self) -> u64 {
        self.snapshot_changes
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Get next job ID (simple atomic counter for single node).
    pub async fn next_job_id(&self) -> u64 {
        crate::protocol::next_id()
    }

    /// Get next N job IDs.
    pub async fn next_job_ids(&self, count: usize) -> Vec<u64> {
        (0..count).map(|_| crate::protocol::next_id()).collect()
    }

    #[inline]
    pub fn auth_token_count(&self) -> usize {
        self.auth_tokens.read().len()
    }

    /// Always leader in single-node mode.
    #[inline]
    #[allow(dead_code)]
    pub fn is_leader(&self) -> bool {
        true
    }

    /// Cluster is never enabled in single-node mode.
    #[inline]
    #[allow(dead_code)]
    pub fn is_cluster_enabled(&self) -> bool {
        false
    }

    /// Distributed pull is never enabled in single-node mode.
    #[inline]
    #[allow(dead_code)]
    pub fn is_distributed_pull(&self) -> bool {
        false
    }

    /// No node ID in single-node mode.
    #[inline]
    #[allow(dead_code)]
    pub fn node_id(&self) -> Option<String> {
        None
    }

    pub fn shutdown(&self) {
        self.shutdown_flag
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }

    #[inline]
    pub fn is_shutdown(&self) -> bool {
        self.shutdown_flag
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    #[inline(always)]
    pub fn shard_index(queue: &str) -> usize {
        let mut hasher = GxHasher::default();
        queue.hash(&mut hasher);
        hasher.finish() as usize % NUM_SHARDS
    }

    #[inline(always)]
    pub fn processing_shard_index(job_id: u64) -> usize {
        (job_id as usize) & 0x1F
    }

    #[inline]
    pub(crate) fn processing_insert(&self, job: Job) {
        let idx = Self::processing_shard_index(job.id);
        self.processing_shards[idx].write().insert(job.id, job);
    }

    #[inline]
    pub(crate) fn processing_remove(&self, job_id: u64) -> Option<Job> {
        let idx = Self::processing_shard_index(job_id);
        self.processing_shards[idx].write().remove(&job_id)
    }

    #[inline]
    pub(crate) fn processing_get(&self, job_id: u64) -> Option<Job> {
        let idx = Self::processing_shard_index(job_id);
        self.processing_shards[idx].read().get(&job_id).cloned()
    }

    #[inline]
    pub(crate) fn processing_contains(&self, job_id: u64) -> bool {
        let idx = Self::processing_shard_index(job_id);
        self.processing_shards[idx].read().contains_key(&job_id)
    }

    #[inline]
    pub(crate) fn processing_get_mut<F, R>(&self, job_id: u64, f: F) -> Option<R>
    where
        F: FnOnce(&mut Job) -> R,
    {
        let idx = Self::processing_shard_index(job_id);
        self.processing_shards[idx].write().get_mut(&job_id).map(f)
    }

    #[inline]
    pub(crate) fn processing_len(&self) -> usize {
        self.processing_shards.iter().map(|s| s.read().len()).sum()
    }

    #[inline]
    pub fn processing_count(&self) -> usize {
        self.processing_len()
    }

    pub(crate) fn processing_iter<F>(&self, mut f: F)
    where
        F: FnMut(&Job),
    {
        for shard in &self.processing_shards {
            let shard = shard.read();
            for job in shard.values() {
                f(job);
            }
        }
    }

    pub(crate) fn processing_count_by_queue(&self, queue: &str) -> usize {
        let mut count = 0;
        for shard in &self.processing_shards {
            let shard = shard.read();
            count += shard.values().filter(|j| j.queue == queue).count();
        }
        count
    }

    #[inline(always)]
    pub fn now_ms() -> u64 {
        now_ms()
    }

    /// Recover state from SQLite on startup.
    fn recover_from_sqlite(&self, storage: &SqliteStorage) {
        // Sync job ID counter
        match storage.get_max_job_id() {
            Ok(max_id) => {
                if max_id > 0 {
                    set_id_counter(max_id + 1);
                    info!(next_id = max_id + 1, "Synced job ID counter");
                }
            }
            Err(e) => {
                error!(error = %e, "Failed to recover max job ID");
            }
        }

        let mut job_count = 0;

        // Load pending jobs
        if let Ok(jobs) = storage.load_pending_jobs() {
            for (job, state) in jobs {
                let job_id = job.id;
                let idx = Self::shard_index(&job.queue);
                let queue_name = intern(&job.queue);

                match state.as_str() {
                    "waiting" | "delayed" | "active" => {
                        let mut shard = self.shards[idx].write();
                        shard.queues.entry(queue_name).or_default().push(job);
                        self.index_job(job_id, JobLocation::Queue { shard_idx: idx });
                        job_count += 1;
                    }
                    "waiting_children" => {
                        self.shards[idx].write().waiting_deps.insert(job_id, job);
                        self.index_job(job_id, JobLocation::WaitingDeps { shard_idx: idx });
                        job_count += 1;
                    }
                    _ => {}
                }
            }
        }

        // Load DLQ jobs
        if let Ok(dlq_jobs) = storage.load_dlq_jobs() {
            for job in dlq_jobs {
                let job_id = job.id;
                let idx = Self::shard_index(&job.queue);
                let queue_name = intern(&job.queue);
                self.shards[idx]
                    .write()
                    .dlq
                    .entry(queue_name)
                    .or_default()
                    .push_back(job);
                self.index_job(job_id, JobLocation::Dlq { shard_idx: idx });
            }
        }

        // Load cron jobs
        if let Ok(crons) = storage.load_crons() {
            let mut cron_jobs = self.cron_jobs.write();
            for cron in crons {
                cron_jobs.insert(cron.name.clone(), cron);
            }
            if !cron_jobs.is_empty() {
                info!(count = cron_jobs.len(), "Recovered cron jobs");
            }
        }

        // Load webhooks
        if let Ok(webhooks) = storage.load_webhooks() {
            let mut wh = self.webhooks.write();
            for webhook in webhooks {
                let w = Webhook::new(
                    webhook.id.clone(),
                    webhook.url,
                    webhook.events,
                    webhook.queue,
                    webhook.secret,
                );
                wh.insert(webhook.id, w);
            }
            if !wh.is_empty() {
                info!(count = wh.len(), "Recovered webhooks");
            }
        }

        if job_count > 0 {
            info!(count = job_count, "Recovered jobs from SQLite");
        }
    }
}
