//! Pull operations for retrieving jobs from the queue.
//!
//! Contains `pull`, `pull_batch`, and distributed pull implementations.

use std::sync::Arc;

use tokio::time::Duration;
use tracing::{debug, info, warn};

use super::manager::QueueManager;
use super::storage::Storage;
use super::types::{intern, now_ms, JobLocation};
use crate::protocol::Job;

impl QueueManager {
    /// Pull a job from the queue. Blocks until a job is available.
    /// In cluster mode, pulls from NATS streams for distributed processing.
    pub async fn pull(&self, queue_name: &str) -> Job {
        // Use NATS distributed pull in cluster mode
        if self.is_distributed_pull() {
            return self.pull_distributed(queue_name).await;
        }

        // Single node mode: use local in-memory queue
        self.pull_local(queue_name).await
    }

    /// Pull from NATS streams (cluster mode).
    async fn pull_distributed(&self, queue_name: &str) -> Job {
        info!(queue = %queue_name, "Starting distributed pull from NATS");
        let idx = Self::shard_index(queue_name);
        let queue_arc = intern(queue_name);

        enum DistributedPullResult {
            SleepPaused,
            SleepRateLimit,
            SleepConcurrency,
            TryNats,
            FallbackLocal,
        }

        loop {
            // Check state without holding lock across await
            let check_result = {
                let mut shard = self.shards[idx].write();
                let state = shard.get_state(&queue_arc);

                if state.paused {
                    DistributedPullResult::SleepPaused
                } else if state
                    .rate_limiter
                    .as_mut()
                    .is_some_and(|l| !l.try_acquire())
                {
                    DistributedPullResult::SleepRateLimit
                } else if state.concurrency.as_mut().is_some_and(|c| !c.try_acquire()) {
                    DistributedPullResult::SleepConcurrency
                } else if self.storage.is_some() {
                    DistributedPullResult::TryNats
                } else {
                    DistributedPullResult::FallbackLocal
                }
            };

            match check_result {
                DistributedPullResult::SleepPaused => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
                DistributedPullResult::SleepRateLimit | DistributedPullResult::SleepConcurrency => {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                    continue;
                }
                DistributedPullResult::FallbackLocal => {
                    warn!("Cluster mode enabled but no NATS storage, falling back to local pull");
                    return self.pull_local(queue_name).await;
                }
                DistributedPullResult::TryNats => {
                    // Pull from NATS streams (storage is guaranteed to be Some here)
                    debug!(queue = %queue_name, "Trying NATS pull");
                    let storage = self.storage.as_ref().unwrap();
                    match storage.pull_job_async(queue_name, 100).await {
                        Ok(Some(pulled_job)) => {
                            info!(queue = %queue_name, job_id = pulled_job.job.id, "Got job from NATS!");
                            let mut job = pulled_job.job;
                            let now = now_ms();
                            job.started_at = now;
                            job.last_heartbeat = now;

                            // Store ack token for later acknowledgment
                            self.store_nats_ack_token(job.id, pulled_job.ack_token);

                            // Track in processing
                            self.index_job(job.id, JobLocation::Processing);
                            self.processing_insert(job.clone());
                            self.metrics.record_pull();

                            return job;
                        }
                        Ok(None) => {
                            // No job available, release concurrency slot and wait
                            {
                                let mut shard = self.shards[idx].write();
                                let state = shard.get_state(&queue_arc);
                                if let Some(ref mut conc) = state.concurrency {
                                    conc.release();
                                }
                            }
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                        Err(e) => {
                            warn!(queue = %queue_name, error = %e, "NATS pull failed");
                            // Release concurrency slot
                            {
                                let mut shard = self.shards[idx].write();
                                let state = shard.get_state(&queue_arc);
                                if let Some(ref mut conc) = state.concurrency {
                                    conc.release();
                                }
                            }
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                    }
                }
            }
        }
    }

    /// Pull from local in-memory queue (single node mode).
    async fn pull_local(&self, queue_name: &str) -> Job {
        let idx = Self::shard_index(queue_name);
        let queue_arc = intern(queue_name);

        enum PullResult {
            Job(Box<Job>),
            Wait,
            SleepPaused,
            SleepRateLimit,
            SleepConcurrency,
        }

        loop {
            let now = now_ms();

            let pull_result = {
                let mut shard = self.shards[idx].write();
                let state = shard.get_state(&queue_arc);

                if state.paused {
                    PullResult::SleepPaused
                } else if state
                    .rate_limiter
                    .as_mut()
                    .is_some_and(|l| !l.try_acquire())
                {
                    PullResult::SleepRateLimit
                } else if state.concurrency.as_mut().is_some_and(|c| !c.try_acquire()) {
                    PullResult::SleepConcurrency
                } else {
                    let mut result = None;
                    let mut skipped_jobs: Vec<Job> = Vec::new();

                    // Clone active groups to avoid borrow conflict with heap
                    let active_groups: Option<std::collections::HashSet<String>> = shard
                        .active_groups
                        .get(&queue_arc)
                        .map(|g| g.iter().cloned().collect());

                    if let Some(heap) = shard.queues.get_mut(&queue_arc) {
                        loop {
                            // Safe pattern: pop directly and check, avoiding peek+expect race
                            match heap.pop() {
                                Some(job) if job.is_expired(now) => {
                                    // Expired job, continue to next
                                    continue;
                                }
                                Some(mut job) if job.is_ready(now) => {
                                    // Check if job's group is already active
                                    if let Some(ref group_id) = job.group_id {
                                        if active_groups
                                            .as_ref()
                                            .is_some_and(|g| g.contains(group_id))
                                        {
                                            // Group is busy, skip this job
                                            skipped_jobs.push(job);
                                            continue;
                                        }
                                    }
                                    job.started_at = now;
                                    job.last_heartbeat = now;
                                    result = Some(job);
                                    break;
                                }
                                Some(job) => {
                                    // Job not ready yet (delayed), put it back and stop
                                    heap.push(job);
                                    break;
                                }
                                None => break,
                            }
                        }

                        // Put back all skipped jobs
                        for job in skipped_jobs {
                            heap.push(job);
                        }
                    }

                    if let Some(ref job) = result {
                        // Mark group as active if job has a group_id
                        if let Some(ref group_id) = job.group_id {
                            shard
                                .active_groups
                                .entry(queue_arc.clone())
                                .or_default()
                                .insert(group_id.clone());
                        }
                        PullResult::Job(Box::new(result.unwrap()))
                    } else {
                        let state = shard.get_state(&queue_arc);
                        if let Some(ref mut conc) = state.concurrency {
                            conc.release();
                        }
                        PullResult::Wait
                    }
                }
            };

            match pull_result {
                PullResult::Job(job) => {
                    self.index_job(job.id, JobLocation::Processing);
                    self.processing_insert((*job).clone());
                    self.metrics.record_pull();
                    return *job;
                }
                PullResult::SleepPaused => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                PullResult::SleepRateLimit | PullResult::SleepConcurrency => {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                PullResult::Wait => {
                    // Simple polling - wait for notify with timeout
                    let notify = {
                        let shard = self.shards[idx].read();
                        Arc::clone(&shard.notify)
                    };
                    // Wait max 100ms then retry
                    let _ =
                        tokio::time::timeout(Duration::from_millis(100), notify.notified()).await;
                }
            }
        }
    }

    /// Pull multiple jobs from the queue. Blocks until at least one job is available.
    /// In cluster mode, pulls from NATS streams for distributed processing.
    pub async fn pull_batch(&self, queue_name: &str, count: usize) -> Vec<Job> {
        // Use NATS distributed pull in cluster mode
        if self.is_distributed_pull() {
            return self.pull_batch_distributed(queue_name, count).await;
        }

        // Single node mode: use local in-memory queue
        self.pull_batch_local(queue_name, count).await
    }

    /// Pull batch from NATS streams (cluster mode).
    async fn pull_batch_distributed(&self, queue_name: &str, count: usize) -> Vec<Job> {
        let idx = Self::shard_index(queue_name);
        let queue_arc = intern(queue_name);

        enum BatchPullCheck {
            Paused,
            NoSlots,
            TryNats(usize), // slots_acquired
            FallbackLocal,
        }

        loop {
            // Check state and acquire slots without holding lock across await
            let check_result = {
                let mut shard = self.shards[idx].write();
                let state = shard.get_state(&queue_arc);

                if state.paused {
                    BatchPullCheck::Paused
                } else if self.storage.is_none() {
                    BatchPullCheck::FallbackLocal
                } else {
                    // Acquire concurrency slots
                    let slots = if state.concurrency.is_some() {
                        let mut acquired = 0usize;
                        if let Some(ref mut conc) = state.concurrency {
                            while acquired < count && conc.try_acquire() {
                                acquired += 1;
                            }
                        }
                        acquired
                    } else {
                        count
                    };

                    if slots == 0 {
                        BatchPullCheck::NoSlots
                    } else {
                        BatchPullCheck::TryNats(slots)
                    }
                }
            };

            match check_result {
                BatchPullCheck::Paused => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
                BatchPullCheck::NoSlots => {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                    continue;
                }
                BatchPullCheck::FallbackLocal => {
                    warn!("Cluster mode enabled but no NATS storage, falling back to local pull");
                    return self.pull_batch_local(queue_name, count).await;
                }
                BatchPullCheck::TryNats(slots_acquired) => {
                    // Pull from NATS streams (storage is guaranteed to be Some here)
                    let storage = self.storage.as_ref().unwrap();
                    match storage
                        .pull_jobs_batch_async(queue_name, slots_acquired, 100)
                        .await
                    {
                        Ok(pulled_jobs) if !pulled_jobs.is_empty() => {
                            let now = now_ms();
                            let mut result = Vec::with_capacity(pulled_jobs.len());

                            for pulled_job in pulled_jobs {
                                let mut job = pulled_job.job;
                                job.started_at = now;
                                job.last_heartbeat = now;

                                // Store ack token for later acknowledgment
                                self.store_nats_ack_token(job.id, pulled_job.ack_token);

                                // Track in processing
                                self.index_job(job.id, JobLocation::Processing);
                                self.processing_insert(job.clone());
                                self.metrics.record_pull();
                                result.push(job);
                            }

                            // Release unused concurrency slots
                            if result.len() < slots_acquired {
                                let mut shard = self.shards[idx].write();
                                let state = shard.get_state(&queue_arc);
                                if let Some(ref mut conc) = state.concurrency {
                                    for _ in 0..(slots_acquired - result.len()) {
                                        conc.release();
                                    }
                                }
                            }

                            return result;
                        }
                        Ok(_) => {
                            // No jobs available, release slots and wait
                            {
                                let mut shard = self.shards[idx].write();
                                let state = shard.get_state(&queue_arc);
                                if let Some(ref mut conc) = state.concurrency {
                                    for _ in 0..slots_acquired {
                                        conc.release();
                                    }
                                }
                            }
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                        Err(e) => {
                            warn!(queue = %queue_name, error = %e, "NATS batch pull failed");
                            // Release slots
                            {
                                let mut shard = self.shards[idx].write();
                                let state = shard.get_state(&queue_arc);
                                if let Some(ref mut conc) = state.concurrency {
                                    for _ in 0..slots_acquired {
                                        conc.release();
                                    }
                                }
                            }
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                    }
                }
            }
        }
    }

    /// Pull batch from local in-memory queue (single node mode).
    async fn pull_batch_local(&self, queue_name: &str, count: usize) -> Vec<Job> {
        let idx = Self::shard_index(queue_name);
        let queue_arc = intern(queue_name);
        let mut result = Vec::with_capacity(count);

        enum BatchResult {
            Jobs(Vec<Job>),
            Paused,
            Wait,
        }

        loop {
            let now = now_ms();

            let batch_result = {
                let mut shard = self.shards[idx].write();
                let state = shard.get_state(&queue_arc);

                if state.paused {
                    BatchResult::Paused
                } else {
                    let has_concurrency = state.concurrency.is_some();
                    let mut jobs = Vec::new();
                    let mut slots_acquired = 0usize;

                    // Acquire concurrency slots
                    if has_concurrency {
                        let state = shard.get_state(&queue_arc);
                        if let Some(ref mut conc) = state.concurrency {
                            while slots_acquired < count && conc.try_acquire() {
                                slots_acquired += 1;
                            }
                        }
                    } else {
                        slots_acquired = count;
                    }

                    if slots_acquired > 0 {
                        let mut skipped_jobs: Vec<Job> = Vec::new();

                        // Clone active groups to avoid borrow conflict with heap
                        let existing_active: Option<std::collections::HashSet<String>> = shard
                            .active_groups
                            .get(&queue_arc)
                            .map(|g| g.iter().cloned().collect());

                        if let Some(heap) = shard.queues.get_mut(&queue_arc) {
                            let mut newly_activated: Vec<String> = Vec::new();

                            while jobs.len() < slots_acquired {
                                // Safe pattern: pop directly and check, avoiding peek+expect race
                                match heap.pop() {
                                    Some(job) if job.is_expired(now) => {
                                        // Expired job, continue to next
                                        continue;
                                    }
                                    Some(mut job) if job.is_ready(now) => {
                                        // Check if job's group is already active
                                        if let Some(ref group_id) = job.group_id {
                                            let is_active = existing_active
                                                .as_ref()
                                                .is_some_and(|g| g.contains(group_id))
                                                || newly_activated.contains(group_id);
                                            if is_active {
                                                // Group is busy, skip this job
                                                skipped_jobs.push(job);
                                                continue;
                                            }
                                            // Mark group as being activated in this batch
                                            newly_activated.push(group_id.clone());
                                        }
                                        job.started_at = now;
                                        job.last_heartbeat = now;
                                        jobs.push(job);
                                    }
                                    Some(job) => {
                                        // Job not ready yet (delayed), put it back and stop
                                        heap.push(job);
                                        break;
                                    }
                                    None => break,
                                }
                            }

                            // Put back all skipped jobs
                            for job in skipped_jobs {
                                heap.push(job);
                            }
                        }

                        // Mark groups as active for all jobs we're returning
                        for job in &jobs {
                            if let Some(ref group_id) = job.group_id {
                                shard
                                    .active_groups
                                    .entry(queue_arc.clone())
                                    .or_default()
                                    .insert(group_id.clone());
                            }
                        }

                        // Release unused concurrency slots
                        if has_concurrency && jobs.len() < slots_acquired {
                            let state = shard.get_state(&queue_arc);
                            if let Some(ref mut conc) = state.concurrency {
                                for _ in 0..(slots_acquired - jobs.len()) {
                                    conc.release();
                                }
                            }
                        }
                    }

                    if jobs.is_empty() {
                        BatchResult::Wait
                    } else {
                        BatchResult::Jobs(jobs)
                    }
                }
            };

            match batch_result {
                BatchResult::Jobs(jobs) => {
                    for job in jobs {
                        self.index_job(job.id, JobLocation::Processing);
                        self.processing_insert(job.clone());
                        self.metrics.record_pull();
                        result.push(job);
                    }
                    return result;
                }
                BatchResult::Paused => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                BatchResult::Wait => {
                    // Simple polling - wait for notify with timeout
                    let notify = {
                        let shard = self.shards[idx].read();
                        Arc::clone(&shard.notify)
                    };
                    let _ =
                        tokio::time::timeout(Duration::from_millis(100), notify.notified()).await;
                }
            }
        }
    }

    /// Pull jobs from queue without waiting (non-blocking version of pull_batch).
    /// Returns immediately with whatever jobs are available (may be empty).
    /// Used primarily for testing and situations where blocking is not desired.
    #[allow(dead_code)]
    pub async fn pull_batch_nowait(&self, queue_name: &str, count: usize) -> Vec<Job> {
        let idx = Self::shard_index(queue_name);
        let queue_arc = intern(queue_name);
        let now = now_ms();

        let mut jobs = Vec::new();
        let mut skipped_jobs: Vec<Job> = Vec::new();

        {
            let mut shard = self.shards[idx].write();
            let state = shard.get_state(&queue_arc);

            if state.paused {
                return jobs;
            }

            let has_concurrency = state.concurrency.is_some();
            let mut slots_acquired = 0usize;

            if has_concurrency {
                let state = shard.get_state(&queue_arc);
                if let Some(ref mut conc) = state.concurrency {
                    while slots_acquired < count && conc.try_acquire() {
                        slots_acquired += 1;
                    }
                }
            } else {
                slots_acquired = count;
            }

            if slots_acquired > 0 {
                // Clone active groups to avoid borrow conflict with heap
                let existing_active: Option<std::collections::HashSet<String>> = shard
                    .active_groups
                    .get(&queue_arc)
                    .map(|g| g.iter().cloned().collect());

                if let Some(heap) = shard.queues.get_mut(&queue_arc) {
                    let mut newly_activated: Vec<String> = Vec::new();

                    while jobs.len() < slots_acquired {
                        match heap.pop() {
                            Some(job) if job.is_expired(now) => {
                                continue;
                            }
                            Some(mut job) if job.is_ready(now) => {
                                // Check if job's group is already active
                                if let Some(ref group_id) = job.group_id {
                                    let is_active = existing_active
                                        .as_ref()
                                        .is_some_and(|g| g.contains(group_id))
                                        || newly_activated.contains(group_id);
                                    if is_active {
                                        skipped_jobs.push(job);
                                        continue;
                                    }
                                    newly_activated.push(group_id.clone());
                                }
                                job.started_at = now;
                                job.last_heartbeat = now;
                                jobs.push(job);
                            }
                            Some(job) => {
                                heap.push(job);
                                break;
                            }
                            None => break,
                        }
                    }

                    // Put back all skipped jobs
                    for job in skipped_jobs {
                        heap.push(job);
                    }
                }

                // Mark groups as active for all jobs we're returning
                for job in &jobs {
                    if let Some(ref group_id) = job.group_id {
                        shard
                            .active_groups
                            .entry(queue_arc.clone())
                            .or_default()
                            .insert(group_id.clone());
                    }
                }

                if has_concurrency && jobs.len() < slots_acquired {
                    let state = shard.get_state(&queue_arc);
                    if let Some(ref mut conc) = state.concurrency {
                        for _ in 0..(slots_acquired - jobs.len()) {
                            conc.release();
                        }
                    }
                }
            }
        }

        // Index and track jobs
        for job in &jobs {
            self.index_job(job.id, JobLocation::Processing);
            self.processing_insert(job.clone());
            self.metrics.record_pull();
        }

        jobs
    }
}
