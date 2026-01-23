//! NATS push operations with priority bucket routing.
//!
//! Routes jobs to appropriate streams based on priority and delay.

use async_nats::jetstream::publish::PublishAck;
use async_nats::jetstream::Context as JetStreamContext;
use tracing::debug;

use super::config::{NatsConfig, PriorityBucket};
use super::connection::NatsError;
use super::kv::KvStores;
use crate::protocol::Job;

/// Push a job to NATS JetStream.
///
/// Routes to:
/// - `flashq.{queue}.delayed` if job has future run_at
/// - `flashq.{queue}.priority.{high|normal|low}` based on priority
pub async fn push_job(
    jetstream: &JetStreamContext,
    config: &NatsConfig,
    kv: &KvStores,
    job: &Job,
) -> Result<PublishAck, NatsError> {
    // Store job metadata in KV
    kv.put_job(job).await?;

    // Store custom ID mapping if present
    if let Some(ref custom_id) = job.custom_id {
        kv.put_custom_id(custom_id, job.id).await?;
    }

    // Determine target subject based on delay and priority
    let subject = if job.run_at > crate::queue::types::now_ms() {
        // Delayed job
        config.delayed_stream(&job.queue)
    } else {
        // Ready job - route by priority
        let bucket = PriorityBucket::from_priority(job.priority);
        config.priority_stream(&job.queue, bucket)
    };

    // Serialize job for stream
    let payload = serialize_job_ref(job)?;

    // Publish to stream
    let ack = jetstream
        .publish(subject.clone(), payload.into())
        .await
        .map_err(|e| NatsError::PublishFailed(format!("Failed to publish to {}: {}", subject, e)))?
        .await
        .map_err(|e| NatsError::PublishFailed(format!("Publish ack failed: {}", e)))?;

    debug!(
        job_id = job.id,
        queue = %job.queue,
        subject = %subject,
        "Job pushed to NATS"
    );

    Ok(ack)
}

/// Push multiple jobs in a batch.
pub async fn push_jobs_batch(
    jetstream: &JetStreamContext,
    config: &NatsConfig,
    kv: &KvStores,
    jobs: &[Job],
) -> Result<Vec<Result<PublishAck, NatsError>>, NatsError> {
    let mut results = Vec::with_capacity(jobs.len());

    // Group jobs by target subject for efficient batching
    for job in jobs {
        let result = push_job(jetstream, config, kv, job).await;
        results.push(result);
    }

    Ok(results)
}

/// Push a job directly to DLQ.
pub async fn push_to_dlq(
    jetstream: &JetStreamContext,
    config: &NatsConfig,
    kv: &KvStores,
    job: &Job,
    error: Option<&str>,
) -> Result<PublishAck, NatsError> {
    // Update job metadata with error
    let mut dlq_job = job.clone();
    if let Some(err) = error {
        dlq_job.progress_msg = Some(format!("DLQ: {}", err));
    }

    // Mark as DLQ job for recovery: ensure attempts >= max_attempts
    // This allows load_dlq_jobs() to identify DLQ jobs on restart
    if dlq_job.max_attempts == 0 {
        dlq_job.max_attempts = 1;
    }
    dlq_job.attempts = dlq_job.max_attempts;

    // Store updated job in KV
    kv.put_job(&dlq_job).await?;

    // Serialize for DLQ stream
    let subject = config.dlq_stream(&job.queue);
    let payload = serialize_job_ref(&dlq_job)?;

    // Publish to DLQ stream
    let ack = jetstream
        .publish(subject.clone(), payload.into())
        .await
        .map_err(|e| NatsError::PublishFailed(format!("Failed to publish to DLQ: {}", e)))?
        .await
        .map_err(|e| NatsError::PublishFailed(format!("DLQ publish ack failed: {}", e)))?;

    debug!(
        job_id = job.id,
        queue = %job.queue,
        error = ?error,
        "Job pushed to DLQ"
    );

    Ok(ack)
}

/// Move a job from delayed to priority queue (promotion).
pub async fn promote_job(
    jetstream: &JetStreamContext,
    config: &NatsConfig,
    job: &Job,
) -> Result<PublishAck, NatsError> {
    // Route by priority
    let bucket = PriorityBucket::from_priority(job.priority);
    let subject = config.priority_stream(&job.queue, bucket);

    // Serialize job
    let payload = serialize_job_ref(job)?;

    // Publish to priority stream
    let ack = jetstream
        .publish(subject.clone(), payload.into())
        .await
        .map_err(|e| NatsError::PublishFailed(format!("Failed to promote job: {}", e)))?
        .await
        .map_err(|e| NatsError::PublishFailed(format!("Promote ack failed: {}", e)))?;

    debug!(
        job_id = job.id,
        queue = %job.queue,
        priority = job.priority,
        bucket = %bucket.as_str(),
        "Job promoted from delayed"
    );

    Ok(ack)
}

