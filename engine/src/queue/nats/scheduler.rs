//! Delayed job scheduler for NATS backend.
//!
//! Promotes delayed jobs to priority queues when their run_at time arrives.
//! Uses leader election to ensure only one instance runs the scheduler.

use async_nats::jetstream::consumer::pull::Config as ConsumerConfig;
use async_nats::jetstream::consumer::AckPolicy;
use async_nats::jetstream::Context as JetStreamContext;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use super::config::NatsConfig;
use super::connection::NatsError;
use super::kv::KvStores;
use super::leader::LeaderElection;
use super::push::{deserialize_job_ref, promote_job};
use crate::queue::types::now_ms;

/// Delayed job scheduler.
pub struct DelayedScheduler {
    jetstream: JetStreamContext,
    config: NatsConfig,
    kv: Arc<KvStores>,
    leader: Arc<LeaderElection>,
    known_queues: RwLock<HashSet<String>>,
    shutdown: tokio::sync::watch::Receiver<bool>,
}

impl DelayedScheduler {
    /// Create a new delayed scheduler.
    pub fn new(
        jetstream: JetStreamContext,
        config: NatsConfig,
        kv: Arc<KvStores>,
        leader: Arc<LeaderElection>,
        shutdown: tokio::sync::watch::Receiver<bool>,
    ) -> Self {
        Self {
            jetstream,
            config,
            kv,
            leader,
            known_queues: RwLock::new(HashSet::new()),
            shutdown,
        }
    }

    /// Register a queue for delayed job processing.
    pub async fn register_queue(&self, queue: &str) {
        self.known_queues.write().await.insert(queue.to_string());
    }

    /// Start the scheduler background task.
    pub async fn run(&self) {
        let interval = Duration::from_millis(100); // Check every 100ms

        loop {
            // Check for shutdown
            if *self.shutdown.borrow() {
                info!("Delayed scheduler shutting down");
                break;
            }

            // Only process if we're the leader
            if !self.leader.is_leader().await {
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }

            // Process delayed jobs for all known queues
            let queues: Vec<String> = self.known_queues.read().await.iter().cloned().collect();

            for queue in queues {
                if let Err(e) = self.process_delayed_queue(&queue).await {
                    error!(queue = %queue, error = %e, "Failed to process delayed queue");
                }
            }

            tokio::time::sleep(interval).await;
        }
    }

    /// Process delayed jobs for a single queue.
    async fn process_delayed_queue(&self, queue: &str) -> Result<(), NatsError> {
        let stream_name = format!("{}__{}_delayed", self.config.prefix, sanitize_name(queue));

        // Get or create consumer for delayed stream
        let stream = match self.jetstream.get_stream(&stream_name).await {
            Ok(s) => s,
            Err(_) => return Ok(()), // Stream doesn't exist yet
        };

        let consumer_name = format!("{}_delayed_scheduler", sanitize_name(queue));
        let consumer = match stream.get_consumer(&consumer_name).await {
            Ok(c) => c,
            Err(_) => {
                // Create consumer
                let config = ConsumerConfig {
                    name: Some(consumer_name.clone()),
                    durable_name: Some(consumer_name.clone()),
                    ack_policy: AckPolicy::Explicit,
                    ack_wait: Duration::from_secs(30),
                    ..Default::default()
                };
                stream.create_consumer(config).await.map_err(|e| {
                    NatsError::JetStreamError(format!("Failed to create delayed consumer: {}", e))
                })?
            }
        };

        // Fetch messages with short timeout
        let now = now_ms();
        let mut promoted_count = 0u32;

        // Use fetch() with batch mode
        let messages = match consumer
            .fetch()
            .max_messages(100)
            .expires(Duration::from_millis(50))
            .messages()
            .await
        {
            Ok(m) => m,
            Err(_) => return Ok(()),
        };

        // Process messages
        let mut msgs: Vec<_> = vec![];
        tokio::pin!(messages);

        // Collect available messages with timeout
        while let Ok(Some(Ok(msg))) = tokio::time::timeout(
            Duration::from_millis(10),
            futures::StreamExt::next(&mut messages),
        )
        .await
        {
            msgs.push(msg);
        }

        for msg in msgs {
            match deserialize_job_ref(&msg.payload) {
                Ok(job) => {
                    if job.run_at <= now {
                        // Job is ready - promote to priority queue
                        if let Err(e) = promote_job(&self.jetstream, &self.config, &job).await {
                            warn!(job_id = job.id, error = %e, "Failed to promote job");
                            // NAK so it can be retried
                            let _ = msg
                                .ack_with(async_nats::jetstream::AckKind::Nak(None))
                                .await;
                            continue;
                        }

                        // ACK the delayed message
                        if let Err(e) = msg.ack().await {
                            warn!(job_id = job.id, error = %e, "Failed to ack delayed message");
                        }

                        promoted_count += 1;
                        debug!(job_id = job.id, queue = %queue, "Promoted delayed job");
                    } else {
                        // Job not ready yet - NAK with delay
                        let delay_ms = job.run_at.saturating_sub(now);
                        let delay = Duration::from_millis(delay_ms.min(5000)); // Max 5s delay
                        let _ = msg
                            .ack_with(async_nats::jetstream::AckKind::Nak(Some(delay)))
                            .await;
                    }
                }
                Err(e) => {
                    error!(error = %e, "Failed to deserialize delayed job");
                    // Terminate bad messages
                    let _ = msg.ack_with(async_nats::jetstream::AckKind::Term).await;
                }
            }
        }

        if promoted_count > 0 {
            debug!(queue = %queue, count = promoted_count, "Promoted delayed jobs");
        }

        Ok(())
    }
}

