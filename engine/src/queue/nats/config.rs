//! NATS JetStream configuration.
//!
//! Environment-based configuration for NATS connection and stream settings.

use std::time::Duration;

/// NATS JetStream configuration.
#[derive(Debug, Clone)]
pub struct NatsConfig {
    /// NATS server URL (e.g., "nats://localhost:4222")
    pub url: String,
    /// Number of stream replicas for durability (1 = no replication, 3 = HA)
    pub stream_replicas: u8,
    /// Number of KV store replicas
    pub kv_replicas: u8,
    /// Connection timeout
    pub connect_timeout: Duration,
    /// Request timeout for NATS operations
    pub request_timeout: Duration,
    /// Reconnect buffer size
    pub reconnect_buffer_size: usize,
    /// Max reconnect attempts (0 = infinite)
    pub max_reconnect_attempts: usize,
    /// Prefix for all NATS subjects/streams
    pub prefix: String,
    /// Node ID for this instance (auto-generated if not set)
    pub node_id: Option<String>,
    /// Enable TLS
    pub tls: bool,
    /// TLS certificate path (optional)
    pub tls_cert: Option<String>,
    /// TLS key path (optional)
    pub tls_key: Option<String>,
    /// Username for authentication (optional)
    pub username: Option<String>,
    /// Password for authentication (optional)
    pub password: Option<String>,
    /// NATS credentials file path (optional)
    pub credentials_file: Option<String>,
}

impl Default for NatsConfig {
    fn default() -> Self {
        Self {
            url: "nats://localhost:4222".to_string(),
            stream_replicas: 1,
            kv_replicas: 1,
            connect_timeout: Duration::from_secs(10),
            request_timeout: Duration::from_secs(5),
            reconnect_buffer_size: 8 * 1024 * 1024, // 8MB
            max_reconnect_attempts: 0,              // Infinite
            prefix: "flashq".to_string(),
            node_id: None,
            tls: false,
            tls_cert: None,
            tls_key: None,
            username: None,
            password: None,
            credentials_file: None,
        }
    }
}

impl NatsConfig {
    /// Create configuration from environment variables.
    ///
    /// Environment variables:
    /// - `NATS_URL`: Server URL (default: nats://localhost:4222)
    /// - `NATS_STREAM_REPLICAS`: Stream replicas (default: 1)
    /// - `NATS_KV_REPLICAS`: KV store replicas (default: 1)
    /// - `NATS_PREFIX`: Subject prefix (default: flashq)
    /// - `NODE_ID`: Node identifier (auto-generated if not set)
    /// - `NATS_TLS`: Enable TLS (default: false)
    /// - `NATS_TLS_CERT`: TLS certificate path
    /// - `NATS_TLS_KEY`: TLS key path
    /// - `NATS_USERNAME`: Authentication username
    /// - `NATS_PASSWORD`: Authentication password
    /// - `NATS_CREDENTIALS`: Path to credentials file
    pub fn from_env() -> Self {
        let mut config = Self::default();

        if let Ok(url) = std::env::var("NATS_URL") {
            config.url = url;
        }

        if let Ok(replicas) = std::env::var("NATS_STREAM_REPLICAS") {
            if let Ok(n) = replicas.parse() {
                config.stream_replicas = n;
            }
        }

        if let Ok(replicas) = std::env::var("NATS_KV_REPLICAS") {
            if let Ok(n) = replicas.parse() {
                config.kv_replicas = n;
            }
        }

        if let Ok(prefix) = std::env::var("NATS_PREFIX") {
            config.prefix = prefix;
        }

        if let Ok(node_id) = std::env::var("NODE_ID") {
            config.node_id = Some(node_id);
        }

        config.tls = std::env::var("NATS_TLS")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(false);

        if let Ok(cert) = std::env::var("NATS_TLS_CERT") {
            config.tls_cert = Some(cert);
        }

        if let Ok(key) = std::env::var("NATS_TLS_KEY") {
            config.tls_key = Some(key);
        }

        if let Ok(username) = std::env::var("NATS_USERNAME") {
            config.username = Some(username);
        }

        if let Ok(password) = std::env::var("NATS_PASSWORD") {
            config.password = Some(password);
        }

        if let Ok(creds) = std::env::var("NATS_CREDENTIALS") {
            config.credentials_file = Some(creds);
        }

        config
    }

    /// Generate a node ID if not provided.
    pub fn node_id(&self) -> String {
        self.node_id.clone().unwrap_or_else(|| {
            use uuid::Uuid;
            format!(
                "node-{}",
                Uuid::now_v7()
                    .to_string()
                    .split('-')
                    .next()
                    .unwrap_or("unknown")
            )
        })
    }

    /// Get the full subject name with prefix.
    #[inline]
    pub fn subject(&self, name: &str) -> String {
        format!("{}.{}", self.prefix, name)
    }

    /// Get KV bucket name with prefix.
    #[inline]
    pub fn kv_bucket(&self, name: &str) -> String {
        format!("{}-{}", self.prefix, name)
    }

    /// Get stream name for a queue with priority bucket.
    pub fn priority_stream(&self, queue: &str, priority: PriorityBucket) -> String {
        format!("{}.{}.priority.{}", self.prefix, queue, priority.as_str())
    }

    /// Get delayed stream name for a queue.
    pub fn delayed_stream(&self, queue: &str) -> String {
        format!("{}.{}.delayed", self.prefix, queue)
    }

    /// Get DLQ stream name for a queue.
    pub fn dlq_stream(&self, queue: &str) -> String {
        format!("{}.{}.dlq", self.prefix, queue)
    }
}

/// Priority bucket for stream routing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PriorityBucket {
    High,   // priority >= 5
    Normal, // priority 0-4
    Low,    // priority < 0
}

impl PriorityBucket {
    /// Determine priority bucket from numeric priority.
    #[inline]
    pub fn from_priority(priority: i32) -> Self {
        if priority >= 5 {
            Self::High
        } else if priority >= 0 {
            Self::Normal
        } else {
            Self::Low
        }
    }

    /// Get bucket name as string.
    #[inline]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Normal => "normal",
            Self::Low => "low",
        }
    }

    /// Get all priority buckets in pull order (high → normal → low).
    pub fn all() -> [Self; 3] {
        [Self::High, Self::Normal, Self::Low]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority_bucket_from_priority() {
        assert_eq!(PriorityBucket::from_priority(10), PriorityBucket::High);
        assert_eq!(PriorityBucket::from_priority(5), PriorityBucket::High);
        assert_eq!(PriorityBucket::from_priority(4), PriorityBucket::Normal);
        assert_eq!(PriorityBucket::from_priority(0), PriorityBucket::Normal);
        assert_eq!(PriorityBucket::from_priority(-1), PriorityBucket::Low);
        assert_eq!(PriorityBucket::from_priority(-100), PriorityBucket::Low);
    }

    #[test]
    fn test_config_subject_names() {
        let config = NatsConfig::default();
        assert_eq!(config.subject("jobs"), "flashq.jobs");
        assert_eq!(config.kv_bucket("jobs"), "flashq-jobs");
        assert_eq!(
            config.priority_stream("email", PriorityBucket::High),
            "flashq.email.priority.high"
        );
        assert_eq!(config.delayed_stream("email"), "flashq.email.delayed");
        assert_eq!(config.dlq_stream("email"), "flashq.email.dlq");
    }
}
