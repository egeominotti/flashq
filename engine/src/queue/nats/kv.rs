//! NATS KV store wrapper for job metadata and state.
//!
//! Provides typed access to KV stores with serialization/deserialization.

use async_nats::jetstream::kv::{Config as KvConfig, Store};
use async_nats::jetstream::Context as JetStreamContext;
use futures::StreamExt;
use serde::{de::DeserializeOwned, Serialize};
use std::time::Duration;
use tracing::{debug, info};

use super::config::NatsConfig;
use super::connection::NatsError;
use crate::protocol::{CronJob, Job, WebhookConfig};

/// KV store names.
pub const KV_JOBS: &str = "jobs";
pub const KV_RESULTS: &str = "results";
pub const KV_STATE: &str = "state";
pub const KV_CUSTOM_IDS: &str = "custom-ids";
pub const KV_PROGRESS: &str = "progress";
pub const KV_CRONS: &str = "crons";
pub const KV_WEBHOOKS: &str = "webhooks";

/// KV store manager.
pub struct KvManager {
    jetstream: JetStreamContext,
    config: NatsConfig,
}

impl KvManager {
    /// Create a new KV manager.
    pub fn new(jetstream: JetStreamContext, config: NatsConfig) -> Self {
        Self { jetstream, config }
    }

    /// Initialize all KV stores.
    pub async fn init_stores(&self) -> Result<KvStores, NatsError> {
        let jobs = self.get_or_create_store(KV_JOBS, None).await?;
        let results = self
            .get_or_create_store(KV_RESULTS, Some(Duration::from_secs(24 * 3600)))
            .await?; // 24h TTL
        let state = self.get_or_create_store(KV_STATE, None).await?;
        let custom_ids = self
            .get_or_create_store(KV_CUSTOM_IDS, Some(Duration::from_secs(7 * 24 * 3600)))
            .await?; // 7d TTL
        let progress = self
            .get_or_create_store(KV_PROGRESS, Some(Duration::from_secs(3600)))
            .await?; // 1h TTL
        let crons = self.get_or_create_store(KV_CRONS, None).await?;
        let webhooks = self.get_or_create_store(KV_WEBHOOKS, None).await?;

        info!("Initialized all NATS KV stores");

        Ok(KvStores {
            jobs,
            results,
            state,
            custom_ids,
            progress,
            crons,
            webhooks,
        })
    }

    /// Get or create a KV store.
    async fn get_or_create_store(
        &self,
        name: &str,
        ttl: Option<Duration>,
    ) -> Result<Store, NatsError> {
        let bucket_name = self.config.kv_bucket(name);

        // Try to get existing store
        match self.jetstream.get_key_value(&bucket_name).await {
            Ok(store) => {
                debug!(bucket = %bucket_name, "Using existing KV store");
                Ok(store)
            }
            Err(_) => {
                // Create new store
                let config = KvConfig {
                    bucket: bucket_name.clone(),
                    history: 1,               // Only keep latest value
                    max_value_size: 10 << 20, // 10MB max value
                    num_replicas: self.config.kv_replicas as usize,
                    max_age: ttl.unwrap_or(Duration::ZERO), // 0 = no expiration
                    ..Default::default()
                };

                let store = self.jetstream.create_key_value(config).await.map_err(|e| {
                    NatsError::KvError(format!("Failed to create KV store {}: {}", bucket_name, e))
                })?;

                info!(bucket = %bucket_name, "Created new KV store");
                Ok(store)
            }
        }
    }
}

/// Collection of all KV stores.
pub struct KvStores {
    pub jobs: Store,
    pub results: Store,
    pub state: Store,
    pub custom_ids: Store,
    pub progress: Store,
    pub crons: Store,
    pub webhooks: Store,
}

impl KvStores {
    // ============== Job Operations ==============

    /// Store a job.
    pub async fn put_job(&self, job: &Job) -> Result<(), NatsError> {
        let key = job_key(job.id);
        let value = serialize(job)?;
        self.jobs
            .put(&key, value.into())
            .await
            .map_err(|e| NatsError::KvError(format!("Failed to put job {}: {}", job.id, e)))?;
        Ok(())
    }

