//! Job operation HTTP handlers.

use axum::{
    extract::{Path, Query, State},
    response::Json,
};
use serde_json::Value;

use crate::protocol::{JobBrowserItem, JobState};

use super::types::{
    AckRequest, ApiResponse, AppState, ChangePriorityRequest, FailRequest, JobDetailResponse,
    JobsQuery, MoveToDelayedRequest, ProgressRequest,
};

/// List jobs with filtering and pagination.
///
/// Returns a paginated list of jobs across all queues or filtered by queue/state.
/// Useful for building job browsers, dashboards, or monitoring tools.
/// Results are ordered by creation time (newest first).
#[utoipa::path(
    get,
    path = "/jobs",
    tag = "Jobs",
    summary = "List jobs with filtering",
    description = "Returns a paginated list of jobs. Filter by queue name and/or state (waiting, delayed, active, completed, failed). Supports pagination with limit/offset. Jobs are returned newest-first with essential metadata for browsing.",
    params(JobsQuery),
    responses(
        (status = 200, description = "Paginated list of jobs matching the filter criteria", body = Vec<JobBrowserItem>)
    )
)]
pub async fn list_jobs(
    State(qm): State<AppState>,
    Query(params): Query<JobsQuery>,
) -> Json<ApiResponse<Vec<JobBrowserItem>>> {
    let state_filter = params.state.as_deref().and_then(JobState::from_str);

    let jobs = qm.list_jobs(
        params.queue.as_deref(),
        state_filter,
        params.limit,
        params.offset,
    );
    ApiResponse::success(jobs)
}

/// Get job details with state and result.
///
/// Retrieves complete job information including payload, metadata, current state,
/// and result (if completed). Use this for job inspection and debugging.
#[utoipa::path(
    get,
    path = "/jobs/{id}",
    tag = "Jobs",
    summary = "Get complete job details",
    description = "Retrieves the full job object including: data payload, queue name, priority, timestamps, attempt count, current state (waiting/delayed/active/completed/failed), and result if available. Returns null job if not found.",
    params(("id" = u64, Path, description = "Unique job identifier returned from push operation")),
    responses(
        (status = 200, description = "Complete job details with state and result", body = JobDetailResponse)
    )
)]
pub async fn get_job(
    State(qm): State<AppState>,
    Path(id): Path<u64>,
) -> Json<ApiResponse<JobDetailResponse>> {
    let (job, state) = qm.get_job(id);
    let result = qm.get_result(id).await;
    ApiResponse::success(JobDetailResponse { job, state, result })
}

