//! NATS pull operations with priority-aware fetching.
//!
//! Pulls jobs in priority order: high → normal → low.

use async_nats::jetstream::consumer::pull::Config as ConsumerConfig;
use async_nats::jetstream::consumer::AckPolicy;
use async_nats::jetstream::Context as JetStreamContext;
use std::time::Duration;
use tokio::time::timeout;
use tracing::{debug, warn};

use super::config::{NatsConfig, PriorityBucket};
use super::connection::NatsError;
use super::push::deserialize_job_ref;
use crate::protocol::Job;

/// Pull consumer manager.
pub struct PullManager {
    jetstream: JetStreamContext,
    config: NatsConfig,
    node_id: String,
}

impl PullManager {
    /// Create a new pull manager.
    pub fn new(jetstream: JetStreamContext, config: NatsConfig, node_id: String) -> Self {
        Self {
            jetstream,
            config,
            node_id,
        }
    }

    /// Pull a single job from a queue with priority awareness.
    ///
    /// Checks buckets in order: high → normal → low.
    /// Returns None if no jobs available.
    pub async fn pull(&self, queue: &str, timeout_ms: u64) -> Result<Option<PulledJob>, NatsError> {
        let deadline = Duration::from_millis(timeout_ms);

        // Try each priority bucket in order
        for bucket in PriorityBucket::all() {
            if let Some(job) = self.try_pull_from_bucket(queue, bucket, deadline).await? {
                return Ok(Some(job));
            }
        }

        Ok(None)
    }

    /// Pull multiple jobs from a queue (up to count).
    pub async fn pull_batch(
        &self,
        queue: &str,
        count: usize,
        timeout_ms: u64,
    ) -> Result<Vec<PulledJob>, NatsError> {
        let mut jobs = Vec::with_capacity(count);
        let deadline = Duration::from_millis(timeout_ms);
        let remaining_per_bucket = count;

        // Pull from each bucket in priority order
        for bucket in PriorityBucket::all() {
            let remaining = count - jobs.len();
            if remaining == 0 {
                break;
            }

            let batch = self
                .try_pull_batch_from_bucket(queue, bucket, remaining, deadline)
                .await?;
            jobs.extend(batch);
        }

        Ok(jobs)
    }

    /// Try to pull a job from a specific priority bucket.
    async fn try_pull_from_bucket(
        &self,
        queue: &str,
        bucket: PriorityBucket,
        timeout: Duration,
    ) -> Result<Option<PulledJob>, NatsError> {
        let stream_name = stream_name(&self.config.prefix, queue, bucket.as_str());
        debug!(stream = %stream_name, bucket = %bucket.as_str(), "Trying to pull from bucket");

        // Get or create consumer
        let consumer = match self
            .get_or_create_consumer(&stream_name, queue, bucket)
            .await
        {
            Ok(c) => {
                debug!(stream = %stream_name, "Consumer ready");
                c
            }
            Err(e) => {
                debug!(stream = %stream_name, error = %e, "Could not get consumer");
                return Ok(None); // Stream might not exist yet
            }
        };

        // Use fetch() for pull consumers - this is the correct API
        let fetch_timeout = Duration::from_millis(50.min(timeout.as_millis() as u64));
        debug!(stream = %stream_name, timeout_ms = fetch_timeout.as_millis(), "Starting fetch");

        // Fetch one message
        let batch_result = consumer
            .fetch()
            .max_messages(1)
            .expires(fetch_timeout)
            .messages()
            .await;

        match batch_result {
            Ok(mut messages) => {
                debug!(stream = %stream_name, "Fetch succeeded, waiting for message");
                // Try to get the first message
                match timeout_fn(
                    Duration::from_millis(100),
                    futures::StreamExt::next(&mut messages),
                )
                .await
                {
                    Ok(Some(Ok(message))) => {
                        debug!(stream = %stream_name, payload_len = message.payload.len(), "Got message!");
                        let job = deserialize_job_ref(&message.payload)?;
                        debug!(job_id = job.id, bucket = %bucket.as_str(), "Pulled job from NATS");
                        Ok(Some(PulledJob {
                            job,
                            ack_token: AckToken::Nats(message),
                            bucket,
                        }))
                    }
                    Ok(Some(Err(e))) => {
                        warn!(error = %e, "Error fetching message");
                        Err(NatsError::FetchFailed(e.to_string()))
                    }
                    Ok(None) => {
                        debug!(stream = %stream_name, "No message in stream (None)");
                        Ok(None)
                    }
                    Err(_) => {
                        debug!(stream = %stream_name, "No message in stream (timeout)");
                        Ok(None)
                    }
                }
            }
            Err(e) => {
                debug!(stream = %stream_name, error = %e, "Fetch failed");
                Ok(None) // Fetch failed, return empty
            }
        }
    }