    /// Get a job by ID.
    pub async fn get_job(&self, job_id: u64) -> Result<Option<Job>, NatsError> {
        let key = job_key(job_id);
        match self.jobs.get(&key).await {
            Ok(Some(value)) => {
                let job: Job = deserialize(&value)?;
                Ok(Some(job))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(NatsError::KvError(format!(
                "Failed to get job {}: {}",
                job_id, e
            ))),
        }
    }

    /// Delete a job.
    pub async fn delete_job(&self, job_id: u64) -> Result<(), NatsError> {
        let key = job_key(job_id);
        self.jobs
            .purge(&key)
            .await
            .map_err(|e| NatsError::KvError(format!("Failed to delete job {}: {}", job_id, e)))?;
        Ok(())
    }

    /// List all jobs from KV store (for recovery).
    /// Returns jobs that are not completed (completed_at == 0).
    pub async fn list_pending_jobs(&self) -> Result<Vec<Job>, NatsError> {
        let mut jobs = Vec::new();
        let mut keys = self
            .jobs
            .keys()
            .await
            .map_err(|e| NatsError::KvError(format!("Failed to list job keys: {}", e)))?;

        while let Some(key_result) = keys.next().await {
            if let Ok(key) = key_result {
                // Parse job ID from hex key
                if let Ok(job_id) = u64::from_str_radix(&key, 16) {
                    if let Ok(Some(job)) = self.get_job(job_id).await {
                        // Only return jobs that are not completed
                        if job.completed_at == 0 {
                            jobs.push(job);
                        }
                    }
                }
            }
        }

        info!(count = jobs.len(), "Loaded pending jobs from NATS KV");
        Ok(jobs)
    }

    // ============== Result Operations ==============

    /// Store a job result.
    pub async fn put_result(
        &self,
        job_id: u64,
        result: &serde_json::Value,
    ) -> Result<(), NatsError> {
        let key = job_key(job_id);
        let value = serialize(result)?;
        self.results
            .put(&key, value.into())
            .await
            .map_err(|e| NatsError::KvError(format!("Failed to put result {}: {}", job_id, e)))?;
        Ok(())
    }

    /// Get a job result.
    pub async fn get_result(&self, job_id: u64) -> Result<Option<serde_json::Value>, NatsError> {
        let key = job_key(job_id);
        match self.results.get(&key).await {
            Ok(Some(value)) => {
                let result: serde_json::Value = deserialize(&value)?;
                Ok(Some(result))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(NatsError::KvError(format!(
                "Failed to get result {}: {}",
                job_id, e
            ))),
        }
    }

    // ============== Custom ID Operations ==============

    /// Map a custom ID to a job ID.
    pub async fn put_custom_id(&self, custom_id: &str, job_id: u64) -> Result<(), NatsError> {
        let value = job_id.to_string();
        self.custom_ids
            .put(custom_id, value.into())
            .await
            .map_err(|e| {
                NatsError::KvError(format!("Failed to put custom ID {}: {}", custom_id, e))
            })?;
        Ok(())
    }

    /// Get job ID by custom ID.
    pub async fn get_job_by_custom_id(&self, custom_id: &str) -> Result<Option<u64>, NatsError> {
        match self.custom_ids.get(custom_id).await {
            Ok(Some(value)) => {
                let job_id: u64 = String::from_utf8_lossy(&value)
                    .parse()
                    .map_err(|e| NatsError::KvError(format!("Invalid job ID: {}", e)))?;
                Ok(Some(job_id))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(NatsError::KvError(format!(
                "Failed to get custom ID {}: {}",
                custom_id, e
            ))),
        }
    }

    /// Delete a custom ID mapping.
    pub async fn delete_custom_id(&self, custom_id: &str) -> Result<(), NatsError> {
        self.custom_ids.purge(custom_id).await.map_err(|e| {
            NatsError::KvError(format!("Failed to delete custom ID {}: {}", custom_id, e))
        })?;
        Ok(())
    }

    // ============== Progress Operations ==============

    /// Store job progress.
    pub async fn put_progress(
        &self,
        job_id: u64,
        progress: u8,
        message: Option<&str>,
    ) -> Result<(), NatsError> {
        let key = job_key(job_id);
        let data = ProgressData {
            progress,
            message: message.map(String::from),
        };
        let value = serialize(&data)?;
        self.progress
            .put(&key, value.into())
            .await
            .map_err(|e| NatsError::KvError(format!("Failed to put progress {}: {}", job_id, e)))?;
        Ok(())
    }

    /// Get job progress.
    pub async fn get_progress(
        &self,
        job_id: u64,
    ) -> Result<Option<(u8, Option<String>)>, NatsError> {
        let key = job_key(job_id);
        match self.progress.get(&key).await {
            Ok(Some(value)) => {
                let data: ProgressData = deserialize(&value)?;
                Ok(Some((data.progress, data.message)))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(NatsError::KvError(format!(
                "Failed to get progress {}: {}",
                job_id, e
            ))),
        }
    }

    // ============== Queue State Operations ==============

    /// Store queue state (paused, rate limit, concurrency).
    pub async fn put_queue_state(&self, queue: &str, state: &QueueState) -> Result<(), NatsError> {
        let key = format!("queue:{}", queue);
        let value = serialize(state)?;
        self.state.put(&key, value.into()).await.map_err(|e| {
            NatsError::KvError(format!("Failed to put queue state {}: {}", queue, e))
        })?;
        Ok(())
    }

    /// Get queue state.
    pub async fn get_queue_state(&self, queue: &str) -> Result<Option<QueueState>, NatsError> {
        let key = format!("queue:{}", queue);
        match self.state.get(&key).await {
            Ok(Some(value)) => {
                let state: QueueState = deserialize(&value)?;
                Ok(Some(state))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(NatsError::KvError(format!(
                "Failed to get queue state {}: {}",
                queue, e
            ))),
        }
    }

    // ============== Cron Operations ==============

    /// Store a cron job.
    pub async fn put_cron(&self, cron: &CronJob) -> Result<(), NatsError> {
        let value = serialize(cron)?;
        self.crons
            .put(&cron.name, value.into())
            .await
            .map_err(|e| NatsError::KvError(format!("Failed to put cron {}: {}", cron.name, e)))?;
        Ok(())
    }

    /// Get a cron job.
    pub async fn get_cron(&self, name: &str) -> Result<Option<CronJob>, NatsError> {
        match self.crons.get(name).await {
            Ok(Some(value)) => {
                let cron: CronJob = deserialize(&value)?;
                Ok(Some(cron))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(NatsError::KvError(format!(
                "Failed to get cron {}: {}",
                name, e
            ))),
        }
    }

    /// Delete a cron job.
    pub async fn delete_cron(&self, name: &str) -> Result<(), NatsError> {
        self.crons
            .purge(name)
            .await
            .map_err(|e| NatsError::KvError(format!("Failed to delete cron {}: {}", name, e)))?;
        Ok(())
    }

    /// List all cron jobs.
    pub async fn list_crons(&self) -> Result<Vec<CronJob>, NatsError> {
        let mut crons = Vec::new();
        let mut keys = self
            .crons
            .keys()
            .await
            .map_err(|e| NatsError::KvError(e.to_string()))?;

        while let Some(key_result) = keys.next().await {
            if let Ok(name) = key_result {
                if let Ok(Some(cron)) = self.get_cron(&name).await {
                    crons.push(cron);
                }
            }
        }

        Ok(crons)
    }

    // ============== Webhook Operations ==============

    /// Store a webhook.
    pub async fn put_webhook(&self, webhook: &WebhookConfig) -> Result<(), NatsError> {
        let value = serialize(webhook)?;
        self.webhooks
            .put(&webhook.id, value.into())
            .await
            .map_err(|e| {
                NatsError::KvError(format!("Failed to put webhook {}: {}", webhook.id, e))
            })?;
        Ok(())
    }

    /// Get a webhook.
    pub async fn get_webhook(&self, id: &str) -> Result<Option<WebhookConfig>, NatsError> {
        match self.webhooks.get(id).await {
            Ok(Some(value)) => {
                let webhook: WebhookConfig = deserialize(&value)?;
                Ok(Some(webhook))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(NatsError::KvError(format!(
                "Failed to get webhook {}: {}",
                id, e
            ))),
        }
    }

    /// Delete a webhook.
    pub async fn delete_webhook(&self, id: &str) -> Result<(), NatsError> {
        self.webhooks
            .purge(id)
            .await
            .map_err(|e| NatsError::KvError(format!("Failed to delete webhook {}: {}", id, e)))?;
        Ok(())
    }

    /// List all webhooks.
    pub async fn list_webhooks(&self) -> Result<Vec<WebhookConfig>, NatsError> {
        let mut webhooks = Vec::new();
        let mut keys = self
            .webhooks
            .keys()
            .await
            .map_err(|e| NatsError::KvError(e.to_string()))?;

        while let Some(key_result) = keys.next().await {
            if let Ok(id) = key_result {
                if let Ok(Some(webhook)) = self.get_webhook(&id).await {
                    webhooks.push(webhook);
                }
            }
        }

        Ok(webhooks)
    }
}

/// Queue state stored in KV.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize)]
pub struct QueueState {
    pub paused: bool,
    pub rate_limit: Option<u32>,
    pub concurrency_limit: Option<u32>,
}

/// Progress data stored in KV.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
struct ProgressData {
    progress: u8,
    message: Option<String>,
}

/// Generate KV key for a job ID.
#[inline]
fn job_key(job_id: u64) -> String {
    format!("{:016x}", job_id)
}

/// Serialize value to bytes using MessagePack for efficiency.
fn serialize<T: Serialize>(value: &T) -> Result<Vec<u8>, NatsError> {
    rmp_serde::to_vec(value).map_err(|e| NatsError::SerializationError(e.to_string()))
}

/// Deserialize bytes to value.
fn deserialize<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, NatsError> {
    rmp_serde::from_slice(bytes).map_err(|e| NatsError::SerializationError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_job_key() {
        assert_eq!(job_key(1), "0000000000000001");
        assert_eq!(job_key(255), "00000000000000ff");
        assert_eq!(job_key(u64::MAX), "ffffffffffffffff");
    }
}
