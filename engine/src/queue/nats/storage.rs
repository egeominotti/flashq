//! NATS storage implementation.
//!
//! Main entry point for NATS JetStream persistence backend.

use async_nats::jetstream::Context as JetStreamContext;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use super::config::NatsConfig;
use super::connection::{create_connection, NatsConnectionHandle, NatsError};
use super::kv::{KvManager, KvStores};
use super::leader::LeaderElection;
use super::pull::PullManager;
use super::scheduler::{CronScheduler, DelayedScheduler};
use super::streams::StreamManager;
use crate::protocol::{CronJob, Job, WebhookConfig};

/// NATS storage layer for flashQ persistence.
pub struct NatsStorage {
    connection: NatsConnectionHandle,
    jetstream: RwLock<Option<JetStreamContext>>,
    kv: RwLock<Option<Arc<KvStores>>>,
    stream_manager: RwLock<Option<Arc<StreamManager>>>,
    pull_manager: RwLock<Option<Arc<PullManager>>>,
    leader: RwLock<Option<Arc<LeaderElection>>>,
    config: NatsConfig,
    shutdown_tx: tokio::sync::watch::Sender<bool>,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
}

impl NatsStorage {
    /// Create a new NATS storage instance.
    pub fn new(config: NatsConfig) -> Self {
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        let connection = create_connection(config.clone());

        Self {
            connection,
            jetstream: RwLock::new(None),
            kv: RwLock::new(None),
            stream_manager: RwLock::new(None),
            pull_manager: RwLock::new(None),
            leader: RwLock::new(None),
            config,
            shutdown_tx,
            shutdown_rx,
        }
    }

    /// Create with configuration from environment.
    pub fn from_env() -> Self {
        Self::new(NatsConfig::from_env())
    }

    /// Connect to NATS and initialize all components.
    pub async fn connect(&self) -> Result<(), NatsError> {
        // Connect to NATS
        self.connection.connect().await?;

        let jetstream = self.connection.jetstream().await?;

        // Initialize KV stores
        let kv_manager = KvManager::new(jetstream.clone(), self.config.clone());
        let kv = Arc::new(kv_manager.init_stores().await?);

        // Initialize stream manager
        let stream_manager = Arc::new(StreamManager::new(jetstream.clone(), self.config.clone()));

        // Initialize pull manager
        let pull_manager = Arc::new(PullManager::new(
            jetstream.clone(),
            self.config.clone(),
            self.connection.node_id().to_string(),
        ));

        // Initialize leader election
        let leader = LeaderElection::new(
            &jetstream,
            &self.config,
            self.connection.node_id().to_string(),
        )
        .await?;

        // Store components
        *self.jetstream.write().await = Some(jetstream);
        *self.kv.write().await = Some(kv);
        *self.stream_manager.write().await = Some(stream_manager);
        *self.pull_manager.write().await = Some(pull_manager);
        *self.leader.write().await = Some(leader.clone());

        // Start leader election background task
        leader.start();

        info!(
            node_id = %self.connection.node_id(),
            "NATS storage initialized"
        );

        Ok(())
    }

    /// Start background schedulers.
    pub async fn start_schedulers(&self) -> Result<(), NatsError> {
        let jetstream = self.jetstream().await?;
        let kv = self.kv().await?;
        let leader = self.leader().await?;

        // Start delayed job scheduler
        let delayed_scheduler = Arc::new(DelayedScheduler::new(
            jetstream.clone(),
            self.config.clone(),
            kv.clone(),
            leader.clone(),
            self.shutdown_rx.clone(),
        ));

        let ds = delayed_scheduler.clone();
        tokio::spawn(async move {
            ds.run().await;
        });

        // Start cron scheduler
        let cron_scheduler = Arc::new(CronScheduler::new(
            jetstream,
            self.config.clone(),
            kv,
            leader,
            self.shutdown_rx.clone(),
        ));

        let cs = cron_scheduler.clone();
        tokio::spawn(async move {
            cs.run().await;
        });

        info!("NATS schedulers started");
        Ok(())
    }