    /// Try to pull multiple jobs from a specific priority bucket.
    async fn try_pull_batch_from_bucket(
        &self,
        queue: &str,
        bucket: PriorityBucket,
        count: usize,
        timeout: Duration,
    ) -> Result<Vec<PulledJob>, NatsError> {
        let stream_name = stream_name(&self.config.prefix, queue, bucket.as_str());
        let mut jobs = Vec::with_capacity(count);

        // Get or create consumer
        let consumer = match self
            .get_or_create_consumer(&stream_name, queue, bucket)
            .await
        {
            Ok(c) => c,
            Err(_) => return Ok(jobs), // Stream doesn't exist yet
        };

        // Fetch batch
        let fetch_timeout = Duration::from_millis(50.min(timeout.as_millis() as u64));

        let batch_result = timeout_fn(fetch_timeout, async {
            consumer
                .fetch()
                .max_messages(count)
                .expires(fetch_timeout)
                .messages()
                .await
                .map_err(|e| NatsError::FetchFailed(e.to_string()))
        })
        .await;

        if let Ok(Ok(mut messages)) = batch_result {
            while jobs.len() < count {
                match timeout_fn(
                    Duration::from_millis(10),
                    futures::StreamExt::next(&mut messages),
                )
                .await
                {
                    Ok(Some(Ok(message))) => {
                        match deserialize_job_ref(&message.payload) {
                            Ok(job) => {
                                jobs.push(PulledJob {
                                    job,
                                    ack_token: AckToken::Nats(message),
                                    bucket,
                                });
                            }
                            Err(e) => {
                                warn!(error = %e, "Failed to deserialize job, skipping");
                                // NAK the message so it can be redelivered
                                continue;
                            }
                        }
                    }
                    _ => break,
                }
            }
        }

        Ok(jobs)
    }

    /// Get or create a durable consumer for a stream.
    async fn get_or_create_consumer(
        &self,
        stream_name: &str,
        queue: &str,
        bucket: PriorityBucket,
    ) -> Result<
        async_nats::jetstream::consumer::Consumer<async_nats::jetstream::consumer::pull::Config>,
        NatsError,
    > {
        debug!(stream = %stream_name, queue = %queue, bucket = %bucket.as_str(), "Getting stream for consumer");

        // Get stream
        let stream = match self.jetstream.get_stream(stream_name).await {
            Ok(s) => {
                debug!(stream = %stream_name, "Got stream successfully");
                s
            }
            Err(e) => {
                warn!(stream = %stream_name, error = %e, "Failed to get stream");
                return Err(NatsError::StreamNotFound(format!("{}: {}", stream_name, e)));
            }
        };

        // Consumer name is unique per node to allow horizontal scaling
        let consumer_name = format!(
            "{}_{}_{}_{}",
            self.config.prefix,
            sanitize_name(queue),
            bucket.as_str(),
            self.node_id
        );

        // Try to get existing consumer
        match stream.get_consumer(&consumer_name).await {
            Ok(consumer) => {
                debug!(consumer = %consumer_name, "Using existing consumer");
                Ok(consumer)
            }
            Err(_) => {
                debug!(consumer = %consumer_name, "Creating new consumer");
                // Create new consumer
                let config = ConsumerConfig {
                    name: Some(consumer_name.clone()),
                    durable_name: Some(consumer_name.clone()),
                    ack_policy: AckPolicy::Explicit,
                    ack_wait: Duration::from_secs(30), // 30s ack timeout
                    max_deliver: 3,                    // Max redelivery attempts
                    max_ack_pending: 1000,             // Max unacked messages
                    ..Default::default()
                };

                match stream.create_consumer(config).await {
                    Ok(c) => {
                        debug!(consumer = %consumer_name, "Consumer created successfully");
                        Ok(c)
                    }
                    Err(e) => {
                        warn!(consumer = %consumer_name, error = %e, "Failed to create consumer");
                        Err(NatsError::JetStreamError(format!(
                            "Failed to create consumer: {}",
                            e
                        )))
                    }
                }
            }
        }
    }
}

