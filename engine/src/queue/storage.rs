//! Storage abstraction layer for flashQ persistence.
//!
//! Uses NATS JetStream for distributed persistence.

use async_trait::async_trait;
use serde_json::Value;
use std::fmt;
use std::sync::Arc;
use tracing::error;

use crate::protocol::{CronJob, Job, WebhookConfig};

/// Storage error type.
#[derive(Debug)]
pub enum StorageError {
    /// NATS error
    Nats(String),
    /// Generic error
    #[allow(dead_code)]
    Other(String),
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StorageError::Nats(e) => write!(f, "NATS error: {}", e),
            StorageError::Other(e) => write!(f, "Storage error: {}", e),
        }
    }
}

impl std::error::Error for StorageError {}

impl From<super::nats::NatsError> for StorageError {
    fn from(e: super::nats::NatsError) -> Self {
        StorageError::Nats(e.to_string())
    }
}

/// Common storage interface.
#[async_trait]
pub trait Storage: Send + Sync {
    /// Get the storage backend name for logging.
    fn name(&self) -> &'static str;

    // ============== Connection ==============

    /// Connect to the storage backend.
    async fn connect(&self) -> Result<(), StorageError>;

    /// Check if connected.
    #[allow(dead_code)]
    async fn is_connected(&self) -> bool;

    /// Shutdown the storage backend.
    #[allow(dead_code)]
    async fn shutdown(&self);

    // ============== Job Operations ==============

    /// Insert a job.
    fn insert_job(&self, job: &Job, state: &str) -> Result<(), StorageError>;

    /// Insert multiple jobs in a batch.
    fn insert_jobs_batch(&self, jobs: &[Job], state: &str) -> Result<(), StorageError>;

    /// Acknowledge a job as completed.
    fn ack_job(&self, job_id: u64, result: Option<Value>) -> Result<(), StorageError>;

    /// Acknowledge multiple jobs in a batch.
    fn ack_jobs_batch(&self, ids: &[u64]) -> Result<(), StorageError>;

    /// Delete a job without storing result.
    fn delete_job(&self, job_id: u64) -> Result<(), StorageError>;

    /// Delete multiple jobs.
    fn delete_jobs_batch(&self, ids: &[u64]) -> Result<(), StorageError>;

    /// Mark job as failed and update for retry.
    fn fail_job(&self, job_id: u64, new_run_at: u64, attempts: u32) -> Result<(), StorageError>;

    /// Move job to DLQ.
    fn move_to_dlq(&self, job: &Job, error: Option<&str>) -> Result<(), StorageError>;

    /// Cancel a job.
    fn cancel_job(&self, job_id: u64) -> Result<(), StorageError>;

    /// Load all pending jobs for recovery (sync, returns empty for NATS).
    fn load_pending_jobs(&self) -> Result<Vec<(Job, String)>, StorageError>;

    /// Load all pending jobs for recovery (async).
    async fn load_pending_jobs_async(&self) -> Result<Vec<(Job, String)>, StorageError>;

    /// Load DLQ jobs (sync, returns empty for NATS).
    fn load_dlq_jobs(&self) -> Result<Vec<Job>, StorageError>;

    /// Load DLQ jobs (async).
    async fn load_dlq_jobs_async(&self) -> Result<Vec<Job>, StorageError>;

    /// Load cron jobs (async).
    async fn load_crons_async(&self) -> Result<Vec<CronJob>, StorageError>;

    /// Load webhooks (async).
    async fn load_webhooks_async(&self) -> Result<Vec<WebhookConfig>, StorageError>;

    /// Get the maximum job ID (sync, returns 0 for NATS).
    fn get_max_job_id(&self) -> Result<u64, StorageError>;

    /// Get the maximum job ID (async).
    async fn get_max_job_id_async(&self) -> Result<u64, StorageError>;

    // ============== Cron Operations ==============

    /// Save a cron job.
    fn save_cron(&self, cron: &CronJob) -> Result<(), StorageError>;

    /// Delete a cron job.
    fn delete_cron(&self, name: &str) -> Result<bool, StorageError>;

    /// Load all cron jobs (sync, returns empty for NATS).
    fn load_crons(&self) -> Result<Vec<CronJob>, StorageError>;

    /// Update cron next_run time.
    fn update_cron_next_run(&self, name: &str, next_run: u64) -> Result<(), StorageError>;

    // ============== Webhook Operations ==============

    /// Save a webhook.
    fn save_webhook(&self, webhook: &WebhookConfig) -> Result<(), StorageError>;

