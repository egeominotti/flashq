//! NATS JetStream stream configuration and management.
//!
//! Creates and manages streams for job queues with priority buckets.

use async_nats::jetstream::stream::{Config, RetentionPolicy, StorageType, Stream};
use async_nats::jetstream::Context as JetStreamContext;
use std::time::Duration;
use tracing::{debug, info};

use super::config::{NatsConfig, PriorityBucket};
use super::connection::NatsError;

/// Stream manager for creating and configuring NATS streams.
pub struct StreamManager {
    jetstream: JetStreamContext,
    config: NatsConfig,
}

impl StreamManager {
    /// Create a new stream manager.
    pub fn new(jetstream: JetStreamContext, config: NatsConfig) -> Self {
        Self { jetstream, config }
    }

    /// Initialize all streams for a queue.
    ///
    /// Creates:
    /// - Priority streams (high, normal, low)
    /// - Delayed stream
    /// - DLQ stream
    pub async fn init_queue_streams(&self, queue: &str) -> Result<(), NatsError> {
        // Create priority streams
        for bucket in PriorityBucket::all() {
            self.create_priority_stream(queue, bucket).await?;
        }

        // Create delayed stream
        self.create_delayed_stream(queue).await?;

        // Create DLQ stream
        self.create_dlq_stream(queue).await?;

        info!(queue = %queue, "Initialized NATS streams");
        Ok(())
    }

    /// Create a priority stream for a queue.
    async fn create_priority_stream(
        &self,
        queue: &str,
        bucket: PriorityBucket,
    ) -> Result<Stream, NatsError> {
        let name = stream_name(&self.config.prefix, queue, bucket.as_str());
        let subject = format!(
            "{}.{}.priority.{}",
            self.config.prefix,
            queue,
            bucket.as_str()
        );

        let config = Config {
            name: name.clone(),
            subjects: vec![subject],
            retention: RetentionPolicy::WorkQueue, // Messages deleted after ACK
            storage: StorageType::File,
            num_replicas: self.config.stream_replicas as usize,
            max_messages: -1,                           // Unlimited
            max_bytes: -1,                              // Unlimited
            max_message_size: 10 << 20,                 // 10MB (match flashQ's job size limit)
            max_age: Duration::ZERO,                    // No expiration by time
            duplicate_window: Duration::from_secs(120), // 2 min dedup window
            allow_rollup: false,
            deny_delete: false,
            deny_purge: false,
            ..Default::default()
        };

        self.get_or_create_stream(config).await
    }

    /// Create a delayed jobs stream.
    async fn create_delayed_stream(&self, queue: &str) -> Result<Stream, NatsError> {
        let name = format!("{}__{}_delayed", self.config.prefix, sanitize_name(queue));
        let subject = format!("{}.{}.delayed", self.config.prefix, queue);

        let config = Config {
            name: name.clone(),
            subjects: vec![subject],
            retention: RetentionPolicy::Limits, // Keep until explicitly deleted
            storage: StorageType::File,
            num_replicas: self.config.stream_replicas as usize,
            max_messages: -1,
            max_bytes: -1,
            max_message_size: 10 << 20,
            max_age: Duration::ZERO,
            duplicate_window: Duration::from_secs(120),
            allow_rollup: false,
            deny_delete: false,
            deny_purge: false,
            ..Default::default()
        };

        self.get_or_create_stream(config).await
    }

    /// Create a DLQ stream.
    async fn create_dlq_stream(&self, queue: &str) -> Result<Stream, NatsError> {
        let name = format!("{}__{}_dlq", self.config.prefix, sanitize_name(queue));
        let subject = format!("{}.{}.dlq", self.config.prefix, queue);

        let config = Config {
            name: name.clone(),
            subjects: vec![subject],
            retention: RetentionPolicy::Limits, // Keep for manual inspection
            storage: StorageType::File,
            num_replicas: self.config.stream_replicas as usize,
            max_messages: 100_000, // Limit DLQ size
            max_bytes: -1,
            max_message_size: 10 << 20,
            max_age: Duration::from_secs(30 * 24 * 3600), // 30 days retention
            duplicate_window: Duration::from_secs(120),
            allow_rollup: false,
            deny_delete: false,
            deny_purge: false,
            ..Default::default()
        };

        self.get_or_create_stream(config).await
    }

    /// Get existing stream or create new one.
    async fn get_or_create_stream(&self, config: Config) -> Result<Stream, NatsError> {
        let name = config.name.clone();

        // Try to get existing stream
        match self.jetstream.get_stream(&name).await {
            Ok(stream) => {
                debug!(stream = %name, "Using existing stream");
                Ok(stream)
            }
            Err(_) => {
                // Create new stream
                let stream = self.jetstream.create_stream(config).await.map_err(|e| {
                    NatsError::JetStreamError(format!("Failed to create stream {}: {}", name, e))
                })?;
                info!(stream = %name, "Created new stream");
                Ok(stream)
            }
        }
    }

