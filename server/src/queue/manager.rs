use std::collections::BinaryHeap;
use std::fs::{File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::sync::Arc;

use parking_lot::{Mutex, RwLock};
use rustc_hash::{FxHashMap, FxHashSet};
use serde_json::Value;

use crate::protocol::{CronJob, Job};
use super::types::{init_coarse_time, intern, now_ms, GlobalMetrics, Shard, Subscriber, WalEvent};

const WAL_PATH: &str = "magic-queue.wal";
pub const NUM_SHARDS: usize = 32;

pub struct QueueManager {
    pub(crate) shards: Vec<RwLock<Shard>>,
    pub(crate) processing: RwLock<FxHashMap<u64, Job>>,
    pub(crate) wal: Mutex<Option<File>>,
    pub(crate) persistence: bool,
    pub(crate) cron_jobs: RwLock<FxHashMap<String, CronJob>>,
    pub(crate) completed_jobs: RwLock<FxHashSet<u64>>,
    pub(crate) job_results: RwLock<FxHashMap<u64, Value>>,
    pub(crate) subscribers: RwLock<Vec<Subscriber>>,
    pub(crate) auth_tokens: RwLock<FxHashSet<String>>,
    pub(crate) metrics: GlobalMetrics,
}

impl QueueManager {
    pub fn new(persistence: bool) -> Arc<Self> {
        // Initialize coarse timestamp
        init_coarse_time();

        let shards = (0..NUM_SHARDS).map(|_| RwLock::new(Shard::new())).collect();
        let wal = if persistence { Self::open_wal() } else { None };

        let manager = Arc::new(Self {
            shards,
            processing: RwLock::new(FxHashMap::with_capacity_and_hasher(4096, Default::default())),
            wal: Mutex::new(wal),
            persistence,
            cron_jobs: RwLock::new(FxHashMap::default()),
            completed_jobs: RwLock::new(FxHashSet::default()),
            job_results: RwLock::new(FxHashMap::default()),
            subscribers: RwLock::new(Vec::new()),
            auth_tokens: RwLock::new(FxHashSet::default()),
            metrics: GlobalMetrics::new(),
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

    fn open_wal() -> Option<File> {
        OpenOptions::new().create(true).append(true).open(WAL_PATH).ok()
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
                    let idx = Self::shard_index(&job.queue);
                    let queue_name = intern(&job.queue);
                    let mut shard = self.shards[idx].write();
                    shard.queues.entry(queue_name)
                        .or_insert_with(BinaryHeap::new).push(job);
                    count += 1;
                }
                WalEvent::Ack(id) => {
                    self.processing.write().remove(&id);
                }
                WalEvent::AckWithResult { id, result } => {
                    self.processing.write().remove(&id);
                    self.job_results.write().insert(id, result);
                }
                WalEvent::Fail(id) => {
                    if let Some(job) = self.processing.write().remove(&id) {
                        let idx = Self::shard_index(&job.queue);
                        let queue_name = intern(&job.queue);
                        self.shards[idx].write().queues
                            .entry(queue_name)
                            .or_insert_with(BinaryHeap::new).push(job);
                    }
                }
                WalEvent::Cancel(id) => {
                    self.processing.write().remove(&id);
                }
                WalEvent::Dlq(job) => {
                    let idx = Self::shard_index(&job.queue);
                    let queue_name = intern(&job.queue);
                    self.shards[idx].write().dlq
                        .entry(queue_name).or_default().push_back(job);
                }
            }
        }

        if count > 0 { println!("Replayed {} jobs from WAL", count); }
    }

    #[inline(always)]
    pub(crate) fn write_wal(&self, event: &WalEvent) {
        if !self.persistence { return; }
        let mut wal = self.wal.lock();
        if let Some(ref mut file) = *wal {
            if let Ok(json) = serde_json::to_string(event) {
                let _ = writeln!(file, "{}", json);
            }
        }
    }

    pub(crate) fn write_wal_batch(&self, jobs: &[Job]) {
        if !self.persistence || jobs.is_empty() { return; }
        let mut wal = self.wal.lock();
        if let Some(ref mut file) = *wal {
            for job in jobs {
                if let Ok(json) = serde_json::to_string(&WalEvent::Push(job.clone())) {
                    let _ = writeln!(file, "{}", json);
                }
            }
            let _ = file.flush();
        }
    }

    pub(crate) fn write_wal_acks(&self, ids: &[u64]) {
        if !self.persistence { return; }
        let mut wal = self.wal.lock();
        if let Some(ref mut file) = *wal {
            for &id in ids {
                if let Ok(json) = serde_json::to_string(&WalEvent::Ack(id)) {
                    let _ = writeln!(file, "{}", json);
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

    /// Notify all shards
    #[inline]
    pub(crate) fn notify_all(&self) {
        for shard in &self.shards {
            shard.read().notify.notify_waiters();
        }
    }
}
