//! NATS acknowledgment and failure operations.
//!
//! Handles job completion, failure, retry, and DLQ routing.

use async_nats::jetstream::Context as JetStreamContext;
use serde_json::Value;
use tracing::{debug, info};

use super::config::NatsConfig;
use super::connection::NatsError;
use super::kv::KvStores;
use super::pull::PulledJob;
use super::push::{push_to_dlq, retry_job};
use crate::queue::types::now_ms;

/// Acknowledge a job as successfully completed.
pub async fn ack_job(
    kv: &KvStores,
    pulled_job: PulledJob,
    result: Option<Value>,
) -> Result<(), NatsError> {
    let job_id = pulled_job.job.id;
    let queue = pulled_job.job.queue.clone();

    // Store result if provided
    if let Some(ref res) = result {
        kv.put_result(job_id, res).await?;
    }

    // Remove job from active KV (or mark as completed)
    // For retention policies, we might keep the job data
    if !pulled_job.job.remove_on_complete {
        // Update job with completion timestamp
        let mut completed_job = pulled_job.job.clone();
        completed_job.completed_at = now_ms();
        kv.put_job(&completed_job).await?;
    } else {
        // Remove job data entirely
        kv.delete_job(job_id).await?;
    }

    // Acknowledge the NATS message (removes from stream)
    pulled_job.ack().await?;

    debug!(
        job_id = job_id,
        queue = %queue,
        has_result = result.is_some(),
        "Job completed"
    );

    Ok(())
}

/// Acknowledge multiple jobs as completed.
pub async fn ack_jobs_batch(
    kv: &KvStores,
    jobs: Vec<PulledJob>,
) -> Result<Vec<Result<(), NatsError>>, NatsError> {
    let mut results = Vec::with_capacity(jobs.len());

    for pulled_job in jobs {
        let result = ack_job(kv, pulled_job, None).await;
        results.push(result);
    }

    Ok(results)
}

/// Fail a job with optional retry.
pub async fn fail_job(
    jetstream: &JetStreamContext,
    config: &NatsConfig,
    kv: &KvStores,
    pulled_job: PulledJob,
    error: Option<&str>,
) -> Result<FailResult, NatsError> {
    let job = &pulled_job.job;
    let job_id = job.id;
    let queue = job.queue.clone();
    let attempts = job.attempts + 1;
    let max_attempts = job.max_attempts;

    // Check if should go to DLQ
    let should_dlq = max_attempts > 0 && attempts >= max_attempts;

    if should_dlq {
        // Move to DLQ
        if !job.remove_on_fail {
            push_to_dlq(jetstream, config, kv, job, error).await?;
        }

        // Terminate the message (won't be redelivered)
        pulled_job.term().await?;

        info!(
            job_id = job_id,
            queue = %queue,
            attempts = attempts,
            max_attempts = max_attempts,
            error = ?error,
            "Job moved to DLQ"
        );

        Ok(FailResult::MovedToDlq)
    } else {
        // Calculate retry delay with exponential backoff
        let backoff = job.backoff;
        let delay_ms = if backoff > 0 {
            backoff * (1 << attempts.min(10))
        } else {
            1000 // Default 1 second
        };

        let new_run_at = now_ms() + delay_ms;

        // Retry the job
        retry_job(jetstream, config, kv, job, new_run_at).await?;

        // Acknowledge original message (we've created a new one)
        pulled_job.ack().await?;

        debug!(
            job_id = job_id,
            queue = %queue,
            attempts = attempts,
            delay_ms = delay_ms,
            error = ?error,
            "Job scheduled for retry"
        );

        Ok(FailResult::Retrying { delay_ms })
    }
}

/// Result of a fail operation.
#[derive(Debug, Clone)]
pub enum FailResult {
    /// Job will be retried after delay
    Retrying { delay_ms: u64 },
    /// Job moved to DLQ (max attempts reached)
    MovedToDlq,
}

/// Get job result from KV store.
pub async fn get_result(kv: &KvStores, job_id: u64) -> Result<Option<Value>, NatsError> {
    kv.get_result(job_id).await
}

