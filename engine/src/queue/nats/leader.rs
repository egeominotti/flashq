//! Leader election using NATS KV store.
//!
//! Ensures only one instance runs singleton tasks (cron, delayed scheduler).
//! Uses atomic compare-and-swap on KV store for distributed locking.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use super::config::NatsConfig;
use super::connection::NatsError;

/// Leader election timeout (how long a leader claim is valid).
const LEADER_TTL_MS: u64 = 10_000; // 10 seconds

/// Heartbeat interval (how often to refresh leadership).
const HEARTBEAT_INTERVAL_MS: u64 = 3_000; // 3 seconds

/// Leader election state.
pub struct LeaderElection {
    node_id: String,
    kv_store: async_nats::jetstream::kv::Store,
    is_leader: AtomicBool,
    leader_key: String,
    shutdown: RwLock<bool>,
}

impl LeaderElection {
    /// Create a new leader election instance.
    pub async fn new(
        jetstream: &async_nats::jetstream::Context,
        config: &NatsConfig,
        node_id: String,
    ) -> Result<Arc<Self>, NatsError> {
        // Get or create the leader KV store
        let bucket_name = config.kv_bucket("leader");

        let kv_store = match jetstream.get_key_value(&bucket_name).await {
            Ok(store) => store,
            Err(_) => {
                let kv_config = async_nats::jetstream::kv::Config {
                    bucket: bucket_name.clone(),
                    history: 1,
                    max_age: Duration::from_millis(LEADER_TTL_MS * 2), // Auto-expire old entries
                    num_replicas: config.kv_replicas as usize,
                    ..Default::default()
                };

                jetstream
                    .create_key_value(kv_config)
                    .await
                    .map_err(|e| NatsError::KvError(format!("Failed to create leader KV: {}", e)))?
            }
        };

        let leader = Arc::new(Self {
            node_id,
            kv_store,
            is_leader: AtomicBool::new(false),
            leader_key: format!("{}_leader", config.prefix),
            shutdown: RwLock::new(false),
        });

        Ok(leader)
    }

    /// Start the leader election background task.
    pub fn start(self: Arc<Self>) -> tokio::task::JoinHandle<()> {
        let leader = self.clone();
        tokio::spawn(async move {
            leader.run().await;
        })
    }

    /// Run the leader election loop.
    async fn run(&self) {
        let heartbeat_interval = Duration::from_millis(HEARTBEAT_INTERVAL_MS);

        loop {
            // Check for shutdown
            if *self.shutdown.read().await {
                // Release leadership before shutdown
                if self.is_leader.load(Ordering::Relaxed) {
                    self.release_leadership().await;
                }
                info!(node_id = %self.node_id, "Leader election shutting down");
                break;
            }

            // Try to acquire or maintain leadership
            match self.try_acquire_leadership().await {
                Ok(true) => {
                    if !self.is_leader.load(Ordering::Relaxed) {
                        self.is_leader.store(true, Ordering::Relaxed);
                        info!(node_id = %self.node_id, "Became leader");
                    }
                }
                Ok(false) => {
                    if self.is_leader.load(Ordering::Relaxed) {
                        self.is_leader.store(false, Ordering::Relaxed);
                        warn!(node_id = %self.node_id, "Lost leadership");
                    }
                }
                Err(e) => {
                    warn!(node_id = %self.node_id, error = %e, "Leader election error");
                    self.is_leader.store(false, Ordering::Relaxed);
                }
            }

            tokio::time::sleep(heartbeat_interval).await;
        }
    }

