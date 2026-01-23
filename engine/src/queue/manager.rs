//! Core QueueManager struct and constructors.
//!
//! Uses NATS JetStream for distributed persistence.

use std::collections::VecDeque;
use std::hash::{BuildHasherDefault, Hash, Hasher};
use std::sync::Arc;

use dashmap::DashMap;
use gxhash::GxHasher;
use parking_lot::RwLock;
use serde_json::Value;

use super::storage::{Storage, StorageBackend};
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
    pub(crate) storage: Option<Arc<StorageBackend>>,
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
    /// Whether cluster mode is enabled (distributed pull via NATS)
    pub(crate) cluster_mode: bool,
    /// NATS ack tokens for pulled jobs (job_id -> AckToken)
    pub(crate) nats_ack_tokens: RwLock<GxHashMap<u64, super::nats::pull::AckToken>>,
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
    #[allow(dead_code)]
    pub fn new(_persistence: bool) -> Arc<Self> {
        Self::create(None)
    }

    /// Create with NATS JetStream storage backend from environment variables.
    pub fn from_env() -> Arc<Self> {
        info!("Using NATS JetStream storage backend");
        Self::with_nats_from_env()
    }

    /// Create with NATS JetStream from environment variables.
    pub fn with_nats_from_env() -> Arc<Self> {
        use super::nats::{NatsConfig, NatsStorage};

        let config = NatsConfig::from_env();
        let nats_storage = Arc::new(NatsStorage::new(config));
        let storage = Arc::new(StorageBackend::nats(nats_storage));

        let manager = Self::create(Some(storage));

        // Note: NATS connection is async, will be established on first use
        // or call manager.connect_storage().await
        info!(url = %std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".to_string()),
              "NATS storage configured");

        manager
    }

    /// Internal constructor.
    fn create(storage: Option<Arc<StorageBackend>>) -> Arc<Self> {
        init_coarse_time();

        let shards = (0..NUM_SHARDS).map(|_| RwLock::new(Shard::new())).collect();
        let (event_tx, _) = broadcast::channel(1024);
        let has_storage = storage.is_some();

        let sync_persistence = std::env::var("SYNC_PERSISTENCE")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(false);

        // Cluster mode: enable distributed pull via NATS streams
        let cluster_mode = std::env::var("CLUSTER_MODE")
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
            cluster_mode,
            nats_ack_tokens: RwLock::new(GxHashMap::default()),
        });

        let mgr = Arc::clone(&manager);
        tokio::spawn(async move {
            mgr.background_tasks().await;
        });

        if has_storage {
            if let Some(ref s) = manager.storage {
                info!(backend = %s.name(), "Persistence enabled");
            }
        }
        if sync_persistence {
            info!("Sync persistence enabled (DURABLE MODE)");
        }
        if cluster_mode {
            info!("Cluster mode enabled (distributed pull via NATS streams)");
        }

        manager
    }

    #[inline]
    pub fn is_sync_persistence(&self) -> bool {
        self.sync_persistence
    }

    #[allow(dead_code)]
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
    pub fn has_storage(&self) -> bool {
        self.storage.is_some()
    }

    /// Get storage backend name.
    #[allow(dead_code)]
    pub fn storage_backend_name(&self) -> &'static str {
        self.storage.as_ref().map(|s| s.name()).unwrap_or("none")
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

    /// Check if cluster mode is enabled.
    #[inline]
    pub fn is_cluster_enabled(&self) -> bool {
        self.cluster_mode
    }

    /// Check if distributed pull via NATS is enabled.
    #[inline]
    pub fn is_distributed_pull(&self) -> bool {
        self.cluster_mode && self.storage.is_some()
    }

    /// Get node ID from NATS storage if available.
    #[inline]
    pub fn node_id(&self) -> Option<String> {
        if self.cluster_mode {
            self.storage.as_ref().map(|s| s.0.node_id().to_string())
        } else {
            None
        }
    }

    /// Store a NATS ack token for later acknowledgment.
    pub fn store_nats_ack_token(&self, job_id: u64, token: super::nats::pull::AckToken) {
        self.nats_ack_tokens.write().insert(job_id, token);
    }

    /// Take a NATS ack token for acknowledgment.
    pub fn take_nats_ack_token(&self, job_id: u64) -> Option<super::nats::pull::AckToken> {
        self.nats_ack_tokens.write().remove(&job_id)
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
    #[allow(dead_code)]
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

    pub(crate) fn completed_count_by_queue(&self, queue: &str) -> usize {
        let completed_data = self.completed_jobs_data.read();
        completed_data
            .iter()
            .filter(|(job, _, _)| job.queue == queue)
            .count()
    }

    #[inline(always)]
    pub fn now_ms() -> u64 {
        now_ms()
    }

    /// Recover state from storage on startup (sync version).
    #[allow(dead_code)]
    fn recover_from_storage(&self) {
        let Some(ref storage) = self.storage else {
            return;
        };

        let backend_name = storage.name();

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
                        shard
                            .queues
                            .entry(queue_name.clone())
                            .or_default()
                            .push(job);
                        self.index_job(
                            job_id,
                            JobLocation::Queue {
                                shard_idx: idx,
                                queue_name,
                            },
                        );
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
                    .entry(queue_name.clone())
                    .or_default()
                    .push_back(job);
                self.index_job(
                    job_id,
                    JobLocation::Dlq {
                        shard_idx: idx,
                        queue_name,
                    },
                );
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
            info!(count = job_count, backend = %backend_name, "Recovered jobs from storage");
        }
    }

    /// Connect to storage backend (async, required for NATS).
    /// Also triggers async recovery for NATS backend.
    pub async fn connect_storage(&self) -> Result<(), super::storage::StorageError> {
        use super::storage::Storage;

        if let Some(ref storage) = self.storage {
            storage.connect().await?;

            // For NATS, we need async recovery after connection
            if storage.name() == "nats" {
                self.recover_from_storage_async(storage).await?;
            }
        }
        Ok(())
    }

    /// Async recovery from storage (used for NATS backend).
    async fn recover_from_storage_async(
        &self,
        storage: &super::storage::StorageBackend,
    ) -> Result<(), super::storage::StorageError> {
        use super::storage::Storage;
        use super::types::{intern, JobLocation};
        use crate::protocol::set_id_counter;

        let backend_name = storage.name();
        let mut job_count = 0;

        // Sync job ID counter from max ID (use async version for NATS)
        if let Ok(max_id) = storage.get_max_job_id_async().await {
            if max_id > 0 {
                set_id_counter(max_id + 1);
                info!(next_id = max_id + 1, "Synced job ID counter from NATS KV");
            }
        }

        // Load and restore pending jobs
        let pending_jobs = storage.load_pending_jobs_async().await?;

        for (job, state) in pending_jobs {
            let job_id = job.id;
            let idx = Self::shard_index(&job.queue);
            let queue_name = intern(&job.queue);

            // Register custom ID if present
            if let Some(ref custom_id) = job.custom_id {
                let mut custom_ids = self.custom_id_map.write();
                custom_ids.insert(custom_id.clone(), job_id);
            }

            // Place job in appropriate location based on state
            match state.as_str() {
                "waiting" | "delayed" | "active" => {
                    let mut shard = self.shards[idx].write();
                    shard
                        .queues
                        .entry(queue_name.clone())
                        .or_default()
                        .push(job);
                    self.index_job(
                        job_id,
                        JobLocation::Queue {
                            shard_idx: idx,
                            queue_name,
                        },
                    );
                    job_count += 1;
                }
                "waiting_children" | "waiting_deps" => {
                    self.shards[idx].write().waiting_deps.insert(job_id, job);
                    self.index_job(job_id, JobLocation::WaitingDeps { shard_idx: idx });
                    job_count += 1;
                }
                _ => {}
            }
        }

        // Load DLQ jobs
        if let Ok(dlq_jobs) = storage.load_dlq_jobs_async().await {
            for job in dlq_jobs {
                let job_id = job.id;
                let idx = Self::shard_index(&job.queue);
                let queue_name = intern(&job.queue);
                self.shards[idx]
                    .write()
                    .dlq
                    .entry(queue_name.clone())
                    .or_default()
                    .push_back(job);
                self.index_job(
                    job_id,
                    JobLocation::Dlq {
                        shard_idx: idx,
                        queue_name,
                    },
                );
            }
        }

        // Load cron jobs
        if let Ok(crons) = storage.load_crons_async().await {
            let mut cron_jobs = self.cron_jobs.write();
            for cron in crons {
                cron_jobs.insert(cron.name.clone(), cron);
            }
            if !cron_jobs.is_empty() {
                info!(count = cron_jobs.len(), "Recovered cron jobs from NATS");
            }
        }

        // Load webhooks
        if let Ok(webhooks) = storage.load_webhooks_async().await {
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
                info!(count = wh.len(), "Recovered webhooks from NATS");
            }
        }

        if job_count > 0 {
            info!(count = job_count, backend = %backend_name, "Recovered jobs from storage (async)");
        }

        Ok(())
    }
}