/// Update job progress.
pub async fn update_progress(
    kv: &KvStores,
    job_id: u64,
    progress: u8,
    message: Option<&str>,
) -> Result<(), NatsError> {
    // Update progress in KV
    kv.put_progress(job_id, progress, message).await?;

    // Also update job metadata
    if let Some(mut job) = kv.get_job(job_id).await? {
        job.progress = progress;
        job.progress_msg = message.map(String::from);
        kv.put_job(&job).await?;
    }

    debug!(
        job_id = job_id,
        progress = progress,
        message = ?message,
        "Progress updated"
    );

    Ok(())
}

/// Get job progress.
pub async fn get_progress(
    kv: &KvStores,
    job_id: u64,
) -> Result<Option<(u8, Option<String>)>, NatsError> {
    kv.get_progress(job_id).await
}

/// Update job heartbeat (for stall detection).
pub async fn heartbeat(kv: &KvStores, job_id: u64) -> Result<(), NatsError> {
    if let Some(mut job) = kv.get_job(job_id).await? {
        job.last_heartbeat = now_ms();
        kv.put_job(&job).await?;
        debug!(job_id = job_id, "Heartbeat updated");
    }
    Ok(())
}

/// Cancel a pending job.
pub async fn cancel_job(
    jetstream: &JetStreamContext,
    config: &NatsConfig,
    kv: &KvStores,
    job_id: u64,
) -> Result<bool, NatsError> {
    // Get job from KV
    let job = match kv.get_job(job_id).await? {
        Some(j) => j,
        None => return Ok(false), // Job not found
    };

    // Delete from KV
    kv.delete_job(job_id).await?;

    // Delete custom ID mapping if present
    if let Some(ref custom_id) = job.custom_id {
        kv.delete_custom_id(custom_id).await?;
    }

    // Note: The job message in the stream will be skipped by consumers
    // since it's no longer in the KV store. Alternatively, we could
    // purge the specific message from the stream, but that's more complex.

    info!(job_id = job_id, queue = %job.queue, "Job cancelled");

    Ok(true)
}

/// Discard a job (move directly to DLQ without retry).
pub async fn discard_job(
    jetstream: &JetStreamContext,
    config: &NatsConfig,
    kv: &KvStores,
    job_id: u64,
    reason: Option<&str>,
) -> Result<bool, NatsError> {
    // Get job from KV
    let job = match kv.get_job(job_id).await? {
        Some(j) => j,
        None => return Ok(false), // Job not found
    };

    // Move to DLQ
    push_to_dlq(jetstream, config, kv, &job, reason).await?;

    info!(
        job_id = job_id,
        queue = %job.queue,
        reason = ?reason,
        "Job discarded to DLQ"
    );

    Ok(true)
}

/// Retry a job from DLQ.
pub async fn retry_dlq_job(
    jetstream: &JetStreamContext,
    config: &NatsConfig,
    kv: &KvStores,
    job_id: u64,
) -> Result<bool, NatsError> {
    // Get job from KV
    let mut job = match kv.get_job(job_id).await? {
        Some(j) => j,
        None => return Ok(false), // Job not found
    };

    // Reset attempts and run_at
    job.attempts = 0;
    job.run_at = now_ms();
    job.started_at = 0;
    job.progress = 0;
    job.progress_msg = None;

    // Re-push to queue
    super::push::push_job(jetstream, config, kv, &job).await?;

    info!(job_id = job_id, queue = %job.queue, "DLQ job retried");

    Ok(true)
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_backoff_calculation() {
        // Test exponential backoff: backoff * 2^attempts
        let backoff = 1000u64; // 1 second base

        assert_eq!(backoff * (1 << 0), 1000); // 1st attempt: 1s
        assert_eq!(backoff * (1 << 1), 2000); // 2nd attempt: 2s
        assert_eq!(backoff * (1 << 2), 4000); // 3rd attempt: 4s
        assert_eq!(backoff * (1 << 3), 8000); // 4th attempt: 8s
        assert_eq!(backoff * (1 << 10), 1024000); // Max capped at 10
    }
}
