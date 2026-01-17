//! Cluster sync operations using PostgreSQL LISTEN/NOTIFY.

use sqlx::PgPool;
use tracing::warn;

use super::types::CLUSTER_SYNC_CHANNEL;

/// Send a notification to other nodes about a new job.
pub async fn notify_job_pushed(pool: &PgPool, job_id: u64, queue: &str, node_id: &str) {
    let payload = format!("{}:{}:{}", node_id, job_id, queue);
    if let Err(e) = sqlx::query("SELECT pg_notify($1, $2)")
        .bind(CLUSTER_SYNC_CHANNEL)
        .bind(&payload)
        .execute(pool)
        .await
    {
        warn!(error = %e, "Failed to send cluster sync notification");
    }
}

/// Send a notification about multiple jobs pushed.
pub async fn notify_jobs_pushed(pool: &PgPool, job_ids: &[u64], queue: &str, node_id: &str) {
    if job_ids.is_empty() {
        return;
    }
    // For batch, we just notify with the first and last ID + count
    // Other nodes will sync the range
    let payload = format!(
        "{}:batch:{}:{}:{}",
        node_id,
        queue,
        job_ids.first().unwrap_or(&0),
        job_ids.len()
    );
    if let Err(e) = sqlx::query("SELECT pg_notify($1, $2)")
        .bind(CLUSTER_SYNC_CHANNEL)
        .bind(&payload)
        .execute(pool)
        .await
    {
        warn!(error = %e, "Failed to send batch cluster sync notification");
    }
}
