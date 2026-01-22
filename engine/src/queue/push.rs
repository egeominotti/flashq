//! Push operations for adding jobs to the queue.
//!
//! Contains `push` and `push_batch` implementations for the QueueManager.

use super::manager::QueueManager;
use super::types::{intern, now_ms, JobLocation};
use super::validation::{validate_job_data, validate_queue_name, MAX_BATCH_SIZE};
use crate::protocol::{Job, JobBuilder, JobEvent, JobInput};

impl QueueManager {
    /// Create a job from JobInput using the builder pattern.
    #[inline(always)]
    pub fn create_job_from_input(&self, id: u64, queue: String, input: JobInput) -> Job {
        JobBuilder::new(queue, input.data)
            .priority(input.priority)
            .delay_opt(input.delay)
            .ttl_opt(input.ttl)
            .timeout_opt(input.timeout)
            .max_attempts_opt(input.max_attempts)
            .backoff_opt(input.backoff)
            .unique_key_opt(input.unique_key)
            .depends_on_opt(input.depends_on)
            .tags_opt(input.tags)
            .lifo(input.lifo)
            .remove_on_complete(input.remove_on_complete)
            .remove_on_fail(input.remove_on_fail)
            .stall_timeout_opt(input.stall_timeout)
            .custom_id_opt(input.job_id)
            .keep_completed_age_opt(input.keep_completed_age)
            .keep_completed_count_opt(input.keep_completed_count)
            .group_id_opt(input.group_id)
            .build(id, now_ms())
    }

    /// Push a job to a queue with all options specified via JobInput.
    pub async fn push(&self, queue: String, input: JobInput) -> Result<Job, String> {
        // Validate inputs to prevent DoS attacks
        validate_queue_name(&queue)?;
        validate_job_data(&input.data)?;

        // Check debounce - prevent duplicate jobs within time window
        // OPTIMIZATION: Uses nested CompactString map to avoid String allocation
        // FIX: Use write lock and insert atomically to prevent race condition
        if let Some(ref id) = input.debounce_id {
            let now = now_ms();
            let queue_key = intern(&queue);
            let id_key = intern(id);
            let ttl = input.debounce_ttl.unwrap_or(5000);
            let expiry = now + ttl;

            let mut debounce_cache = self.debounce_cache.write();
            let queue_map = debounce_cache.entry(queue_key).or_default();

            // Check and insert atomically
            if let Some(&existing_expiry) = queue_map.get(&id_key) {
                if now < existing_expiry {
                    return Err(format!(
                        "Debounced: job with id '{}' was pushed recently",
                        id
                    ));
                }
            }
            // Insert/update the debounce entry immediately (atomic with check)
            queue_map.insert(id_key, expiry);
        }

        // Get cluster-wide unique ID from SQLite sequence
        // NOTE: Generated BEFORE custom_id check to enable atomic check+insert
        let internal_id = self.next_job_id().await;

        // Check custom job ID for idempotency - atomic check+insert to prevent race condition
        if let Some(ref custom_id) = input.job_id {
            let mut custom_id_map = self.custom_id_map.write();
            if let Some(&existing_id) = custom_id_map.get(custom_id) {
                // Return the existing job instead of creating a duplicate
                if let Some(job) = self.get_job_by_internal_id(existing_id) {
                    return Ok(job);
                }
                // Existing ID points to non-existent job (stale entry), remove it
                custom_id_map.remove(custom_id);
            }
            // Insert atomically with check to prevent race condition
            custom_id_map.insert(custom_id.clone(), internal_id);
        }

        let job = self.create_job_from_input(internal_id, queue.clone(), input.clone());

        let idx = Self::shard_index(&queue);
        let queue_name = intern(&queue);

        // CRITICAL: Check dependencies FIRST (before acquiring shard lock) to avoid deadlock.
        // stats() holds completed_jobs.read() then acquires shard.read()
        // We must NOT hold shard.write() while acquiring completed_jobs.read()
        let needs_waiting_deps = if !job.depends_on.is_empty() {
            let completed = self.completed_jobs.read();
            !job.depends_on.iter().all(|dep| completed.contains(dep))
        } else {
            false
        };

        // Track if unique key check fails (for rollback outside shard lock)
        let mut unique_key_failed = false;

        {
            let mut shard = self.shards[idx].write();

            // Check unique key
            if let Some(ref key) = input.unique_key {
                let keys = shard.unique_keys.entry(queue_name.clone()).or_default();
                if keys.contains(key) {
                    unique_key_failed = true;
                    // Don't acquire custom_id_map.write() here - would deadlock!
                } else {
                    keys.insert(key.clone());
                }
            }

            // Only proceed if unique key check passed
            if !unique_key_failed {
                // Add to appropriate location based on deps check done above
                if needs_waiting_deps {
                    shard.waiting_deps.insert(job.id, job.clone());
                    self.index_job(job.id, JobLocation::WaitingDeps { shard_idx: idx });
                } else {
                    shard
                        .queues
                        .entry(queue_name)
                        .or_default()
                        .push(job.clone());
                    self.index_job(job.id, JobLocation::Queue { shard_idx: idx });
                }
            }
        } // Lock released here before any await

        // Rollback custom_id OUTSIDE shard lock to avoid deadlock
        if unique_key_failed {
            if let Some(ref custom_id) = input.job_id {
                self.custom_id_map.write().remove(custom_id);
            }
            return Err(format!(
                "Duplicate job with key: {}",
                input.unique_key.as_ref().unwrap()
            ));
        }

        // Handle jobs waiting for dependencies
        if needs_waiting_deps {
            // Use sync persistence if enabled for durability guarantee
            if self.is_sync_persistence() {
                if let Err(e) = self.persist_push_sync(&job, "waiting_children").await {
                    // Rollback: remove from waiting_deps and index
                    {
                        let mut shard = self.shards[idx].write();
                        shard.waiting_deps.remove(&job.id);
                    }
                    self.unindex_job(job.id);
                    // Rollback custom_id OUTSIDE shard lock to avoid deadlock
                    if let Some(ref custom_id) = input.job_id {
                        self.custom_id_map.write().remove(custom_id);
                    }
                    return Err(e);
                }
            } else {
                self.persist_push(&job, "waiting_children");
            }
            return Ok(job);
        }

        // Persist to SQLite - use sync mode if enabled
        if self.is_sync_persistence() {
            if let Err(e) = self.persist_push_sync(&job, "waiting").await {
                // Rollback: remove from queue and index
                {
                    let rollback_queue = intern(&queue);
                    let mut shard = self.shards[idx].write();
                    if let Some(heap) = shard.queues.get_mut(&rollback_queue) {
                        heap.retain(|j| j.id != job.id);
                    }
                }
                self.unindex_job(job.id);
                // Rollback custom_id OUTSIDE shard lock to avoid deadlock
                if let Some(ref custom_id) = input.job_id {
                    self.custom_id_map.write().remove(custom_id);
                }
                return Err(e);
            }
        } else {
            self.persist_push(&job, "waiting");
        }

        self.metrics.record_push(1);
        self.notify_shard(idx);

        // Note: debounce cache and custom_id are updated atomically at the start of push()

        // OPTIMIZATION: Only allocate JobEvent if there are listeners
        if self.has_event_listeners() {
            self.broadcast_event(JobEvent {
                event_type: "pushed".to_string(),
                queue: job.queue.clone(),
                job_id: job.id,
                timestamp: now_ms(),
                data: Some((*job.data).clone()),
                error: None,
                progress: None,
            });
        }

        Ok(job)
    }