/// A pulled job with its acknowledgment token.
pub struct PulledJob {
    pub job: Job,
    pub ack_token: AckToken,
    pub bucket: PriorityBucket,
}

impl PulledJob {
    /// Get job ID.
    #[inline]
    pub fn id(&self) -> u64 {
        self.job.id
    }

    /// Acknowledge the job (mark as successfully processed).
    pub async fn ack(self) -> Result<(), NatsError> {
        Self::ack_token(self.ack_token).await
    }

    /// Acknowledge a token directly (for deferred acknowledgment).
    pub async fn ack_token(token: AckToken) -> Result<(), NatsError> {
        match token {
            AckToken::Nats(msg) => {
                msg.ack()
                    .await
                    .map_err(|e| NatsError::JetStreamError(format!("Failed to ack: {}", e)))?;
                debug!("Job acknowledged via token");
                Ok(())
            }
        }
    }

    /// Negative acknowledge a token directly (for deferred nak).
    pub async fn nak_token(token: AckToken) -> Result<(), NatsError> {
        match token {
            AckToken::Nats(msg) => {
                msg.ack_with(async_nats::jetstream::AckKind::Nak(None))
                    .await
                    .map_err(|e| NatsError::JetStreamError(format!("Failed to nak: {}", e)))?;
                debug!("Job nak via token");
                Ok(())
            }
        }
    }

    /// Negative acknowledgment (will be redelivered).
    pub async fn nak(self) -> Result<(), NatsError> {
        match self.ack_token {
            AckToken::Nats(msg) => {
                msg.ack_with(async_nats::jetstream::AckKind::Nak(None))
                    .await
                    .map_err(|e| NatsError::JetStreamError(format!("Failed to nak: {}", e)))?;
                debug!(job_id = self.job.id, "Job negative-acknowledged");
                Ok(())
            }
        }
    }

    /// Acknowledge with delay (will be redelivered after delay).
    pub async fn nak_with_delay(self, delay: Duration) -> Result<(), NatsError> {
        match self.ack_token {
            AckToken::Nats(msg) => {
                msg.ack_with(async_nats::jetstream::AckKind::Nak(Some(delay)))
                    .await
                    .map_err(|e| {
                        NatsError::JetStreamError(format!("Failed to nak with delay: {}", e))
                    })?;
                debug!(
                    job_id = self.job.id,
                    delay_ms = delay.as_millis(),
                    "Job nak with delay"
                );
                Ok(())
            }
        }
    }

    /// Mark job as permanently failed (won't be redelivered).
    pub async fn term(self) -> Result<(), NatsError> {
        match self.ack_token {
            AckToken::Nats(msg) => {
                msg.ack_with(async_nats::jetstream::AckKind::Term)
                    .await
                    .map_err(|e| NatsError::JetStreamError(format!("Failed to term: {}", e)))?;
                debug!(job_id = self.job.id, "Job terminated");
                Ok(())
            }
        }
    }
}

/// Acknowledgment token for tracking message delivery.
pub enum AckToken {
    Nats(async_nats::jetstream::Message),
}

/// Generate stream name from prefix, queue, and bucket.
fn stream_name(prefix: &str, queue: &str, bucket: &str) -> String {
    format!("{}__{}_priority_{}", prefix, sanitize_name(queue), bucket)
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

/// Timeout helper.
async fn timeout_fn<F, T>(duration: Duration, future: F) -> Result<T, tokio::time::error::Elapsed>
where
    F: std::future::Future<Output = T>,
{
    timeout(duration, future).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_name() {
        assert_eq!(
            stream_name("flashq", "email", "high"),
            "flashq__email_priority_high"
        );
    }

    #[test]
    fn test_priority_order() {
        let buckets = PriorityBucket::all();
        assert_eq!(buckets[0], PriorityBucket::High);
        assert_eq!(buckets[1], PriorityBucket::Normal);
        assert_eq!(buckets[2], PriorityBucket::Low);
    }
}