/// Cron job scheduler.
pub struct CronScheduler {
    jetstream: JetStreamContext,
    config: NatsConfig,
    kv: Arc<KvStores>,
    leader: Arc<LeaderElection>,
    shutdown: tokio::sync::watch::Receiver<bool>,
}

impl CronScheduler {
    /// Create a new cron scheduler.
    pub fn new(
        jetstream: JetStreamContext,
        config: NatsConfig,
        kv: Arc<KvStores>,
        leader: Arc<LeaderElection>,
        shutdown: tokio::sync::watch::Receiver<bool>,
    ) -> Self {
        Self {
            jetstream,
            config,
            kv,
            leader,
            shutdown,
        }
    }

    /// Start the cron scheduler background task.
    pub async fn run(&self) {
        let interval = Duration::from_secs(1); // Check every second

        loop {
            // Check for shutdown
            if *self.shutdown.borrow() {
                info!("Cron scheduler shutting down");
                break;
            }

            // Only process if we're the leader
            if !self.leader.is_leader().await {
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }

            // Process cron jobs
            if let Err(e) = self.process_crons().await {
                error!(error = %e, "Failed to process cron jobs");
            }

            tokio::time::sleep(interval).await;
        }
    }

    /// Process all cron jobs.
    async fn process_crons(&self) -> Result<(), NatsError> {
        let crons = self.kv.list_crons().await?;
        let now = now_ms();

        for cron in crons {
            if cron.next_run <= now {
                // Check execution limit
                if let Some(limit) = cron.limit {
                    if cron.executions >= limit {
                        debug!(cron_name = %cron.name, "Cron job reached execution limit");
                        continue;
                    }
                }

                // Create job from cron
                let job = crate::protocol::Job {
                    id: generate_job_id(),
                    queue: cron.queue.clone(),
                    data: Arc::new(cron.data.clone()),
                    priority: cron.priority,
                    created_at: now,
                    run_at: now,
                    started_at: 0,
                    attempts: 0,
                    max_attempts: 3,
                    backoff: 1000,
                    ttl: 0,
                    timeout: 30000,
                    unique_key: None,
                    depends_on: vec![],
                    progress: 0,
                    progress_msg: None,
                    tags: vec!["cron".to_string(), cron.name.clone()],
                    lifo: false,
                    remove_on_complete: true,
                    remove_on_fail: false,
                    last_heartbeat: 0,
                    stall_timeout: 0,
                    stall_count: 0,
                    parent_id: None,
                    children_ids: vec![],
                    children_completed: 0,
                    custom_id: None,
                    keep_completed_age: 0,
                    keep_completed_count: 0,
                    completed_at: 0,
                    group_id: None,
                };

                // Push to queue
                if let Err(e) =
                    super::push::push_job(&self.jetstream, &self.config, &self.kv, &job).await
                {
                    error!(cron_name = %cron.name, error = %e, "Failed to push cron job");
                    continue;
                }

                // Update cron next_run
                let mut updated_cron = cron.clone();
                updated_cron.executions += 1;
                updated_cron.next_run = calculate_next_run(&cron);

                if let Err(e) = self.kv.put_cron(&updated_cron).await {
                    error!(cron_name = %cron.name, error = %e, "Failed to update cron");
                }

                info!(
                    cron_name = %cron.name,
                    job_id = job.id,
                    next_run = updated_cron.next_run,
                    "Executed cron job"
                );
            }
        }

        Ok(())
    }
}

/// Calculate next run time for a cron job.
fn calculate_next_run(cron: &crate::protocol::CronJob) -> u64 {
    let now = now_ms();

    // If repeat_every is set, use simple interval
    if let Some(interval) = cron.repeat_every {
        return now + interval;
    }

    // Otherwise parse cron schedule
    if let Some(ref schedule) = cron.schedule {
        // Parse the cron expression
        if let Ok(cron_schedule) = schedule.parse::<croner::Cron>() {
            let now_dt = chrono::Utc::now();
            // Find next occurrence (skip current if exact match)
            if let Ok(next) = cron_schedule.find_next_occurrence(&now_dt, false) {
                return next.timestamp_millis() as u64;
            }
        }
    }

    // Fallback: 1 minute from now
    now + 60_000
}

/// Generate a unique job ID using UUID v7.
fn generate_job_id() -> u64 {
    use uuid::Uuid;
    let uuid = Uuid::now_v7();
    // Use first 8 bytes for u64 ID (time-sortable)
    u64::from_be_bytes(uuid.as_bytes()[0..8].try_into().unwrap())
}

/// Sanitize queue name for use in NATS names.
fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn test_job_id_generation() {
        // Generate IDs with 1ms spacing to ensure uniqueness
        // (UUID v7 first 8 bytes have millisecond precision)
        let mut ids = HashSet::new();
        for _ in 0..10 {
            let id = generate_job_id();
            assert!(ids.insert(id), "Duplicate ID generated: {}", id);
            // Sleep 1ms to ensure different timestamp in UUID v7
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        assert_eq!(ids.len(), 10);
    }

    #[test]
    fn test_job_id_time_sortable() {
        // Sleep between generations to ensure time progression for sortability
        let id1 = generate_job_id();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let id2 = generate_job_id();
        // IDs should be time-sortable (id2 > id1) when generated with delay
        assert!(id2 > id1, "Expected id2 ({}) > id1 ({})", id2, id1);
    }
}