/// Acknowledge job completion.
///
/// Marks a job as successfully completed. The job is removed from active processing
/// and moved to completed state. Optionally stores a result for later retrieval.
/// Triggers 'completed' webhook events if configured.
#[utoipa::path(
    post,
    path = "/jobs/{id}/ack",
    tag = "Jobs",
    summary = "Acknowledge successful job completion",
    description = "Marks an active job as completed. The optional result is stored and can be retrieved via GET /jobs/{id}/result. Job is removed from processing and added to completed set. Notifies any waiters (finished() calls) and triggers webhooks. Fails if job is not in active state.",
    params(("id" = u64, Path, description = "Job ID currently being processed")),
    request_body = AckRequest,
    responses(
        (status = 200, description = "Job successfully acknowledged and marked complete")
    )
)]
pub async fn ack_job(
    State(qm): State<AppState>,
    Path(id): Path<u64>,
    Json(req): Json<AckRequest>,
) -> Json<ApiResponse<()>> {
    match qm.ack(id, req.result).await {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

/// Fail a job.
///
/// Marks a job as failed. If max_attempts hasn't been reached, the job is requeued
/// with exponential backoff. Otherwise, it moves to the Dead Letter Queue (DLQ).
/// Triggers 'failed' webhook events if configured.
#[utoipa::path(
    post,
    path = "/jobs/{id}/fail",
    tag = "Jobs",
    summary = "Mark job as failed with optional retry",
    description = "Reports job failure. Behavior depends on retry configuration: if attempts < max_attempts, job is requeued with exponential backoff (delay = backoff * 2^attempts). If max_attempts reached, job moves to DLQ. Error message is stored for debugging. Triggers webhooks and notifies waiters.",
    params(("id" = u64, Path, description = "Job ID currently being processed")),
    request_body = FailRequest,
    responses(
        (status = 200, description = "Job marked as failed, either requeued or moved to DLQ")
    )
)]
pub async fn fail_job(
    State(qm): State<AppState>,
    Path(id): Path<u64>,
    Json(req): Json<FailRequest>,
) -> Json<ApiResponse<()>> {
    match qm.fail(id, req.error).await {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

/// Cancel a pending job.
///
/// Removes a job from the queue before it's processed. Only works for jobs in
/// waiting or delayed state. Active jobs cannot be cancelled - use fail instead.
#[utoipa::path(
    post,
    path = "/jobs/{id}/cancel",
    tag = "Jobs",
    summary = "Cancel a pending job",
    description = "Removes a job from the waiting or delayed queue. The job is permanently deleted and will not be processed. Cannot cancel jobs already being processed (active state). Use fail() for active jobs. Returns error if job not found or already active.",
    params(("id" = u64, Path, description = "Job ID in waiting or delayed state")),
    responses(
        (status = 200, description = "Job cancelled and removed from queue")
    )
)]
pub async fn cancel_job(State(qm): State<AppState>, Path(id): Path<u64>) -> Json<ApiResponse<()>> {
    match qm.cancel(id).await {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

/// Update job progress.
///
/// Reports progress for long-running jobs. Useful for UI progress bars and
/// monitoring. Also acts as a heartbeat to prevent job timeout.
#[utoipa::path(
    post,
    path = "/jobs/{id}/progress",
    tag = "Jobs",
    summary = "Update job progress (0-100%)",
    description = "Reports processing progress for active jobs. Progress is 0-100 with optional message. Triggers 'progress' webhook/SSE events for real-time UI updates. Also serves as heartbeat to prevent stall_timeout from triggering. Call periodically for long-running jobs.",
    params(("id" = u64, Path, description = "Active job ID")),
    request_body = ProgressRequest,
    responses(
        (status = 200, description = "Progress updated and broadcast to listeners")
    )
)]
pub async fn update_progress(
    State(qm): State<AppState>,
    Path(id): Path<u64>,
    Json(req): Json<ProgressRequest>,
) -> Json<ApiResponse<()>> {
    match qm.update_progress(id, req.progress, req.message).await {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

/// Get job progress.
///
/// Retrieves current progress for an active job. Returns percentage (0-100)
/// and optional status message set by the worker.
#[utoipa::path(
    get,
    path = "/jobs/{id}/progress",
    tag = "Jobs",
    summary = "Get current job progress",
    description = "Returns the last reported progress for a job. Tuple contains: progress percentage (0-100) and optional message. Returns 0 if no progress reported yet. For real-time progress updates, use WebSocket or SSE endpoints instead.",
    params(("id" = u64, Path, description = "Job ID to check progress")),
    responses(
        (status = 200, description = "Current progress percentage and message", body = (u8, Option<String>))
    )
)]
pub async fn get_progress(
    State(qm): State<AppState>,
    Path(id): Path<u64>,
) -> Json<ApiResponse<(u8, Option<String>)>> {
    match qm.get_progress(id).await {
        Ok(progress) => ApiResponse::success(progress),
        Err(e) => ApiResponse::error(e),
    }
}

/// Get job result.
///
/// Retrieves the result data stored when the job was acknowledged.
/// Returns null if job not completed or no result was provided.
#[utoipa::path(
    get,
    path = "/jobs/{id}/result",
    tag = "Jobs",
    summary = "Get completed job result",
    description = "Returns the result JSON stored via ack(). Only available for completed jobs. Returns null if: job doesn't exist, job not completed yet, or no result was provided during acknowledgment. Results are retained based on keepCompletedAge/keepCompletedCount settings.",
    params(("id" = u64, Path, description = "Completed job ID")),
    responses(
        (status = 200, description = "Job result JSON or null if not available")
    )
)]
pub async fn get_result(
    State(qm): State<AppState>,
    Path(id): Path<u64>,
) -> Json<ApiResponse<Option<Value>>> {
    let result = qm.get_result(id).await;
    ApiResponse::success(result)
}