    /// Get JetStream context.
    pub async fn jetstream(&self) -> Result<JetStreamContext, NatsError> {
        self.jetstream
            .read()
            .await
            .clone()
            .ok_or(NatsError::NotConnected)
    }

    /// Get KV stores.
    pub async fn kv(&self) -> Result<Arc<KvStores>, NatsError> {
        self.kv.read().await.clone().ok_or(NatsError::NotConnected)
    }

    /// Get stream manager.
    pub async fn stream_manager(&self) -> Result<Arc<StreamManager>, NatsError> {
        self.stream_manager
            .read()
            .await
            .clone()
            .ok_or(NatsError::NotConnected)
    }

    /// Get pull manager.
    pub async fn pull_manager(&self) -> Result<Arc<PullManager>, NatsError> {
        self.pull_manager
            .read()
            .await
            .clone()
            .ok_or(NatsError::NotConnected)
    }

    /// Get leader election.
    pub async fn leader(&self) -> Result<Arc<LeaderElection>, NatsError> {
        self.leader
            .read()
            .await
            .clone()
            .ok_or(NatsError::NotConnected)
    }

    /// Check if connected.
    pub async fn is_connected(&self) -> bool {
        self.connection.is_connected().await
    }

    /// Check if this node is the leader.
    pub async fn is_leader(&self) -> bool {
        if let Ok(leader) = self.leader().await {
            leader.is_leader().await
        } else {
            false
        }
    }

    /// Get node ID.
    pub fn node_id(&self) -> &str {
        self.connection.node_id()
    }

    // ============== Job Operations ==============

    /// Insert a job.
    pub async fn insert_job(&self, job: &Job, _state: &str) -> Result<(), NatsError> {
        let jetstream = self.jetstream().await?;
        let kv = self.kv().await?;

        // Ensure queue streams exist
        let stream_mgr = self.stream_manager().await?;
        stream_mgr.init_queue_streams(&job.queue).await?;

        // Push job
        super::push::push_job(&jetstream, &self.config, &kv, job).await?;
        Ok(())
    }

    /// Insert multiple jobs in a batch.
    pub async fn insert_jobs_batch(&self, jobs: &[Job], _state: &str) -> Result<(), NatsError> {
        if jobs.is_empty() {
            return Ok(());
        }

        let jetstream = self.jetstream().await?;
        let kv = self.kv().await?;

        // Ensure queue streams exist for all unique queues
        let stream_mgr = self.stream_manager().await?;
        let mut seen_queues = std::collections::HashSet::new();
        for job in jobs {
            if seen_queues.insert(job.queue.clone()) {
                stream_mgr.init_queue_streams(&job.queue).await?;
            }
        }

        // Push all jobs
        super::push::push_jobs_batch(&jetstream, &self.config, &kv, jobs).await?;
        Ok(())
    }

    /// Acknowledge a job.
    pub async fn ack_job(&self, job_id: u64, result: Option<Value>) -> Result<(), NatsError> {
        let kv = self.kv().await?;

        // Get job to mark as completed
        if let Some(mut job) = kv.get_job(job_id).await? {
            job.completed_at = crate::queue::types::now_ms();
            kv.put_job(&job).await?;

            // Store result if provided
            if let Some(ref res) = result {
                kv.put_result(job_id, res).await?;
            }

            // Delete custom ID mapping if present
            if let Some(ref custom_id) = job.custom_id {
                kv.delete_custom_id(custom_id).await.ok();
            }
        }

        Ok(())
    }

    /// Acknowledge multiple jobs in a batch.
    pub async fn ack_jobs_batch(&self, ids: &[u64]) -> Result<(), NatsError> {
        for id in ids {
            self.ack_job(*id, None).await?;
        }
        Ok(())
    }

    /// Delete a job.
    pub async fn delete_job(&self, job_id: u64) -> Result<(), NatsError> {
        let kv = self.kv().await?;
        kv.delete_job(job_id).await
    }

    /// Delete multiple jobs.
    pub async fn delete_jobs_batch(&self, ids: &[u64]) -> Result<(), NatsError> {
        let kv = self.kv().await?;
        for id in ids {
            kv.delete_job(*id).await?;
        }
        Ok(())
    }

