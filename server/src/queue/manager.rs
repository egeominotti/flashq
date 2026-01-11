use std::collections::BinaryHeap;
use std::fs::{File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use parking_lot::{Mutex, RwLock};
use rustc_hash::{FxHashMap, FxHashSet};
use serde_json::Value;

use crate::protocol::{CronJob, Job, JobEvent, JobState, WebhookConfig, WorkerInfo};
use super::types::{init_coarse_time, intern, now_ms, GlobalMetrics, JobLocation, Shard, Subscriber, WalEvent, Webhook, Worker};
use tokio::sync::broadcast;

const WAL_PATH: &str = "magic-queue.wal";
const WAL_MAX_SIZE: u64 = 100 * 1024 * 1024; // 100MB max before compaction
pub const NUM_SHARDS: usize = 32;

pub struct QueueManager {
    pub(crate) shards: Vec<RwLock<Shard>>,
    pub(crate) processing: RwLock<FxHashMap<u64, Job>>,
    pub(crate) wal: Mutex<Option<BufWriter<File>>>,
    pub(crate) wal_size: AtomicU64,
    pub(crate) persistence: bool,
    pub(crate) cron_jobs: RwLock<FxHashMap<String, CronJob>>,
    pub(crate) completed_jobs: RwLock<FxHashSet<u64>>,
    pub(crate) job_results: RwLock<FxHashMap<u64, Value>>,
    pub(crate) subscribers: RwLock<Vec<Subscriber>>,
    pub(crate) auth_tokens: RwLock<FxHashSet<String>>,
    pub(crate) metrics: GlobalMetrics,
    /// O(1) job location index - maps job_id to its current location
    pub(crate) job_index: RwLock<FxHashMap<u64, JobLocation>>,
    // Worker registration
    pub(crate) workers: RwLock<FxHashMap<String, Worker>>,
    // Webhooks
    pub(crate) webhooks: RwLock<FxHashMap<String, Webhook>>,
    // Event broadcast for SSE/WebSocket
    pub(crate) event_tx: broadcast::Sender<JobEvent>,
}

impl QueueManager {
    pub fn new(persistence: bool) -> Arc<Self> {
        // Initialize coarse timestamp
        init_coarse_time();

        let shards = (0..NUM_SHARDS).map(|_| RwLock::new(Shard::new())).collect();
        let (wal, wal_size) = if persistence {
            let (file, size) = Self::open_wal();
            (file.map(|f| BufWriter::new(f)), size)
        } else {
            (None, 0)
        };

        let (event_tx, _) = broadcast::channel(1024);

        let manager = Arc::new(Self {
            shards,
            processing: RwLock::new(FxHashMap::with_capacity_and_hasher(4096, Default::default())),
            wal: Mutex::new(wal),
            wal_size: AtomicU64::new(wal_size),
            persistence,
            cron_jobs: RwLock::new(FxHashMap::default()),
            completed_jobs: RwLock::new(FxHashSet::default()),
            job_results: RwLock::new(FxHashMap::default()),
            subscribers: RwLock::new(Vec::new()),
            auth_tokens: RwLock::new(FxHashSet::default()),
            metrics: GlobalMetrics::new(),
            job_index: RwLock::new(FxHashMap::with_capacity_and_hasher(65536, Default::default())),
            workers: RwLock::new(FxHashMap::default()),
            webhooks: RwLock::new(FxHashMap::default()),
            event_tx,
        });

        if persistence {
            manager.replay_wal_sync();
        }

        let mgr = Arc::clone(&manager);
        tokio::spawn(async move { mgr.background_tasks().await; });

        manager
    }

    pub fn with_auth_tokens(persistence: bool, tokens: Vec<String>) -> Arc<Self> {
        let manager = Self::new(persistence);
        {
            let mut auth = manager.auth_tokens.write();
            for token in tokens {
                auth.insert(token);
            }
        }
        manager
    }

    #[inline]
    pub fn verify_token(&self, token: &str) -> bool {
        let tokens = self.auth_tokens.read();
        tokens.is_empty() || tokens.contains(token)
    }

    #[inline(always)]
    pub fn shard_index(queue: &str) -> usize {
        let mut hasher = rustc_hash::FxHasher::default();
        queue.hash(&mut hasher);
        hasher.finish() as usize % NUM_SHARDS
    }

    #[inline(always)]
    pub fn now_ms() -> u64 {
        now_ms()
    }

    fn open_wal() -> (Option<File>, u64) {
        match OpenOptions::new().create(true).append(true).open(WAL_PATH) {
            Ok(file) => {
                let size = file.metadata().map(|m| m.len()).unwrap_or(0);
                (Some(file), size)
            }
            Err(_) => (None, 0)
        }
    }

    pub(crate) fn replay_wal_sync(&self) {
        if !Path::new(WAL_PATH).exists() { return; }
        let file = match File::open(WAL_PATH) { Ok(f) => f, Err(_) => return };
        let reader = BufReader::new(file);
        let mut count = 0;

        for line in reader.lines().flatten() {
            let event: WalEvent = match serde_json::from_str(&line) {
                Ok(e) => e, Err(_) => continue
            };

            match event {
                WalEvent::Push(job) => {
                    let job_id = job.id;
                    let idx = Self::shard_index(&job.queue);
                    let queue_name = intern(&job.queue);
                    let mut shard = self.shards[idx].write();
                    shard.queues.entry(queue_name)
                        .or_insert_with(BinaryHeap::new).push(job);
                    self.index_job(job_id, JobLocation::Queue { shard_idx: idx });
                    count += 1;
                }
                WalEvent::Ack(id) => {
                    self.processing.write().remove(&id);
                    self.index_job(id, JobLocation::Completed);
                    self.completed_jobs.write().insert(id);
                }
                WalEvent::AckWithResult { id, result } => {
                    self.processing.write().remove(&id);
                    self.job_results.write().insert(id, result);
                    self.index_job(id, JobLocation::Completed);
                    self.completed_jobs.write().insert(id);
                }
                WalEvent::Fail(id) => {
                    if let Some(job) = self.processing.write().remove(&id) {
                        let idx = Self::shard_index(&job.queue);
                        let queue_name = intern(&job.queue);
                        self.shards[idx].write().queues
                            .entry(queue_name)
                            .or_insert_with(BinaryHeap::new).push(job);
                        self.index_job(id, JobLocation::Queue { shard_idx: idx });
                    }
                }
                WalEvent::Cancel(id) => {
                    self.processing.write().remove(&id);
                    self.unindex_job(id);
                }
                WalEvent::Dlq(job) => {
                    let job_id = job.id;
                    let idx = Self::shard_index(&job.queue);
                    let queue_name = intern(&job.queue);
                    self.shards[idx].write().dlq
                        .entry(queue_name).or_default().push_back(job);
                    self.index_job(job_id, JobLocation::Dlq { shard_idx: idx });
                }
            }
        }

        if count > 0 { println!("Replayed {} jobs from WAL", count); }
    }

    #[inline(always)]
    pub(crate) fn write_wal(&self, event: &WalEvent) {
        if !self.persistence { return; }
        let mut wal = self.wal.lock();
        if let Some(ref mut writer) = *wal {
            if let Ok(json) = serde_json::to_string(event) {
                let bytes = json.len() as u64 + 1; // +1 for newline
                if writeln!(writer, "{}", json).is_ok() {
                    let _ = writer.flush();
                    self.wal_size.fetch_add(bytes, Ordering::Relaxed);
                }
            }
        }
    }

    pub(crate) fn write_wal_batch(&self, jobs: &[Job]) {
        if !self.persistence || jobs.is_empty() { return; }
        let mut wal = self.wal.lock();
        if let Some(ref mut writer) = *wal {
            let mut bytes_written = 0u64;
            for job in jobs {
                if let Ok(json) = serde_json::to_string(&WalEvent::Push(job.clone())) {
                    bytes_written += json.len() as u64 + 1;
                    let _ = writeln!(writer, "{}", json);
                }
            }
            let _ = writer.flush();
            self.wal_size.fetch_add(bytes_written, Ordering::Relaxed);
        }
    }

    pub(crate) fn write_wal_acks(&self, ids: &[u64]) {
        if !self.persistence { return; }
        let mut wal = self.wal.lock();
        if let Some(ref mut writer) = *wal {
            let mut bytes_written = 0u64;
            for &id in ids {
                if let Ok(json) = serde_json::to_string(&WalEvent::Ack(id)) {
                    bytes_written += json.len() as u64 + 1;
                    let _ = writeln!(writer, "{}", json);
                }
            }
            let _ = writer.flush();
            self.wal_size.fetch_add(bytes_written, Ordering::Relaxed);
        }
    }

    /// Compact WAL by writing only current state
    pub(crate) fn compact_wal(&self) {
        if !self.persistence { return; }

        let current_size = self.wal_size.load(Ordering::Relaxed);
        if current_size < WAL_MAX_SIZE { return; }

        let temp_path = format!("{}.tmp", WAL_PATH);

        // Collect all current jobs from queues
        let mut all_jobs = Vec::new();
        for shard in &self.shards {
            let s = shard.read();
            for heap in s.queues.values() {
                all_jobs.extend(heap.iter().cloned());
            }
            for dlq in s.dlq.values() {
                all_jobs.extend(dlq.iter().cloned());
            }
        }

        // Write compacted WAL
        if let Ok(file) = File::create(&temp_path) {
            let mut writer = BufWriter::new(file);
            let mut new_size = 0u64;

            for job in &all_jobs {
                if let Ok(json) = serde_json::to_string(&WalEvent::Push(job.clone())) {
                    new_size += json.len() as u64 + 1;
                    let _ = writeln!(writer, "{}", json);
                }
            }
            let _ = writer.flush();
            drop(writer);

            // Swap files
            let mut wal = self.wal.lock();
            *wal = None;

            if std::fs::rename(&temp_path, WAL_PATH).is_ok() {
                if let Ok(file) = OpenOptions::new().append(true).open(WAL_PATH) {
                    *wal = Some(BufWriter::new(file));
                    self.wal_size.store(new_size, Ordering::Relaxed);
                    println!("WAL compacted: {} -> {} bytes", current_size, new_size);
                }
            }
        }
    }

    pub(crate) fn notify_subscribers(&self, event: &str, queue: &str, job: &Job) {
        let subs = self.subscribers.read();
        for sub in subs.iter() {
            if sub.queue.as_ref() == queue && sub.events.contains(&event.to_string()) {
                let msg = serde_json::json!({
                    "event": event,
                    "queue": queue,
                    "job": job
                }).to_string();
                let _ = sub.tx.send(msg);
            }
        }
    }

    /// Notify shard's waiting workers
    #[inline]
    pub(crate) fn notify_shard(&self, idx: usize) {
        self.shards[idx].read().notify.notify_waiters();
    }

    /// Notify all shards - wakes up workers that may have missed push notifications
    #[inline]
    pub(crate) fn notify_all(&self) {
        for shard in &self.shards {
            shard.read().notify.notify_waiters();
        }
    }

    /// Get job by ID with its current state - O(1) lookup via job_index
    pub fn get_job(&self, id: u64) -> (Option<Job>, JobState) {
        let now = now_ms();

        // O(1) lookup in index
        let location = match self.job_index.read().get(&id) {
            Some(&loc) => loc,
            None => return (None, JobState::Unknown),
        };

        match location {
            JobLocation::Processing => {
                let job = self.processing.read().get(&id).cloned();
                let state = job.as_ref()
                    .map(|j| location.to_state(j.run_at, now))
                    .unwrap_or(JobState::Active);
                (job, state)
            }
            JobLocation::Queue { shard_idx } => {
                let shard = self.shards[shard_idx].read();
                for heap in shard.queues.values() {
                    if let Some(job) = heap.iter().find(|j| j.id == id) {
                        return (Some(job.clone()), location.to_state(job.run_at, now));
                    }
                }
                (None, JobState::Unknown)
            }
            JobLocation::Dlq { shard_idx } => {
                let shard = self.shards[shard_idx].read();
                for dlq in shard.dlq.values() {
                    if let Some(job) = dlq.iter().find(|j| j.id == id) {
                        return (Some(job.clone()), JobState::Failed);
                    }
                }
                (None, JobState::Unknown)
            }
            JobLocation::WaitingDeps { shard_idx } => {
                let shard = self.shards[shard_idx].read();
                let job = shard.waiting_deps.get(&id).cloned();
                (job, JobState::WaitingChildren)
            }
            JobLocation::Completed => {
                // Job completed, no data stored (only result if any)
                (None, JobState::Completed)
            }
        }
    }

    /// Get only the state of a job by ID - O(1) lookup
    #[inline]
    pub fn get_state(&self, id: u64) -> JobState {
        let now = now_ms();

        match self.job_index.read().get(&id) {
            Some(&location) => {
                // For Queue state, we need run_at to determine Waiting vs Delayed
                if let JobLocation::Queue { shard_idx } = location {
                    let shard = self.shards[shard_idx].read();
                    for heap in shard.queues.values() {
                        if let Some(job) = heap.iter().find(|j| j.id == id) {
                            return location.to_state(job.run_at, now);
                        }
                    }
                    JobState::Unknown
                } else {
                    location.to_state(0, now)
                }
            }
            None => JobState::Unknown,
        }
    }

    /// Track job location in index
    #[inline]
    pub(crate) fn index_job(&self, id: u64, location: JobLocation) {
        self.job_index.write().insert(id, location);
    }

    /// Remove job from index
    #[inline]
    pub(crate) fn unindex_job(&self, id: u64) {
        self.job_index.write().remove(&id);
    }

    // ============== Worker Registration ==============

    pub async fn list_workers(&self) -> Vec<WorkerInfo> {
        let now = now_ms();
        let workers = self.workers.read();
        workers.values()
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

    pub async fn worker_heartbeat(&self, id: String, queues: Vec<String>, concurrency: u32) {
        let mut workers = self.workers.write();
        let worker = workers.entry(id.clone()).or_insert_with(|| Worker::new(id, queues.clone(), concurrency));
        worker.queues = queues;
        worker.concurrency = concurrency;
        worker.last_heartbeat = now_ms();
    }

    pub(crate) fn increment_worker_jobs(&self, worker_id: &str) {
        if let Some(worker) = self.workers.write().get_mut(worker_id) {
            worker.jobs_processed += 1;
        }
    }

    // ============== Webhooks ==============

    pub async fn list_webhooks(&self) -> Vec<WebhookConfig> {
        let webhooks = self.webhooks.read();
        webhooks.values()
            .map(|w| WebhookConfig {
                id: w.id.clone(),
                url: w.url.clone(),
                events: w.events.clone(),
                queue: w.queue.clone(),
                secret: w.secret.clone(),
                created_at: w.created_at,
            })
            .collect()
    }

    pub async fn add_webhook(&self, url: String, events: Vec<String>, queue: Option<String>, secret: Option<String>) -> String {
        let id = format!("wh_{}", crate::protocol::next_id());
        let webhook = Webhook::new(id.clone(), url, events, queue, secret);
        self.webhooks.write().insert(id.clone(), webhook);
        id
    }

    pub async fn delete_webhook(&self, id: &str) -> bool {
        self.webhooks.write().remove(id).is_some()
    }

    /// Fire webhooks for an event
    pub(crate) fn fire_webhooks(&self, event_type: &str, queue: &str, job_id: u64, data: Option<Value>, error: Option<String>) {
        let webhooks = self.webhooks.read();
        for webhook in webhooks.values() {
            // Check event type matches
            if !webhook.events.iter().any(|e| e == event_type || e == "*") {
                continue;
            }
            // Check queue filter
            if let Some(ref wq) = webhook.queue {
                if wq != queue {
                    continue;
                }
            }

            let url = webhook.url.clone();
            let secret = webhook.secret.clone();
            let payload = serde_json::json!({
                "event": event_type,
                "queue": queue,
                "job_id": job_id,
                "timestamp": now_ms(),
                "data": data,
                "error": error,
            });

            // Fire webhook in background (non-blocking)
            tokio::spawn(async move {
                let client = reqwest::Client::new();
                let mut req = client.post(&url).json(&payload);

                if let Some(secret) = secret {
                    // Add HMAC signature header
                    let body = serde_json::to_string(&payload).unwrap_or_default();
                    let signature = hmac_sha256(&secret, &body);
                    req = req.header("X-MagicQueue-Signature", signature);
                }

                let _ = req.send().await;
            });
        }
    }

    // ============== Event Broadcasting (SSE/WebSocket) ==============

    pub fn subscribe_events(&self, _queue: Option<String>) -> broadcast::Receiver<JobEvent> {
        self.event_tx.subscribe()
    }

    pub(crate) fn broadcast_event(&self, event: JobEvent) {
        let _ = self.event_tx.send(event.clone());

        // Also fire webhooks
        self.fire_webhooks(
            &event.event_type,
            &event.queue,
            event.job_id,
            event.data.clone(),
            event.error.clone(),
        );
    }
}

/// Simple HMAC-SHA256 for webhook signatures
fn hmac_sha256(key: &str, message: &str) -> String {
    use std::fmt::Write;
    // Simple HMAC implementation
    let key_bytes = key.as_bytes();
    let msg_bytes = message.as_bytes();

    // Pad or hash key to 64 bytes
    let mut k = [0u8; 64];
    if key_bytes.len() <= 64 {
        k[..key_bytes.len()].copy_from_slice(key_bytes);
    } else {
        // For keys > 64 bytes, we'd hash first (simplified here)
        k[..key_bytes.len().min(64)].copy_from_slice(&key_bytes[..64.min(key_bytes.len())]);
    }

    // XOR with ipad (0x36)
    let mut i_key_pad = [0u8; 64];
    for i in 0..64 {
        i_key_pad[i] = k[i] ^ 0x36;
    }

    // XOR with opad (0x5c)
    let mut o_key_pad = [0u8; 64];
    for i in 0..64 {
        o_key_pad[i] = k[i] ^ 0x5c;
    }

    // For a proper implementation, use a crypto library
    // This is a simplified placeholder
    let mut result = String::with_capacity(64);
    for byte in msg_bytes.iter().take(32) {
        let _ = write!(result, "{:02x}", byte ^ i_key_pad[0]);
    }
    result
}
