//! PostgreSQL storage types.

use tokio::sync::mpsc;

/// Channel name for cluster sync notifications.
pub const CLUSTER_SYNC_CHANNEL: &str = "flashq_cluster_sync";

/// Cluster sync event types.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ClusterSyncEvent {
    /// Job was pushed to a queue.
    JobPushed { job_id: u64, queue: String },
    /// Batch of jobs pushed.
    JobsPushed { job_ids: Vec<u64>, queue: String },
    /// Job state changed (ack, fail, etc.).
    JobStateChanged { job_id: u64, state: String },
}

/// Sender type for cluster sync events.
pub type ClusterSyncSender = mpsc::UnboundedSender<ClusterSyncEvent>;