    /// Fail a job (for retry).
    pub async fn fail_job(
        &self,
        job_id: u64,
        new_run_at: u64,
        attempts: u32,
    ) -> Result<(), NatsError> {
        let kv = self.kv().await?;

        if let Some(mut job) = kv.get_job(job_id).await? {
            job.run_at = new_run_at;
            job.attempts = attempts;
            job.started_at = 0;
            kv.put_job(&job).await?;
        }

        Ok(())
    }

    /// Move a job to DLQ.
    pub async fn move_to_dlq(&self, job: &Job, error: Option<&str>) -> Result<(), NatsError> {
        let jetstream = self.jetstream().await?;
        let kv = self.kv().await?;
        super::push::push_to_dlq(&jetstream, &self.config, &kv, job, error).await?;
        Ok(())
    }

    /// Cancel a job.
    pub async fn cancel_job(&self, job_id: u64) -> Result<(), NatsError> {
        let kv = self.kv().await?;
        kv.delete_job(job_id).await
    }

    /// Discard a job (move to DLQ and mark for recovery).
    pub async fn discard_job(&self, job_id: u64) -> Result<(), NatsError> {
        let jetstream = self.jetstream().await?;
        let kv = self.kv().await?;

        // Get job from KV
        if let Some(job) = kv.get_job(job_id).await? {
            // Push to DLQ (this marks attempts = max_attempts for recovery)
            super::push::push_to_dlq(&jetstream, &self.config, &kv, &job, Some("discarded"))
                .await?;
        }
        Ok(())
    }

    // ============== Recovery Operations ==============

    /// Load pending jobs from NATS KV store (for recovery on restart).
    /// Returns jobs with their state based on job properties.
    pub async fn load_pending_jobs(&self) -> Result<Vec<(Job, String)>, NatsError> {
        let kv = self.kv().await?;
        let jobs = kv.list_pending_jobs().await?;
        let now = crate::queue::types::now_ms();

        let result: Vec<(Job, String)> = jobs
            .into_iter()
            .filter_map(|job| {
                // Determine state from job properties
                let state = if job.max_attempts > 0 && job.attempts >= job.max_attempts {
                    // DLQ job - skip here, handled by load_dlq_jobs
                    return None;
                } else if job.started_at > 0 && job.completed_at == 0 {
                    // Was being processed when server shutdown
                    "waiting" // Put back in queue for retry
                } else if job.run_at > now {
                    "delayed"
                } else if !job.depends_on.is_empty() {
                    "waiting_deps"
                } else {
                    "waiting"
                };
                Some((job, state.to_string()))
            })
            .collect();

        info!(count = result.len(), "Recovered pending jobs from NATS KV");
        Ok(result)
    }

    /// Load DLQ jobs (for recovery).
    /// DLQ jobs are identified by attempts >= max_attempts in KV.
    pub async fn load_dlq_jobs(&self) -> Result<Vec<Job>, NatsError> {
        let kv = self.kv().await?;
        let all_jobs = kv.list_pending_jobs().await?;

        // Filter for DLQ jobs: max_attempts > 0 && attempts >= max_attempts
        let dlq_jobs: Vec<Job> = all_jobs
            .into_iter()
            .filter(|job| job.max_attempts > 0 && job.attempts >= job.max_attempts)
            .collect();

        if !dlq_jobs.is_empty() {
            info!(count = dlq_jobs.len(), "Recovered DLQ jobs from NATS KV");
        }

        Ok(dlq_jobs)
    }

    /// Get the maximum job ID from KV store.
    pub async fn get_max_job_id(&self) -> Result<u64, NatsError> {
        // With UUID v7 / ULID, we don't strictly need this
        // But we can scan KV to find the highest ID for compatibility
        let kv = self.kv().await?;
        let jobs = kv.list_pending_jobs().await?;
        let max_id = jobs.iter().map(|j| j.id).max().unwrap_or(0);
        Ok(max_id)
    }

