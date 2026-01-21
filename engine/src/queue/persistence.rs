//! SQLite persistence operations.
//!
//! All persist_* methods for storing job state changes to SQLite.

use serde_json::Value;
use tracing::error;

use super::manager::QueueManager;
use crate::protocol::{CronJob, Job, WebhookConfig};

impl QueueManager {
    // ============== Persistence Methods (SQLite) ==============

    /// Persist a pushed job to SQLite (sync for durability).
    #[inline]
    pub(crate) fn persist_push(&self, job: &Job, state: &str) {
        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.insert_job(job, state) {
                error!(job_id = job.id, error = %e, "Failed to persist job");
            }
        }
    }

    /// Persist a pushed job synchronously (same as persist_push for SQLite).
    #[inline]
    pub(crate) async fn persist_push_sync(&self, job: &Job, state: &str) -> Result<(), String> {
        if let Some(ref storage) = self.storage {
            storage
                .insert_job(job, state)
                .map_err(|e| format!("Failed to persist job: {}", e))?;
        }
        Ok(())
    }

    /// Persist a batch of jobs to SQLite.
    #[inline]
    pub(crate) fn persist_push_batch(&self, jobs: &[Job], state: &str) {
        if jobs.is_empty() {
            return;
        }
        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.insert_jobs_batch(jobs, state) {
                error!(error = %e, "Failed to persist batch");
            }
        }
    }

    /// Persist job acknowledgment to SQLite.
    #[inline]
    pub(crate) fn persist_ack(&self, job_id: u64, result: Option<Value>) {
        // Store result in memory
        if let Some(ref res) = result {
            self.job_results.write().insert(job_id, res.clone());
        }

        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.ack_job(job_id, result) {
                error!(job_id = job_id, error = %e, "Failed to persist ack");
            }
        }
    }

    /// Persist job acknowledgment synchronously.
    #[inline]
    pub(crate) async fn persist_ack_sync(
        &self,
        job_id: u64,
        result: Option<Value>,
    ) -> Result<(), String> {
        if let Some(ref res) = result {
            self.job_results.write().insert(job_id, res.clone());
        }

        if let Some(ref storage) = self.storage {
            storage
                .ack_job(job_id, result)
                .map_err(|e| format!("Failed to persist ack: {}", e))?;
        }
        Ok(())
    }

    /// Persist batch acknowledgments to SQLite.
    #[inline]
    pub(crate) fn persist_ack_batch(&self, ids: &[u64]) {
        if ids.is_empty() {
            return;
        }
        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.ack_jobs_batch(ids) {
                error!(error = %e, "Failed to persist ack batch");
            }
        }
    }

    /// Persist job failure (retry) to SQLite.
    #[inline]
    pub(crate) fn persist_fail(&self, job_id: u64, new_run_at: u64, attempts: u32) {
        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.fail_job(job_id, new_run_at, attempts) {
                error!(job_id = job_id, error = %e, "Failed to persist fail");
            }
        }
    }

    /// Persist job failure synchronously.
    #[inline]
    pub(crate) async fn persist_fail_sync(
        &self,
        job_id: u64,
        new_run_at: u64,
        attempts: u32,
    ) -> Result<(), String> {
        if let Some(ref storage) = self.storage {
            storage
                .fail_job(job_id, new_run_at, attempts)
                .map_err(|e| format!("Failed to persist fail: {}", e))?;
        }
        Ok(())
    }

    /// Persist job moved to DLQ.
    #[inline]
    pub(crate) fn persist_dlq(&self, job: &Job, error: Option<&str>) {
        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.move_to_dlq(job, error) {
                error!(job_id = job.id, error = %e, "Failed to persist DLQ");
            }
        }
    }

    /// Persist job cancellation.
    #[inline]
    pub(crate) fn persist_cancel(&self, job_id: u64) {
        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.cancel_job(job_id) {
                error!(job_id = job_id, error = %e, "Failed to persist cancel");
            }
        }
    }

    /// Persist cron job.
    #[inline]
    pub(crate) fn persist_cron(&self, cron: &CronJob) {
        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.save_cron(cron) {
                error!(cron_name = %cron.name, error = %e, "Failed to persist cron");
            }
        }
    }

    /// Persist cron job deletion.
    #[inline]
    pub(crate) fn persist_cron_delete(&self, name: &str) {
        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.delete_cron(name) {
                error!(cron_name = %name, error = %e, "Failed to persist cron delete");
            }
        }
    }

    /// Persist cron next_run update.
    #[inline]
    pub(crate) fn persist_cron_next_run(&self, name: &str, next_run: u64) {
        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.update_cron_next_run(name, next_run) {
                error!(cron_name = %name, error = %e, "Failed to update cron next_run");
            }
        }
    }

    /// Persist webhook.
    #[allow(dead_code)]
    #[inline]
    pub(crate) fn persist_webhook(&self, webhook: &WebhookConfig) {
        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.save_webhook(webhook) {
                error!(webhook_id = %webhook.id, error = %e, "Failed to persist webhook");
            }
        }
    }

    /// Persist webhook deletion.
    #[allow(dead_code)]
    #[inline]
    pub(crate) fn persist_webhook_delete(&self, id: &str) {
        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.delete_webhook(id) {
                error!(webhook_id = %id, error = %e, "Failed to persist webhook delete");
            }
        }
    }

    /// Notify event subscribers.
    pub(crate) fn notify_subscribers(&self, event: &str, queue: &str, job: &Job) {
        let subs = self.subscribers.read();
        for sub in subs.iter() {
            if sub.queue.as_str() == queue && sub.events.contains(&event.to_string()) {
                let msg = serde_json::json!({
                    "event": event,
                    "queue": queue,
                    "job": job
                })
                .to_string();
                let _ = sub.tx.send(msg);
            }
        }
    }

    /// Notify shard's waiting workers.
    #[inline]
    pub(crate) fn notify_shard(&self, idx: usize) {
        self.shards[idx].read().notify.notify_waiters();
    }

    /// Notify all shards.
    #[inline]
    pub(crate) fn notify_all(&self) {
        for shard in &self.shards {
            shard.read().notify.notify_waiters();
        }
    }
}