    /// Delete a webhook.
    fn delete_webhook(&self, id: &str) -> Result<bool, StorageError>;

    /// Load all webhooks (sync, returns empty for NATS).
    fn load_webhooks(&self) -> Result<Vec<WebhookConfig>, StorageError>;

    // ============== Queue Operations ==============

    /// Drain all waiting jobs from a queue.
    fn drain_queue(&self, queue: &str) -> Result<u64, StorageError>;

    /// Obliterate all data for a queue.
    fn obliterate_queue(&self, queue: &str) -> Result<u64, StorageError>;

    // ============== Advanced Job Operations ==============

    /// Change priority of a job.
    fn change_priority(&self, job_id: u64, priority: i32) -> Result<(), StorageError>;

    /// Move a job to delayed state.
    fn move_to_delayed(&self, job_id: u64, run_at: u64) -> Result<(), StorageError>;

    /// Promote a delayed job to waiting.
    fn promote_job(&self, job_id: u64, run_at: u64) -> Result<(), StorageError>;

    /// Update job data.
    fn update_job_data(&self, job_id: u64, data: &Value) -> Result<(), StorageError>;

    /// Clean jobs by age and state.
    fn clean_jobs(&self, queue: &str, cutoff: u64, state: &str) -> Result<u64, StorageError>;

    /// Discard a job (move to DLQ).
    fn discard_job(&self, job_id: u64) -> Result<(), StorageError>;

    /// Purge all DLQ entries for a queue.
    fn purge_dlq(&self, queue: &str) -> Result<u64, StorageError>;

    // ============== Pull Operations (Cluster Mode) ==============

    /// Pull a job from a queue using NATS streams (cluster mode).
    async fn pull_job_async(
        &self,
        queue: &str,
        timeout_ms: u64,
    ) -> Result<Option<super::nats::pull::PulledJob>, StorageError>;

    /// Pull multiple jobs from a queue using NATS streams (cluster mode).
    async fn pull_jobs_batch_async(
        &self,
        queue: &str,
        count: usize,
        timeout_ms: u64,
    ) -> Result<Vec<super::nats::pull::PulledJob>, StorageError>;

    /// Acknowledge a NATS pulled job.
    async fn ack_nats_job(
        &self,
        pulled_job: super::nats::pull::PulledJob,
    ) -> Result<(), StorageError>;

    /// Negative acknowledge a NATS pulled job (for retry).
    async fn nak_nats_job(
        &self,
        pulled_job: super::nats::pull::PulledJob,
    ) -> Result<(), StorageError>;
}

/// NATS JetStream storage backend.
pub struct StorageBackend(pub Arc<super::nats::NatsStorage>);

impl StorageBackend {
    /// Create NATS backend from storage instance.
    pub fn nats(storage: Arc<super::nats::NatsStorage>) -> Self {
        StorageBackend(storage)
    }

    /// Get NATS storage reference.
    #[allow(dead_code)]
    pub fn as_nats(&self) -> &Arc<super::nats::NatsStorage> {
        &self.0
    }
}

