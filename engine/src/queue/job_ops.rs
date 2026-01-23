//! Job operations.
//!
//! Individual job management: cancel, progress, priority changes, etc.

use std::sync::Arc;

use serde_json::Value;
use tracing::warn;

use super::manager::QueueManager;
use super::storage::Storage;
use super::types::{intern, now_ms, JobLocation};

impl QueueManager {
    /// Cancel a job that is waiting, delayed, or in processing.
    pub async fn cancel(&self, job_id: u64) -> Result<(), String> {
        // Use job_index for O(1) lock-free lookup of location
        let location = self.job_index.get(&job_id).map(|r| r.clone());

        match location {
            Some(JobLocation::Processing) => {
                if let Some(job) = self.processing_remove(job_id) {
                    let idx = Self::shard_index(&job.queue);
                    let queue_arc = intern(&job.queue);
                    {
                        let mut shard = self.shards[idx].write();
                        shard.release_concurrency(&queue_arc);
                        shard.remove_unique_key(&queue_arc, job.unique_key.as_ref());
                    }
                    self.unindex_job(job_id);
                    self.persist_cancel(job_id);
                    // Notify waiters that job was cancelled (prevents memory leak)
                    self.notify_job_waiters(job_id, None);
                    return Ok(());
                }
            }
            Some(JobLocation::WaitingDeps { shard_idx }) => {
                if self.shards[shard_idx]
                    .write()
                    .waiting_deps
                    .remove(&job_id)
                    .is_some()
                {
                    self.unindex_job(job_id);
                    self.persist_cancel(job_id);
                    // Notify waiters that job was cancelled (prevents memory leak)
                    self.notify_job_waiters(job_id, None);
                    return Ok(());
                }
            }
            Some(JobLocation::Queue {
                shard_idx,
                queue_name,
            }) => {
                let mut shard = self.shards[shard_idx].write();

                // O(1) direct lookup using queue_name from JobLocation
                if let Some(heap) = shard.queues.get_mut(&queue_name) {
                    // Direct O(1) removal from IndexedPriorityQueue
                    if let Some(removed_job) = heap.remove(job_id) {
                        shard.remove_unique_key(&queue_name, removed_job.unique_key.as_ref());
                        drop(shard);
                        self.unindex_job(job_id);
                        self.persist_cancel(job_id);
                        // Notify waiters that job was cancelled (prevents memory leak)
                        self.notify_job_waiters(job_id, None);
                        return Ok(());
                    }
                }
            }
            Some(JobLocation::WaitingChildren { shard_idx }) => {
                if self.shards[shard_idx]
                    .write()
                    .waiting_children
                    .remove(&job_id)
                    .is_some()
                {
                    self.unindex_job(job_id);
                    self.persist_cancel(job_id);
                    // Notify waiters that job was cancelled (prevents memory leak)
                    self.notify_job_waiters(job_id, None);
                    return Ok(());
                }
            }
            Some(JobLocation::Dlq { .. }) | Some(JobLocation::Completed) => {
                return Err(format!(
                    "Job {} cannot be cancelled (already completed/failed)",
                    job_id
                ));
            }
            None => {}
        }

        Err(format!("Job {} not found", job_id))
    }

    /// Update job progress (0-100) with optional message.
    pub async fn update_progress(
        &self,
        job_id: u64,
        progress: u8,
        message: Option<String>,
    ) -> Result<(), String> {
        let updated = self.processing_get_mut(job_id, |job| {
            job.progress = progress.min(100);
            job.progress_msg = message.clone();
            job.queue.clone()
        });
        if let Some(queue) = updated {
            if let Some(job) = self.processing_get(job_id) {
                self.notify_subscribers("progress", &queue, &job);
            }
            return Ok(());
        }
        Err(format!("Job {} not found in processing", job_id))
    }

    /// Get job progress (0-100) and optional message.
    pub async fn get_progress(&self, job_id: u64) -> Result<(u8, Option<String>), String> {
        if let Some(job) = self.processing_get(job_id) {
            return Ok((job.progress, job.progress_msg.clone()));
        }
        Err(format!("Job {} not found", job_id))
    }