/// Retry a job (move back to queue after failure).
pub async fn retry_job(
    jetstream: &JetStreamContext,
    config: &NatsConfig,
    kv: &KvStores,
    job: &Job,
    new_run_at: u64,
) -> Result<PublishAck, NatsError> {
    // Create updated job with new run_at
    let mut retry_job = job.clone();
    retry_job.run_at = new_run_at;
    retry_job.attempts += 1;
    retry_job.started_at = 0; // Reset started_at

    // Update job in KV
    kv.put_job(&retry_job).await?;

    // Determine target subject
    let now = crate::queue::types::now_ms();
    let subject = if new_run_at > now {
        // Future run_at means delayed
        config.delayed_stream(&job.queue)
    } else {
        // Ready to run
        let bucket = PriorityBucket::from_priority(job.priority);
        config.priority_stream(&job.queue, bucket)
    };

    // Serialize and publish
    let payload = serialize_job_ref(&retry_job)?;

    let ack = jetstream
        .publish(subject.clone(), payload.into())
        .await
        .map_err(|e| NatsError::PublishFailed(format!("Failed to retry job: {}", e)))?
        .await
        .map_err(|e| NatsError::PublishFailed(format!("Retry ack failed: {}", e)))?;

    debug!(
        job_id = job.id,
        queue = %job.queue,
        attempts = retry_job.attempts,
        new_run_at = new_run_at,
        "Job scheduled for retry"
    );

    Ok(ack)
}

/// Serialize job reference to a compact format for stream messages.
///
/// We only store the job ID in the stream message, as full job data is in KV.
/// This keeps stream messages small and deduplication efficient.
#[inline]
fn serialize_job_ref(job: &Job) -> Result<Vec<u8>, NatsError> {
    // Store full job in stream for now (can optimize to just ID later)
    rmp_serde::to_vec(job).map_err(|e| NatsError::SerializationError(e.to_string()))
}

/// Deserialize job reference from stream message.
#[inline]
pub fn deserialize_job_ref(data: &[u8]) -> Result<Job, NatsError> {
    rmp_serde::from_slice(data).map_err(|e| NatsError::SerializationError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn test_priority_routing() {
        let config = NatsConfig::default();

        // High priority (>= 5)
        assert_eq!(
            config.priority_stream("email", PriorityBucket::from_priority(10)),
            "flashq.email.priority.high"
        );
        assert_eq!(
            config.priority_stream("email", PriorityBucket::from_priority(5)),
            "flashq.email.priority.high"
        );

        // Normal priority (0-4)
        assert_eq!(
            config.priority_stream("email", PriorityBucket::from_priority(4)),
            "flashq.email.priority.normal"
        );
        assert_eq!(
            config.priority_stream("email", PriorityBucket::from_priority(0)),
            "flashq.email.priority.normal"
        );

        // Low priority (< 0)
        assert_eq!(
            config.priority_stream("email", PriorityBucket::from_priority(-1)),
            "flashq.email.priority.low"
        );
    }

    #[test]
    fn test_job_serialization_roundtrip() {
        let job = Job {
            id: 12345,
            queue: "test".to_string(),
            data: Arc::new(serde_json::json!({"key": "value"})),
            priority: 5,
            created_at: 1000,
            run_at: 1000,
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
            tags: vec![],
            lifo: false,
            remove_on_complete: false,
            remove_on_fail: false,
            last_heartbeat: 0,
            stall_timeout: 0,
            stall_count: 0,
            parent_id: None,
            children_ids: vec![],
            children_completed: 0,
            custom_id: Some("custom-123".to_string()),
            keep_completed_age: 0,
            keep_completed_count: 0,
            completed_at: 0,
            group_id: None,
        };

        let serialized = serialize_job_ref(&job).unwrap();
        let deserialized = deserialize_job_ref(&serialized).unwrap();

        assert_eq!(job.id, deserialized.id);
        assert_eq!(job.queue, deserialized.queue);
        assert_eq!(job.priority, deserialized.priority);
        assert_eq!(job.custom_id, deserialized.custom_id);
    }
}