#[async_trait]
impl Storage for StorageBackend {
    fn name(&self) -> &'static str {
        "nats"
    }

    async fn connect(&self) -> Result<(), StorageError> {
        self.0.connect().await.map_err(StorageError::from)
    }

    async fn is_connected(&self) -> bool {
        self.0.is_connected().await
    }

    async fn shutdown(&self) {
        self.0.shutdown().await
    }

    fn insert_job(&self, job: &Job, state: &str) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        let job = job.clone();
        let state = state.to_string();
        tokio::spawn(async move {
            if let Err(e) = storage.insert_job(&job, &state).await {
                error!(job_id = job.id, error = %e, "NATS insert_job failed");
            }
        });
        Ok(())
    }

    fn insert_jobs_batch(&self, jobs: &[Job], state: &str) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        let jobs = jobs.to_vec();
        let state = state.to_string();
        tokio::spawn(async move {
            if let Err(e) = storage.insert_jobs_batch(&jobs, &state).await {
                error!(count = jobs.len(), error = %e, "NATS insert_jobs_batch failed");
            }
        });
        Ok(())
    }

    fn ack_job(&self, job_id: u64, result: Option<Value>) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        tokio::spawn(async move {
            if let Err(e) = storage.ack_job(job_id, result).await {
                error!(job_id = job_id, error = %e, "NATS ack_job failed");
            }
        });
        Ok(())
    }

    fn ack_jobs_batch(&self, ids: &[u64]) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        let ids = ids.to_vec();
        tokio::spawn(async move {
            if let Err(e) = storage.ack_jobs_batch(&ids).await {
                error!(count = ids.len(), error = %e, "NATS ack_jobs_batch failed");
            }
        });
        Ok(())
    }

    fn delete_job(&self, job_id: u64) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        tokio::spawn(async move {
            if let Err(e) = storage.delete_job(job_id).await {
                error!(job_id = job_id, error = %e, "NATS delete_job failed");
            }
        });
        Ok(())
    }

    fn delete_jobs_batch(&self, ids: &[u64]) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        let ids = ids.to_vec();
        tokio::spawn(async move {
            if let Err(e) = storage.delete_jobs_batch(&ids).await {
                error!(count = ids.len(), error = %e, "NATS delete_jobs_batch failed");
            }
        });
        Ok(())
    }

    fn fail_job(&self, job_id: u64, new_run_at: u64, attempts: u32) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        tokio::spawn(async move {
            if let Err(e) = storage.fail_job(job_id, new_run_at, attempts).await {
                error!(job_id = job_id, error = %e, "NATS fail_job failed");
            }
        });
        Ok(())
    }

    fn move_to_dlq(&self, job: &Job, error: Option<&str>) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        let job = job.clone();
        let error = error.map(|s| s.to_string());
        tokio::spawn(async move {
            if let Err(e) = storage.move_to_dlq(&job, error.as_deref()).await {
                error!(job_id = job.id, error = %e, "NATS move_to_dlq failed");
            }
        });
        Ok(())
    }

    fn cancel_job(&self, job_id: u64) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        tokio::spawn(async move {
            if let Err(e) = storage.cancel_job(job_id).await {
                error!(job_id = job_id, error = %e, "NATS cancel_job failed");
            }
        });
        Ok(())
    }

    fn load_pending_jobs(&self) -> Result<Vec<(Job, String)>, StorageError> {
        Ok(vec![]) // Use async version for NATS
    }

    async fn load_pending_jobs_async(&self) -> Result<Vec<(Job, String)>, StorageError> {
        self.0.load_pending_jobs().await.map_err(StorageError::from)
    }

    fn load_dlq_jobs(&self) -> Result<Vec<Job>, StorageError> {
        Ok(vec![]) // Use async version for NATS
    }

    async fn load_dlq_jobs_async(&self) -> Result<Vec<Job>, StorageError> {
        self.0.load_dlq_jobs().await.map_err(StorageError::from)
    }

    async fn load_crons_async(&self) -> Result<Vec<CronJob>, StorageError> {
        self.0.load_crons().await.map_err(StorageError::from)
    }

    async fn load_webhooks_async(&self) -> Result<Vec<WebhookConfig>, StorageError> {
        self.0.load_webhooks().await.map_err(StorageError::from)
    }

    fn get_max_job_id(&self) -> Result<u64, StorageError> {
        Ok(0) // Use async version for NATS
    }

    async fn get_max_job_id_async(&self) -> Result<u64, StorageError> {
        self.0.get_max_job_id().await.map_err(StorageError::from)
    }

    fn save_cron(&self, cron: &CronJob) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        let cron = cron.clone();
        tokio::spawn(async move {
            if let Err(e) = storage.save_cron(&cron).await {
                error!(cron_name = %cron.name, error = %e, "NATS save_cron failed");
            }
        });
        Ok(())
    }

    fn delete_cron(&self, name: &str) -> Result<bool, StorageError> {
        let storage = Arc::clone(&self.0);
        let name = name.to_string();
        tokio::spawn(async move {
            if let Err(e) = storage.delete_cron(&name).await {
                error!(cron_name = %name, error = %e, "NATS delete_cron failed");
            }
        });
        Ok(true)
    }

    fn load_crons(&self) -> Result<Vec<CronJob>, StorageError> {
        Ok(vec![]) // Use async version for NATS
    }

    fn update_cron_next_run(&self, name: &str, next_run: u64) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        let name = name.to_string();
        tokio::spawn(async move {
            if let Err(e) = storage.update_cron_next_run(&name, next_run).await {
                error!(cron_name = %name, error = %e, "NATS update_cron_next_run failed");
            }
        });
        Ok(())
    }

    fn save_webhook(&self, webhook: &WebhookConfig) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        let webhook = webhook.clone();
        tokio::spawn(async move {
            if let Err(e) = storage.save_webhook(&webhook).await {
                error!(webhook_id = %webhook.id, error = %e, "NATS save_webhook failed");
            }
        });
        Ok(())
    }

    fn delete_webhook(&self, id: &str) -> Result<bool, StorageError> {
        let storage = Arc::clone(&self.0);
        let id = id.to_string();
        tokio::spawn(async move {
            if let Err(e) = storage.delete_webhook(&id).await {
                error!(webhook_id = %id, error = %e, "NATS delete_webhook failed");
            }
        });
        Ok(true)
    }

    fn load_webhooks(&self) -> Result<Vec<WebhookConfig>, StorageError> {
        Ok(vec![]) // Use async version for NATS
    }

    fn drain_queue(&self, queue: &str) -> Result<u64, StorageError> {
        let storage = Arc::clone(&self.0);
        let queue = queue.to_string();
        tokio::spawn(async move {
            if let Err(e) = storage.drain_queue(&queue).await {
                error!(queue = %queue, error = %e, "NATS drain_queue failed");
            }
        });
        Ok(0)
    }

    fn obliterate_queue(&self, queue: &str) -> Result<u64, StorageError> {
        let storage = Arc::clone(&self.0);
        let queue = queue.to_string();
        tokio::spawn(async move {
            if let Err(e) = storage.obliterate_queue(&queue).await {
                error!(queue = %queue, error = %e, "NATS obliterate_queue failed");
            }
        });
        Ok(0)
    }

    fn change_priority(&self, _job_id: u64, _priority: i32) -> Result<(), StorageError> {
        // Priority changes are handled in-memory
        Ok(())
    }

    fn move_to_delayed(&self, job_id: u64, run_at: u64) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        tokio::spawn(async move {
            if let Err(e) = storage.fail_job(job_id, run_at, 0).await {
                error!(job_id = job_id, error = %e, "NATS move_to_delayed failed");
            }
        });
        Ok(())
    }

    fn promote_job(&self, job_id: u64, run_at: u64) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        tokio::spawn(async move {
            if let Err(e) = storage.fail_job(job_id, run_at, 0).await {
                error!(job_id = job_id, error = %e, "NATS promote_job failed");
            }
        });
        Ok(())
    }

    fn update_job_data(&self, _job_id: u64, _data: &Value) -> Result<(), StorageError> {
        // Job data updates are handled in-memory
        Ok(())
    }

    fn clean_jobs(&self, _queue: &str, _cutoff: u64, _state: &str) -> Result<u64, StorageError> {
        // NATS streams have built-in retention policies
        Ok(0)
    }

    fn discard_job(&self, job_id: u64) -> Result<(), StorageError> {
        let storage = Arc::clone(&self.0);
        tokio::spawn(async move {
            if let Err(e) = storage.discard_job(job_id).await {
                error!(job_id = job_id, error = %e, "NATS discard_job failed");
            }
        });
        Ok(())
    }

    fn purge_dlq(&self, queue: &str) -> Result<u64, StorageError> {
        let storage = Arc::clone(&self.0);
        let queue = queue.to_string();
        tokio::spawn(async move {
            if let Err(e) = storage.drain_queue(&queue).await {
                error!(queue = %queue, error = %e, "NATS purge_dlq failed");
            }
        });
        Ok(0)
    }

    async fn pull_job_async(
        &self,
        queue: &str,
        timeout_ms: u64,
    ) -> Result<Option<super::nats::pull::PulledJob>, StorageError> {
        self.0
            .pull_job(queue, timeout_ms)
            .await
            .map_err(StorageError::from)
    }

    async fn pull_jobs_batch_async(
        &self,
        queue: &str,
        count: usize,
        timeout_ms: u64,
    ) -> Result<Vec<super::nats::pull::PulledJob>, StorageError> {
        self.0
            .pull_jobs_batch(queue, count, timeout_ms)
            .await
            .map_err(StorageError::from)
    }

    async fn ack_nats_job(
        &self,
        pulled_job: super::nats::pull::PulledJob,
    ) -> Result<(), StorageError> {
        pulled_job.ack().await.map_err(StorageError::from)
    }

    async fn nak_nats_job(
        &self,
        pulled_job: super::nats::pull::PulledJob,
    ) -> Result<(), StorageError> {
        pulled_job.nak().await.map_err(StorageError::from)
    }
}

/// Create NATS storage backend from environment configuration.
#[allow(dead_code)]
pub fn create_storage_from_env() -> Result<StorageBackend, StorageError> {
    use super::nats::{NatsConfig, NatsStorage};
    let config = NatsConfig::from_env();
    Ok(StorageBackend::nats(Arc::new(NatsStorage::new(config))))
}