    /// Change priority of a job (waiting, delayed, or processing).
    pub async fn change_priority(&self, job_id: u64, new_priority: i32) -> Result<(), String> {
        let location = self.job_index.get(&job_id).map(|r| r.clone());

        match location {
            Some(JobLocation::Processing) => {
                // Easy case: just update in sharded HashMap
                let updated = self.processing_get_mut(job_id, |job| {
                    job.priority = new_priority;
                });
                if updated.is_none() {
                    return Err(format!("Job {} not found in processing", job_id));
                }

                // Persist
                if let Some(ref storage) = self.storage {
                    if let Err(e) = storage.change_priority(job_id, new_priority) {
                        warn!(job_id, error = %e, "Failed to persist priority change to storage");
                    }
                }
                Ok(())
            }

            Some(JobLocation::Queue {
                shard_idx,
                queue_name,
            }) => {
                // O(log n) update using IndexedPriorityQueue - direct O(1) lookup with queue_name
                let found = {
                    let mut shard = self.shards[shard_idx].write();

                    if let Some(heap) = shard.queues.get_mut(&queue_name) {
                        // O(log n) update: remove + re-insert with new priority
                        if let Some(mut job) = heap.remove(job_id) {
                            job.priority = new_priority;
                            heap.push(job);
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                };

                if found {
                    // Persist (lock dropped before await)
                    if let Some(ref storage) = self.storage {
                        if let Err(e) = storage.change_priority(job_id, new_priority) {
                            warn!(job_id, error = %e, "Failed to persist priority change to storage");
                        }
                    }
                    return Ok(());
                }
                Err(format!("Job {} not found in queue", job_id))
            }

            Some(JobLocation::Dlq {
                shard_idx,
                queue_name,
            }) => {
                // O(1) lookup using queue_name from JobLocation
                let found = {
                    let mut shard = self.shards[shard_idx].write();
                    if let Some(dlq) = shard.dlq.get_mut(&queue_name) {
                        if let Some(job) = dlq.iter_mut().find(|j| j.id == job_id) {
                            job.priority = new_priority;
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                };

                if found {
                    // Persist (lock dropped before await)
                    if let Some(ref storage) = self.storage {
                        if let Err(e) = storage.change_priority(job_id, new_priority) {
                            warn!(job_id, error = %e, "Failed to persist priority change to storage");
                        }
                    }
                    return Ok(());
                }
                Err(format!("Job {} not found in DLQ", job_id))
            }

            Some(JobLocation::WaitingDeps { shard_idx }) => {
                let found = {
                    let mut shard = self.shards[shard_idx].write();
                    if let Some(job) = shard.waiting_deps.get_mut(&job_id) {
                        job.priority = new_priority;
                        true
                    } else {
                        false
                    }
                };

                if found {
                    // Persist (lock dropped before await)
                    if let Some(ref storage) = self.storage {
                        if let Err(e) = storage.change_priority(job_id, new_priority) {
                            warn!(job_id, error = %e, "Failed to persist priority change to storage");
                        }
                    }
                    return Ok(());
                }
                Err(format!("Job {} not found in waiting deps", job_id))
            }

            Some(JobLocation::WaitingChildren { shard_idx }) => {
                let found = {
                    let mut shard = self.shards[shard_idx].write();
                    if let Some(job) = shard.waiting_children.get_mut(&job_id) {
                        job.priority = new_priority;
                        true
                    } else {
                        false
                    }
                };

                if found {
                    // Persist (lock dropped before await)
                    if let Some(ref storage) = self.storage {
                        if let Err(e) = storage.change_priority(job_id, new_priority) {
                            warn!(job_id, error = %e, "Failed to persist priority change to storage");
                        }
                    }
                    return Ok(());
                }
                Err(format!("Job {} not found in waiting children", job_id))
            }

            _ => Err(format!(
                "Job {} not found or cannot change priority",
                job_id
            )),
        }
    }

    /// Move a processing job back to delayed state.
    pub async fn move_to_delayed(&self, job_id: u64, delay_ms: u64) -> Result<(), String> {
        let now = now_ms();

        // 1. Check job is in processing and remove it (sharded)
        let job = self
            .processing_remove(job_id)
            .ok_or_else(|| format!("Job {} not in processing", job_id))?;

        // 2. Update job
        let mut job = job;
        job.run_at = now + delay_ms;
        job.started_at = 0;
        job.progress = 0;
        job.progress_msg = None;

        // 3. Get shard and push to queue
        let idx = Self::shard_index(&job.queue);
        let queue_arc = intern(&job.queue);

        // 4. Update index first
        self.index_job(
            job_id,
            JobLocation::Queue {
                shard_idx: idx,
                queue_name: queue_arc.clone(),
            },
        );

        // 5. Persist (needs run_at value)
        let run_at = job.run_at;
        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.move_to_delayed(job_id, run_at) {
                warn!(job_id, error = %e, "Failed to persist move_to_delayed to storage");
            }
        }

        // 6. Push to queue (moves ownership, no clone needed)
        {
            let mut shard = self.shards[idx].write();

            // Release concurrency slot if any
            let state = shard.get_state(&queue_arc);
            if let Some(ref mut conc) = state.concurrency {
                conc.release();
            }

            let heap = shard.queues.entry(queue_arc).or_default();
            heap.push(job);
        }

        Ok(())
    }

    /// Promote a delayed job to waiting (make it ready immediately).
    pub async fn promote(&self, job_id: u64) -> Result<(), String> {
        let location = self.job_index.get(&job_id).map(|r| r.clone());
        let now = now_ms();

        match location {
            Some(JobLocation::Queue {
                shard_idx,
                queue_name,
            }) => {
                // O(log n) update using IndexedPriorityQueue - direct O(1) lookup with queue_name
                let (found, was_delayed) = {
                    let mut shard = self.shards[shard_idx].write();

                    if let Some(heap) = shard.queues.get_mut(&queue_name) {
                        // O(log n) update: remove, modify, re-insert
                        if let Some(mut job) = heap.remove(job_id) {
                            if job.run_at > now {
                                job.run_at = now;
                                heap.push(job);
                                (true, true)
                            } else {
                                // Not delayed, put it back
                                heap.push(job);
                                (true, false)
                            }
                        } else {
                            (false, false)
                        }
                    } else {
                        (false, false)
                    }
                };

                if !found {
                    return Err(format!("Job {} not found in queue", job_id));
                }
                if !was_delayed {
                    return Err(format!("Job {} is not delayed", job_id));
                }

                // Persist (lock dropped)
                if let Some(ref storage) = self.storage {
                    if let Err(e) = storage.promote_job(job_id, now) {
                        warn!(job_id, error = %e, "Failed to persist job promotion to storage");
                    }
                }

                Ok(())
            }
            _ => Err(format!("Job {} not found or not in delayed state", job_id)),
        }
    }

    /// Update job data.
    pub async fn update_job_data(&self, job_id: u64, new_data: Value) -> Result<(), String> {
        let location = self.job_index.get(&job_id).map(|r| r.clone());

        match location {
            Some(JobLocation::Processing) => {
                let found = self
                    .processing_get_mut(job_id, |job| {
                        job.data = Arc::new(new_data.clone());
                    })
                    .is_some();

                if found {
                    // Persist
                    if let Some(ref storage) = self.storage {
                        if let Err(e) = storage.update_job_data(job_id, &new_data) {
                            warn!(job_id, error = %e, "Failed to persist job data update to storage");
                        }
                    }
                    Ok(())
                } else {
                    Err(format!("Job {} not found in processing", job_id))
                }
            }

            Some(JobLocation::Queue {
                shard_idx,
                queue_name,
            }) => {
                // O(log n) update using IndexedPriorityQueue - direct O(1) lookup with queue_name
                let found = {
                    let mut shard = self.shards[shard_idx].write();

                    if let Some(heap) = shard.queues.get_mut(&queue_name) {
                        // O(log n) update: remove, modify, re-insert
                        if let Some(mut job) = heap.remove(job_id) {
                            job.data = Arc::new(new_data.clone());
                            heap.push(job);
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                };

                if found {
                    // Persist (lock dropped)
                    if let Some(ref storage) = self.storage {
                        if let Err(e) = storage.update_job_data(job_id, &new_data) {
                            warn!(job_id, error = %e, "Failed to persist job data update to storage");
                        }
                    }
                    Ok(())
                } else {
                    Err(format!("Job {} not found in queue", job_id))
                }
            }

            Some(JobLocation::Dlq {
                shard_idx,
                queue_name,
            }) => {
                // O(1) lookup using queue_name from JobLocation
                let found = {
                    let mut shard = self.shards[shard_idx].write();
                    if let Some(dlq) = shard.dlq.get_mut(&queue_name) {
                        if let Some(job) = dlq.iter_mut().find(|j| j.id == job_id) {
                            job.data = Arc::new(new_data.clone());
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                };

                if found {
                    // Persist (lock dropped)
                    if let Some(ref storage) = self.storage {
                        if let Err(e) = storage.update_job_data(job_id, &new_data) {
                            warn!(job_id, error = %e, "Failed to persist job data update to storage");
                        }
                    }
                    Ok(())
                } else {
                    Err(format!("Job {} not found in DLQ", job_id))
                }
            }

            _ => Err(format!("Job {} not found", job_id)),
        }
    }

    /// Discard a job (prevent further retries, move to DLQ immediately).
    pub async fn discard(&self, job_id: u64) -> Result<(), String> {
        let location = self.job_index.get(&job_id).map(|r| r.clone());

        match location {
            Some(JobLocation::Processing) => {
                // Remove from processing (sharded)
                let job = self
                    .processing_remove(job_id)
                    .ok_or_else(|| format!("Job {} not in processing", job_id))?;

                // Move directly to DLQ
                let idx = Self::shard_index(&job.queue);
                let queue_arc = intern(&job.queue);

                {
                    let mut shard = self.shards[idx].write();

                    // Release concurrency slot if any
                    let state = shard.get_state(&queue_arc);
                    if let Some(ref mut conc) = state.concurrency {
                        conc.release();
                    }

                    let dlq = shard.dlq.entry(queue_arc.clone()).or_default();
                    dlq.push_back(job);
                }

                // Update index
                self.index_job(
                    job_id,
                    JobLocation::Dlq {
                        shard_idx: idx,
                        queue_name: queue_arc,
                    },
                );

                // Persist
                if let Some(ref storage) = self.storage {
                    if let Err(e) = storage.discard_job(job_id) {
                        warn!(job_id, error = %e, "Failed to persist job discard to storage");
                    }
                }

                Ok(())
            }

            Some(JobLocation::Queue {
                shard_idx,
                queue_name,
            }) => {
                // O(1) removal using IndexedPriorityQueue and move to DLQ - direct lookup with queue_name
                let found = {
                    let mut shard = self.shards[shard_idx].write();

                    if let Some(heap) = shard.queues.get_mut(&queue_name) {
                        // O(1) removal from IndexedPriorityQueue
                        if let Some(job) = heap.remove(job_id) {
                            let dlq = shard.dlq.entry(queue_name.clone()).or_default();
                            dlq.push_back(job);

                            // Update index
                            self.index_job(
                                job_id,
                                JobLocation::Dlq {
                                    shard_idx,
                                    queue_name,
                                },
                            );
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                };

                if found {
                    // Persist (lock dropped)
                    if let Some(ref storage) = self.storage {
                        if let Err(e) = storage.discard_job(job_id) {
                            warn!(job_id, error = %e, "Failed to persist job discard to storage");
                        }
                    }
                    Ok(())
                } else {
                    Err(format!("Job {} not found in queue", job_id))
                }
            }

            _ => Err(format!(
                "Job {} not found or already in DLQ/completed",
                job_id
            )),
        }
    }
}