    pub async fn push_batch(&self, queue: String, jobs: Vec<JobInput>) -> Vec<u64> {
        // Validate queue name
        if validate_queue_name(&queue).is_err() {
            return Vec::new();
        }

        // Validate batch size to prevent DoS
        if jobs.len() > MAX_BATCH_SIZE {
            return Vec::new();
        }

        // Filter valid jobs and check debounce atomically
        // FIX: Use write lock and insert atomically to prevent race condition
        let now = now_ms();
        let queue_key = intern(&queue);
        let valid_jobs: Vec<_> = {
            let mut debounce_cache = self.debounce_cache.write();
            let queue_debounce = debounce_cache.entry(queue_key.clone()).or_default();
            jobs.into_iter()
                .filter(|input| {
                    // Check data validity
                    if validate_job_data(&input.data).is_err() {
                        return false;
                    }
                    // Check debounce and insert atomically
                    if let Some(ref id) = input.debounce_id {
                        let id_key = intern(id);
                        let ttl = input.debounce_ttl.unwrap_or(5000);
                        let expiry = now + ttl;

                        if let Some(&existing_expiry) = queue_debounce.get(&id_key) {
                            if now < existing_expiry {
                                return false; // Debounced
                            }
                        }
                        // Insert/update atomically with check
                        queue_debounce.insert(id_key, expiry);
                    }
                    true
                })
                .collect()
        };

        if valid_jobs.is_empty() {
            return Vec::new();
        }

        // Get cluster-wide unique IDs for all jobs at once
        let job_ids = self.next_job_ids(valid_jobs.len()).await;

        let mut ids = Vec::with_capacity(valid_jobs.len());
        let mut created_jobs = Vec::with_capacity(valid_jobs.len());
        let mut waiting_jobs = Vec::new();

        let idx = Self::shard_index(&queue);
        let queue_name = intern(&queue);

        // CRITICAL: Copy completed_jobs to local set FIRST to avoid lock starvation.
        // With write-preferring RwLock, holding read() while iterating 1000 jobs
        // causes push_batch callers to be blocked by pending ack() writers.
        // This was causing timeouts after 9M+ jobs due to accumulated contention.
        let completed: std::collections::HashSet<u64> =
            self.completed_jobs.read().iter().copied().collect();

        // Now iterate WITHOUT holding any locks on completed_jobs
        for (input, job_id) in valid_jobs.into_iter().zip(job_ids.into_iter()) {
            let job = self.create_job_from_input(job_id, queue.clone(), input);
            ids.push(job.id);

            if !job.depends_on.is_empty()
                && !job.depends_on.iter().all(|dep| completed.contains(dep))
            {
                waiting_jobs.push(job);
                continue;
            }
            created_jobs.push(job);
        }

        // Persist first (needs references), then insert (consumes jobs)
        self.persist_push_batch(&created_jobs, "waiting");
        self.persist_push_batch(&waiting_jobs, "waiting_children");

        {
            let mut shard = self.shards[idx].write();
            let heap = shard.queues.entry(queue_name).or_default();
            // Use into_iter to move jobs instead of cloning
            for job in created_jobs {
                self.index_job(job.id, JobLocation::Queue { shard_idx: idx });
                heap.push(job);
            }
            for job in waiting_jobs {
                let job_id = job.id;
                self.index_job(job_id, JobLocation::WaitingDeps { shard_idx: idx });
                shard.waiting_deps.insert(job_id, job);
            }
        }

        // Note: debounce cache is updated atomically during filtering above

        self.metrics.record_push(ids.len() as u64);
        self.notify_shard(idx);
        ids
    }
}