    /// Delete all streams for a queue (for obliterate operation).
    pub async fn delete_queue_streams(&self, queue: &str) -> Result<(), NatsError> {
        // Delete priority streams
        for bucket in PriorityBucket::all() {
            let name = stream_name(&self.config.prefix, queue, bucket.as_str());
            if let Err(e) = self.jetstream.delete_stream(&name).await {
                debug!(stream = %name, error = %e, "Failed to delete stream (may not exist)");
            }
        }

        // Delete delayed stream
        let delayed_name = format!("{}__{}_delayed", self.config.prefix, sanitize_name(queue));
        if let Err(e) = self.jetstream.delete_stream(&delayed_name).await {
            debug!(stream = %delayed_name, error = %e, "Failed to delete delayed stream");
        }

        // Delete DLQ stream
        let dlq_name = format!("{}__{}_dlq", self.config.prefix, sanitize_name(queue));
        if let Err(e) = self.jetstream.delete_stream(&dlq_name).await {
            debug!(stream = %dlq_name, error = %e, "Failed to delete DLQ stream");
        }

        info!(queue = %queue, "Deleted queue streams");
        Ok(())
    }

    /// Purge all messages from a queue's priority streams (for drain operation).
    pub async fn drain_queue(&self, queue: &str) -> Result<u64, NatsError> {
        let mut total = 0u64;

        for bucket in PriorityBucket::all() {
            let name = stream_name(&self.config.prefix, queue, bucket.as_str());
            if let Ok(mut stream) = self.jetstream.get_stream(&name).await {
                if let Ok(info) = stream.info().await {
                    total += info.state.messages;
                }
                stream.purge().await.ok();
            }
        }

        info!(queue = %queue, purged = %total, "Drained queue");
        Ok(total)
    }

    /// Get stream info for monitoring.
    pub async fn get_stream_info(&self, queue: &str) -> Result<StreamInfo, NatsError> {
        let mut info = StreamInfo::default();

        // Get counts from priority streams
        for bucket in PriorityBucket::all() {
            let name = stream_name(&self.config.prefix, queue, bucket.as_str());
            if let Ok(mut stream) = self.jetstream.get_stream(&name).await {
                if let Ok(stream_info) = stream.info().await {
                    match bucket {
                        PriorityBucket::High => info.high_priority = stream_info.state.messages,
                        PriorityBucket::Normal => info.normal_priority = stream_info.state.messages,
                        PriorityBucket::Low => info.low_priority = stream_info.state.messages,
                    }
                }
            }
        }

        // Get delayed count
        let delayed_name = format!("{}__{}_delayed", self.config.prefix, sanitize_name(queue));
        if let Ok(mut stream) = self.jetstream.get_stream(&delayed_name).await {
            if let Ok(stream_info) = stream.info().await {
                info.delayed = stream_info.state.messages;
            }
        }

        // Get DLQ count
        let dlq_name = format!("{}__{}_dlq", self.config.prefix, sanitize_name(queue));
        if let Ok(mut stream) = self.jetstream.get_stream(&dlq_name).await {
            if let Ok(stream_info) = stream.info().await {
                info.dlq = stream_info.state.messages;
            }
        }

        Ok(info)
    }
}

/// Stream statistics for a queue.
#[derive(Debug, Clone, Default)]
pub struct StreamInfo {
    pub high_priority: u64,
    pub normal_priority: u64,
    pub low_priority: u64,
    pub delayed: u64,
    pub dlq: u64,
}

impl StreamInfo {
    /// Total waiting jobs (all priority buckets).
    pub fn total_waiting(&self) -> u64 {
        self.high_priority + self.normal_priority + self.low_priority
    }

    /// Total pending jobs (waiting + delayed).
    pub fn total_pending(&self) -> u64 {
        self.total_waiting() + self.delayed
    }
}

/// Generate stream name from prefix, queue, and bucket.
fn stream_name(prefix: &str, queue: &str, bucket: &str) -> String {
    format!("{}__{}_priority_{}", prefix, sanitize_name(queue), bucket)
}

/// Sanitize queue name for use in NATS stream names.
/// NATS stream names can only contain: alphanumeric, dash, underscore
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

    #[test]
    fn test_stream_name() {
        assert_eq!(
            stream_name("flashq", "email", "high"),
            "flashq__email_priority_high"
        );
        assert_eq!(
            stream_name("flashq", "my.queue", "normal"),
            "flashq__my_queue_priority_normal"
        );
    }

    #[test]
    fn test_sanitize_name() {
        assert_eq!(sanitize_name("simple"), "simple");
        assert_eq!(sanitize_name("with.dot"), "with_dot");
        assert_eq!(sanitize_name("with-dash"), "with-dash");
        assert_eq!(sanitize_name("with_underscore"), "with_underscore");
        assert_eq!(sanitize_name("with spaces"), "with_spaces");
    }

    #[test]
    fn test_stream_info_totals() {
        let info = StreamInfo {
            high_priority: 10,
            normal_priority: 20,
            low_priority: 5,
            delayed: 15,
            dlq: 3,
        };
        assert_eq!(info.total_waiting(), 35);
        assert_eq!(info.total_pending(), 50);
    }
}