    // ============== Cron Operations ==============

    /// Save a cron job.
    pub async fn save_cron(&self, cron: &CronJob) -> Result<(), NatsError> {
        let kv = self.kv().await?;
        kv.put_cron(cron).await
    }

    /// Delete a cron job.
    pub async fn delete_cron(&self, name: &str) -> Result<bool, NatsError> {
        let kv = self.kv().await?;
        kv.delete_cron(name).await?;
        Ok(true)
    }

    /// Load all cron jobs.
    pub async fn load_crons(&self) -> Result<Vec<CronJob>, NatsError> {
        let kv = self.kv().await?;
        kv.list_crons().await
    }

    /// Update cron next_run time.
    pub async fn update_cron_next_run(&self, name: &str, next_run: u64) -> Result<(), NatsError> {
        let kv = self.kv().await?;
        if let Some(mut cron) = kv.get_cron(name).await? {
            cron.next_run = next_run;
            kv.put_cron(&cron).await?;
        }
        Ok(())
    }

    // ============== Webhook Operations ==============

    /// Save a webhook.
    pub async fn save_webhook(&self, webhook: &WebhookConfig) -> Result<(), NatsError> {
        let kv = self.kv().await?;
        kv.put_webhook(webhook).await
    }

    /// Delete a webhook.
    pub async fn delete_webhook(&self, id: &str) -> Result<bool, NatsError> {
        let kv = self.kv().await?;
        kv.delete_webhook(id).await?;
        Ok(true)
    }

    /// Load all webhooks.
    pub async fn load_webhooks(&self) -> Result<Vec<WebhookConfig>, NatsError> {
        let kv = self.kv().await?;
        kv.list_webhooks().await
    }

    // ============== Queue Operations ==============

    /// Drain a queue.
    pub async fn drain_queue(&self, queue: &str) -> Result<u64, NatsError> {
        let stream_mgr = self.stream_manager().await?;
        stream_mgr.drain_queue(queue).await
    }

    /// Obliterate a queue (delete all streams).
    pub async fn obliterate_queue(&self, queue: &str) -> Result<u64, NatsError> {
        let stream_mgr = self.stream_manager().await?;
        let info = stream_mgr.get_stream_info(queue).await?;
        let total = info.total_pending() + info.dlq;
        stream_mgr.delete_queue_streams(queue).await?;
        Ok(total)
    }

    // ============== Pull Operations (Cluster Mode) ==============

    /// Pull a job from a queue using NATS streams.
    /// Returns the job with its NATS ack token for later acknowledgment.
    pub async fn pull_job(
        &self,
        queue: &str,
        timeout_ms: u64,
    ) -> Result<Option<super::pull::PulledJob>, NatsError> {
        let pull_manager = self.pull_manager().await?;
        let stream_mgr = self.stream_manager().await?;

        // Ensure queue streams exist
        stream_mgr.init_queue_streams(queue).await?;

        pull_manager.pull(queue, timeout_ms).await
    }

    /// Pull multiple jobs from a queue using NATS streams.
    pub async fn pull_jobs_batch(
        &self,
        queue: &str,
        count: usize,
        timeout_ms: u64,
    ) -> Result<Vec<super::pull::PulledJob>, NatsError> {
        let pull_manager = self.pull_manager().await?;
        let stream_mgr = self.stream_manager().await?;

        // Ensure queue streams exist
        stream_mgr.init_queue_streams(queue).await?;

        pull_manager.pull_batch(queue, count, timeout_ms).await
    }

    // ============== Shutdown ==============

    /// Shutdown the storage layer.
    pub async fn shutdown(&self) {
        // Signal shutdown to background tasks
        let _ = self.shutdown_tx.send(true);

        // Release leadership
        if let Ok(leader) = self.leader().await {
            leader.shutdown().await;
        }

        // Disconnect from NATS
        self.connection.disconnect().await;

        info!("NATS storage shutdown complete");
    }
}

impl Drop for NatsStorage {
    fn drop(&mut self) {
        // Attempt to signal shutdown
        let _ = self.shutdown_tx.send(true);
    }
}