/// Change job priority.
///
/// Updates priority for a waiting job. Higher priority jobs are processed first.
/// Only works for jobs in waiting state (not delayed or active).
#[utoipa::path(
    post,
    path = "/jobs/{id}/priority",
    tag = "Jobs",
    summary = "Change job priority at runtime",
    description = "Modifies the priority of a waiting job. Priority is an i32 where higher values = processed first. Job is re-sorted in the priority queue. Only works for jobs in 'waiting' state. Use to expedite urgent jobs or deprioritize less critical ones.",
    params(("id" = u64, Path, description = "Job ID in waiting state")),
    request_body = ChangePriorityRequest,
    responses(
        (status = 200, description = "Priority updated, job re-sorted in queue")
    )
)]
pub async fn change_priority(
    State(qm): State<AppState>,
    Path(id): Path<u64>,
    Json(req): Json<ChangePriorityRequest>,
) -> Json<ApiResponse<()>> {
    match qm.change_priority(id, req.priority).await {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

/// Move active job back to delayed.
///
/// Reschedules an active job for later processing. Useful when a job cannot
/// be completed now but should be retried after a delay without counting as failure.
#[utoipa::path(
    post,
    path = "/jobs/{id}/move-to-delayed",
    tag = "Jobs",
    summary = "Reschedule active job for later",
    description = "Moves an active (processing) job back to delayed state. Unlike fail(), this doesn't increment attempt count or trigger exponential backoff. Use when: external dependency unavailable, rate limit hit, or job should wait for a specific time. Job will be re-pulled after delay expires.",
    params(("id" = u64, Path, description = "Active job ID to reschedule")),
    request_body = MoveToDelayedRequest,
    responses(
        (status = 200, description = "Job moved to delayed queue with specified delay")
    )
)]
pub async fn move_to_delayed(
    State(qm): State<AppState>,
    Path(id): Path<u64>,
    Json(req): Json<MoveToDelayedRequest>,
) -> Json<ApiResponse<()>> {
    match qm.move_to_delayed(id, req.delay).await {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

/// Promote delayed job to waiting.
///
/// Immediately moves a delayed job to waiting state, bypassing its scheduled time.
/// Useful for manual intervention when a delayed job needs immediate processing.
#[utoipa::path(
    post,
    path = "/jobs/{id}/promote",
    tag = "Jobs",
    summary = "Promote delayed job immediately",
    description = "Moves a delayed job to waiting state, skipping the scheduled run_at time. Job becomes immediately available for processing. Use for: manual intervention, testing, or when conditions changed and delay no longer needed. No effect on non-delayed jobs.",
    params(("id" = u64, Path, description = "Delayed job ID to promote")),
    responses(
        (status = 200, description = "Job promoted to waiting queue for immediate processing")
    )
)]
pub async fn promote_job(State(qm): State<AppState>, Path(id): Path<u64>) -> Json<ApiResponse<()>> {
    match qm.promote(id).await {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

/// Discard job to DLQ.
///
/// Immediately moves a job to the Dead Letter Queue regardless of state or attempt count.
/// Use for jobs that should not be processed or retried (e.g., invalid data, security concern).
#[utoipa::path(
    post,
    path = "/jobs/{id}/discard",
    tag = "Jobs",
    summary = "Move job directly to Dead Letter Queue",
    description = "Forces a job into the DLQ bypassing normal retry logic. Works from any state (waiting, delayed, active). Use when: job data is corrupted, security issue detected, or job should never run. Job can still be retried later via retry_dlq if needed.",
    params(("id" = u64, Path, description = "Job ID to discard")),
    responses(
        (status = 200, description = "Job moved to Dead Letter Queue")
    )
)]
pub async fn discard_job(State(qm): State<AppState>, Path(id): Path<u64>) -> Json<ApiResponse<()>> {
    match qm.discard(id).await {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}