    /// Try to acquire or refresh leadership.
    async fn try_acquire_leadership(&self) -> Result<bool, NatsError> {
        let now_ms = crate::queue::types::now_ms();
        let claim = LeaderClaim {
            node_id: self.node_id.clone(),
            timestamp: now_ms,
            expires_at: now_ms + LEADER_TTL_MS,
        };

        let claim_bytes =
            serde_json::to_vec(&claim).map_err(|e| NatsError::SerializationError(e.to_string()))?;

        // Try to get current leader using entry() for revision tracking
        match self.kv_store.entry(&self.leader_key).await {
            Ok(Some(entry)) => {
                // Parse current claim
                let current_claim: LeaderClaim = serde_json::from_slice(&entry.value)
                    .map_err(|e| NatsError::SerializationError(e.to_string()))?;

                // Check if current leader has expired
                if current_claim.expires_at < now_ms {
                    // Leader expired, try to take over
                    debug!(
                        old_leader = %current_claim.node_id,
                        "Previous leader expired, attempting takeover"
                    );
                    return self.update_claim(entry.revision, claim_bytes).await;
                }

                // Check if we're the current leader
                if current_claim.node_id == self.node_id {
                    // Refresh our claim
                    return self.update_claim(entry.revision, claim_bytes).await;
                }

                // Someone else is leader and not expired
                debug!(leader = %current_claim.node_id, "Another node is leader");
                Ok(false)
            }
            Ok(None) => {
                // No leader yet, try to create claim
                match self
                    .kv_store
                    .create(&self.leader_key, claim_bytes.into())
                    .await
                {
                    Ok(_) => {
                        info!(node_id = %self.node_id, "Created initial leader claim");
                        Ok(true)
                    }
                    Err(_) => {
                        // Race condition - someone else got there first
                        debug!("Lost race for initial leader claim");
                        Ok(false)
                    }
                }
            }
            Err(e) => Err(NatsError::KvError(format!("Failed to get leader: {}", e))),
        }
    }

    /// Update the leader claim with revision check.
    async fn update_claim(&self, revision: u64, claim_bytes: Vec<u8>) -> Result<bool, NatsError> {
        match self
            .kv_store
            .update(&self.leader_key, claim_bytes.into(), revision)
            .await
        {
            Ok(_) => Ok(true),
            Err(e) => {
                // Revision mismatch - someone else updated
                debug!(error = %e, "Failed to update leader claim (revision mismatch)");
                Ok(false)
            }
        }
    }

    /// Release leadership voluntarily.
    async fn release_leadership(&self) {
        if let Err(e) = self.kv_store.purge(&self.leader_key).await {
            warn!(error = %e, "Failed to release leadership");
        } else {
            info!(node_id = %self.node_id, "Released leadership");
        }
        self.is_leader.store(false, Ordering::Relaxed);
    }

    /// Check if this node is currently the leader.
    #[inline]
    pub async fn is_leader(&self) -> bool {
        self.is_leader.load(Ordering::Relaxed)
    }

    /// Get the current leader node ID.
    pub async fn get_leader(&self) -> Result<Option<String>, NatsError> {
        match self.kv_store.entry(&self.leader_key).await {
            Ok(Some(entry)) => {
                let claim: LeaderClaim = serde_json::from_slice(&entry.value)
                    .map_err(|e| NatsError::SerializationError(e.to_string()))?;

                // Check if expired
                let now = crate::queue::types::now_ms();
                if claim.expires_at > now {
                    Ok(Some(claim.node_id))
                } else {
                    Ok(None)
                }
            }
            Ok(None) => Ok(None),
            Err(e) => Err(NatsError::KvError(e.to_string())),
        }
    }

    /// Signal shutdown.
    pub async fn shutdown(&self) {
        *self.shutdown.write().await = true;
    }

    /// Get node ID.
    #[inline]
    pub fn node_id(&self) -> &str {
        &self.node_id
    }
}

/// Leader claim stored in KV.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct LeaderClaim {
    node_id: String,
    timestamp: u64,
    expires_at: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_leader_claim_serialization() {
        let claim = LeaderClaim {
            node_id: "node-1".to_string(),
            timestamp: 1000,
            expires_at: 11000,
        };

        let bytes = serde_json::to_vec(&claim).unwrap();
        let parsed: LeaderClaim = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(parsed.node_id, claim.node_id);
        assert_eq!(parsed.timestamp, claim.timestamp);
        assert_eq!(parsed.expires_at, claim.expires_at);
    }
}
