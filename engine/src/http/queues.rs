//! Queue operation HTTP handlers.

use axum::{
    extract::{Path, Query, State},
    response::Json,
};

use crate::protocol::{Job, JobState, QueueInfo};

use super::types::{
    ApiResponse, AppState, CleanRequest, ConcurrencyRequest, FlowRequest, JobCounts, PullQuery,
    PushRequest, RateLimitRequest, RetryDlqRequest,
};

/// List all queues.
///
/// Returns information about all queues in the system including job counts,
/// pause state, rate limits, and concurrency settings.
#[utoipa::path(
    get,
    path = "/queues",
    tag = "Queues",
    summary = "List all queues with status",
    description = "Returns all queues with: name, job counts by state (waiting, delayed, processing, DLQ), pause status, rate limit config, and concurrency limit. Useful for dashboard overview and monitoring. Empty queues are included if they have configuration.",
    responses(
        (status = 200, description = "List of all queues with counts and configuration", body = Vec<QueueInfo>)
    )
)]
pub async fn list_queues(State(qm): State<AppState>) -> Json<ApiResponse<Vec<QueueInfo>>> {
    let queues = qm.list_queues().await;
    ApiResponse::success(queues)
}

/// Push a job to a queue.
///
/// Creates a new job in the specified queue. Supports priorities, delays,
/// TTL, retries, dependencies, and unique key deduplication.
#[utoipa::path(
    post,
    path = "/queues/{queue}/jobs",
    tag = "Queues",
    summary = "Push a new job to queue",
    description = "Creates a job with the provided data and options. Key options: priority (higher = first), delay (ms before available), ttl (auto-expire), max_attempts + backoff (retry config), unique_key (deduplication), depends_on (job dependencies), jobId (custom ID for idempotency). Returns the created job with assigned ID.",
    params(("queue" = String, Path, description = "Target queue name (alphanumeric, underscore, hyphen, dot)")),
    request_body = crate::protocol::JobInput,
    responses(
        (status = 200, description = "Job created and queued for processing", body = Job)
    )
)]
pub async fn push_job(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    Json(req): Json<PushRequest>,
) -> Json<ApiResponse<Job>> {
    match qm.push(queue, req).await {
        Ok(job) => ApiResponse::success(job),
        Err(e) => ApiResponse::error(e),
    }
}

/// Pull jobs from a queue.
///
/// Retrieves and locks jobs for processing. Jobs move from 'waiting' to 'active' state.
/// Must call ack() or fail() after processing each job.
#[utoipa::path(
    get,
    path = "/queues/{queue}/jobs",
    tag = "Queues",
    summary = "Pull jobs for processing",
    description = "Atomically retrieves up to 'count' jobs and marks them as active/processing. Respects: queue pause state, rate limits, concurrency limits, and job priorities. Returns empty array if no jobs available or limits reached. Each job must be ack'd or fail'd within timeout to prevent stall detection.",
    params(
        ("queue" = String, Path, description = "Queue name to pull from"),
        PullQuery
    ),
    responses(
        (status = 200, description = "Jobs pulled and marked as active for processing", body = Vec<Job>)
    )
)]
pub async fn pull_jobs(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    Query(params): Query<PullQuery>,
) -> Json<ApiResponse<Vec<Job>>> {
    if params.count == 1 {
        let job = qm.pull(&queue).await;
        ApiResponse::success(vec![job])
    } else {
        let jobs = qm.pull_batch(&queue, params.count).await;
        ApiResponse::success(jobs)
    }
}

/// Pause a queue.
///
/// Stops job delivery from this queue. Active jobs continue processing,
/// but no new jobs will be pulled. New jobs can still be pushed.
#[utoipa::path(
    post,
    path = "/queues/{queue}/pause",
    tag = "Queues",
    summary = "Pause queue processing",
    description = "Pauses job delivery for the queue. Currently active jobs continue until completion. New jobs can still be pushed (they queue up). Pull requests return empty. Use for: maintenance, rate limiting recovery, or gradual shutdown. Check with isPaused(), resume with resume().",
    params(("queue" = String, Path, description = "Queue name to pause")),
    responses(
        (status = 200, description = "Queue paused - no new jobs will be delivered")
    )
)]
pub async fn pause_queue(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<()>> {
    qm.pause(&queue).await;
    ApiResponse::success(())
}

/// Resume a queue.
///
/// Resumes job delivery after a pause. Queued jobs become available immediately.
/// Workers will start receiving jobs on their next pull request.
#[utoipa::path(
    post,
    path = "/queues/{queue}/resume",
    tag = "Queues",
    summary = "Resume queue processing",
    description = "Resumes a paused queue. All waiting jobs become available for delivery. Delayed jobs remain scheduled. Workers are notified and can immediately pull jobs. No-op if queue is not paused.",
    params(("queue" = String, Path, description = "Queue name to resume")),
    responses(
        (status = 200, description = "Queue resumed - jobs available for delivery")
    )
)]
pub async fn resume_queue(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<()>> {
    qm.resume(&queue).await;
    ApiResponse::success(())
}

/// Get dead letter queue jobs.
///
/// Returns jobs that exceeded max_attempts or were discarded. DLQ jobs are kept
/// for inspection and can be retried manually via retry_dlq.
#[utoipa::path(
    get,
    path = "/queues/{queue}/dlq",
    tag = "Queues",
    summary = "Get Dead Letter Queue jobs",
    description = "Returns jobs in the DLQ. Jobs end up here when: max_attempts exceeded, manually discarded, or marked as unrecoverable. Each job includes error message and attempt history. Use retry_dlq to requeue for another attempt or delete after investigation.",
    params(
        ("queue" = String, Path, description = "Queue name"),
        PullQuery
    ),
    responses(
        (status = 200, description = "List of failed jobs in Dead Letter Queue", body = Vec<Job>)
    )
)]
pub async fn get_dlq(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    Query(params): Query<PullQuery>,
) -> Json<ApiResponse<Vec<Job>>> {
    let jobs = qm.get_dlq(&queue, Some(params.count)).await;
    ApiResponse::success(jobs)
}

/// Retry dead letter queue jobs.
///
/// Moves jobs from DLQ back to waiting state for reprocessing. Can retry a single
/// job by ID or all jobs in the queue's DLQ. Attempt counter is reset.
#[utoipa::path(
    post,
    path = "/queues/{queue}/dlq/retry",
    tag = "Queues",
    summary = "Retry DLQ jobs",
    description = "Requeues failed jobs for another processing attempt. If job_id provided, retries only that job. If no job_id, retries ALL jobs in the queue's DLQ. Jobs move to waiting state with attempt counter reset. Returns count of jobs requeued.",
    params(("queue" = String, Path, description = "Queue name")),
    request_body = RetryDlqRequest,
    responses(
        (status = 200, description = "Number of jobs moved from DLQ to waiting", body = usize)
    )
)]
pub async fn retry_dlq(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    body: Option<Json<RetryDlqRequest>>,
) -> Json<ApiResponse<usize>> {
    let job_id = body.and_then(|b| b.job_id);
    let count = qm.retry_dlq(&queue, job_id).await;
    ApiResponse::success(count)
}

/// Set queue rate limit.
///
/// Limits how many jobs can be pulled from this queue per second using
/// token bucket algorithm. Excess pull requests return empty.
#[utoipa::path(
    post,
    path = "/queues/{queue}/rate-limit",
    tag = "Queues",
    summary = "Set queue rate limit (jobs/sec)",
    description = "Configures maximum job delivery rate using token bucket algorithm. Limit is jobs per second. When limit reached, pull() returns empty until tokens refill. Use for: protecting downstream services, API rate limits, or controlled load. Clear with DELETE /rate-limit.",
    params(("queue" = String, Path, description = "Queue name to rate limit")),
    request_body = RateLimitRequest,
    responses(
        (status = 200, description = "Rate limit configured")
    )
)]
pub async fn set_rate_limit(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    Json(req): Json<RateLimitRequest>,
) -> Json<ApiResponse<()>> {
    qm.set_rate_limit(queue, req.limit).await;
    ApiResponse::success(())
}

/// Clear queue rate limit.
///
/// Removes rate limiting from the queue. Jobs will be delivered as fast as workers can pull.
#[utoipa::path(
    delete,
    path = "/queues/{queue}/rate-limit",
    tag = "Queues",
    summary = "Remove queue rate limit",
    description = "Clears the rate limit configuration. Queue returns to unlimited delivery rate. Jobs will be available as fast as workers can pull them.",
    params(("queue" = String, Path, description = "Queue name")),
    responses(
        (status = 200, description = "Rate limit removed")
    )
)]
pub async fn clear_rate_limit(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<()>> {
    qm.clear_rate_limit(&queue).await;
    ApiResponse::success(())
}

/// Set queue concurrency limit.
///
/// Limits how many jobs can be actively processed at once across all workers.
/// Prevents overwhelming downstream resources.
#[utoipa::path(
    post,
    path = "/queues/{queue}/concurrency",
    tag = "Queues",
    summary = "Set max concurrent active jobs",
    description = "Limits the number of jobs in 'active' state simultaneously. When limit reached, pull() returns empty until active jobs complete. Different from rate limit: rate limit controls delivery speed, concurrency limits parallel processing. Useful for: database connection limits, external API constraints, resource protection.",
    params(("queue" = String, Path, description = "Queue name")),
    request_body = ConcurrencyRequest,
    responses(
        (status = 200, description = "Concurrency limit configured")
    )
)]
pub async fn set_concurrency(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    Json(req): Json<ConcurrencyRequest>,
) -> Json<ApiResponse<()>> {
    qm.set_concurrency(queue, req.limit).await;
    ApiResponse::success(())
}

/// Clear queue concurrency limit.
///
/// Removes concurrency limiting. Jobs will be delivered regardless of how many are active.
#[utoipa::path(
    delete,
    path = "/queues/{queue}/concurrency",
    tag = "Queues",
    summary = "Remove concurrency limit",
    description = "Clears concurrency limit. No restriction on parallel active jobs. Workers can pull jobs regardless of current processing count.",
    params(("queue" = String, Path, description = "Queue name")),
    responses(
        (status = 200, description = "Concurrency limit removed")
    )
)]
pub async fn clear_concurrency(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<()>> {
    qm.clear_concurrency(&queue).await;
    ApiResponse::success(())
}

/// Drain all waiting jobs from a queue.
///
/// Removes all jobs in waiting and delayed state. Active jobs and DLQ are not affected.
/// Use for clearing backlogs or resetting a queue.
#[utoipa::path(
    post,
    path = "/queues/{queue}/drain",
    tag = "Queues",
    summary = "Remove all pending jobs",
    description = "Removes all jobs in 'waiting' and 'delayed' states. Jobs are permanently deleted. Active (processing) jobs continue unaffected. DLQ is preserved. Returns count of removed jobs. Use for: clearing backlogs, testing cleanup, or emergency queue reset.",
    params(("queue" = String, Path, description = "Queue name to drain")),
    responses(
        (status = 200, description = "Number of waiting/delayed jobs removed", body = usize)
    )
)]
pub async fn drain_queue(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<usize>> {
    let count = qm.drain(&queue).await;
    ApiResponse::success(count)
}

/// Remove all queue data (obliterate).
///
/// Completely deletes a queue and all its data: waiting jobs, delayed jobs, DLQ,
/// cron jobs, and configuration. Irreversible operation. Active jobs may be orphaned.
#[utoipa::path(
    delete,
    path = "/queues/{queue}/obliterate",
    tag = "Queues",
    summary = "Completely delete queue and all data",
    description = "Permanently removes the queue and ALL associated data: waiting jobs, delayed jobs, DLQ entries, cron jobs, rate/concurrency config. Active jobs become orphaned (will timeout). Queue can be recreated by pushing new jobs. IRREVERSIBLE - use with caution.",
    params(("queue" = String, Path, description = "Queue name to obliterate")),
    responses(
        (status = 200, description = "Total items removed (jobs + config)", body = usize)
    )
)]
pub async fn obliterate_queue(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<usize>> {
    let count = qm.obliterate(&queue).await;
    ApiResponse::success(count)
}

/// Clean jobs by age and state.
///
/// Removes jobs older than the grace period from a specific state.
/// Useful for cleanup of completed/failed jobs or pruning old delayed jobs.
#[utoipa::path(
    post,
    path = "/queues/{queue}/clean",
    tag = "Queues",
    summary = "Cleanup old jobs by state",
    description = "Removes jobs older than 'grace' milliseconds from specified state. States: waiting, delayed, completed, failed. Optional 'limit' caps removals per call. Use for: cleaning old completed jobs, pruning stale delayed jobs, or DLQ maintenance. Called automatically based on retention settings.",
    params(("queue" = String, Path, description = "Queue name")),
    request_body = CleanRequest,
    responses(
        (status = 200, description = "Number of old jobs removed", body = usize)
    )
)]
pub async fn clean_queue(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    Json(req): Json<CleanRequest>,
) -> Json<ApiResponse<usize>> {
    let state_enum = match JobState::from_str(&req.state) {
        Some(s) => s,
        None => {
            return ApiResponse::error("Invalid state. Use: waiting, delayed, completed, failed")
        }
    };
    let count = qm.clean(&queue, req.grace, state_enum, req.limit).await;
    ApiResponse::success(count)
}

/// Purge dead letter queue.
///
/// Removes all jobs from the DLQ permanently. Jobs are not retried, they are deleted.
/// Use for cleaning up DLQ after investigation or when jobs are no longer needed.
#[utoipa::path(
    delete,
    path = "/queues/{queue}/dlq",
    tag = "Queues",
    summary = "Purge all DLQ jobs permanently",
    description = "Permanently removes all jobs from the Dead Letter Queue. Jobs are deleted, not retried. Use after investigation when failed jobs are no longer needed. Returns the count of jobs purged. IRREVERSIBLE - jobs cannot be recovered after purge.",
    params(("queue" = String, Path, description = "Queue name")),
    responses(
        (status = 200, description = "Number of jobs purged from DLQ", body = usize)
    )
)]
pub async fn purge_dlq(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<usize>> {
    let count = qm.purge_dlq(&queue).await;
    ApiResponse::success(count)
}

/// Check if queue is paused.
///
/// Returns a boolean indicating whether the queue is currently paused.
/// Paused queues accept new jobs but don't deliver them to workers.
#[utoipa::path(
    get,
    path = "/queues/{queue}/paused",
    tag = "Queues",
    summary = "Check if queue is paused",
    description = "Returns true if the queue is paused, false otherwise. Paused queues accept new pushed jobs but pull() returns empty. Use before critical operations or to check queue status in monitoring.",
    params(("queue" = String, Path, description = "Queue name to check")),
    responses(
        (status = 200, description = "Queue pause status", body = bool)
    )
)]
pub async fn is_queue_paused(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<bool>> {
    let paused = qm.is_paused(&queue);
    ApiResponse::success(paused)
}

/// Get job counts by state for a queue.
///
/// Returns counts of jobs grouped by state: waiting, active, delayed, completed, failed.
/// Useful for dashboard displays and monitoring queue health.
#[utoipa::path(
    get,
    path = "/queues/{queue}/counts",
    tag = "Queues",
    summary = "Get job counts by state",
    description = "Returns job counts grouped by state for the specified queue. States: waiting (ready to process), active (processing), delayed (scheduled for later), completed, failed (in DLQ). Useful for monitoring and dashboards.",
    params(("queue" = String, Path, description = "Queue name")),
    responses(
        (status = 200, description = "Job counts by state", body = JobCounts)
    )
)]
pub async fn get_job_counts(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<JobCounts>> {
    let (waiting, active, delayed, completed, failed) = qm.get_job_counts(&queue);
    ApiResponse::success(JobCounts {
        waiting,
        active,
        delayed,
        completed,
        failed,
    })
}

/// Count pending jobs in a queue.
///
/// Returns the total count of jobs in waiting + delayed state.
/// Quick way to check queue backlog size without fetching job details.
#[utoipa::path(
    get,
    path = "/queues/{queue}/count",
    tag = "Queues",
    summary = "Count waiting + delayed jobs",
    description = "Returns the sum of jobs in waiting and delayed states. Quick health check for queue backlog. Does not include active, completed, or failed jobs. Use for throttling, load balancing decisions, or monitoring.",
    params(("queue" = String, Path, description = "Queue name")),
    responses(
        (status = 200, description = "Count of pending jobs", body = usize)
    )
)]
pub async fn count_jobs(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<usize>> {
    let count = qm.count(&queue);
    ApiResponse::success(count)
}

/// Push a flow with parent and children jobs.
///
/// Creates a workflow where the parent job waits for all children to complete.
/// Children are pushed first, then the parent is created with dependencies.
#[utoipa::path(
    post,
    path = "/queues/{queue}/flow",
    tag = "Queues",
    summary = "Push a workflow with dependencies",
    description = "Creates a parent job that waits for all child jobs to complete. Children are processed in parallel. Parent becomes ready when all children finish. Returns parent ID and list of child IDs. Use for complex workflows with dependencies.",
    params(("queue" = String, Path, description = "Queue name for parent job")),
    request_body = FlowRequest,
    responses(
        (status = 200, description = "Flow created", body = FlowResponse)
    )
)]
pub async fn push_flow(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    Json(req): Json<FlowRequest>,
) -> Json<ApiResponse<FlowResponse>> {
    // Convert HTTP FlowChild to protocol FlowChild
    let children: Vec<crate::protocol::FlowChild> = req
        .children
        .into_iter()
        .map(|c| crate::protocol::FlowChild {
            queue: c.queue,
            data: c.data,
            priority: c.priority,
            delay: c.delay,
        })
        .collect();

    match qm.push_flow(queue, req.data, children, req.priority).await {
        Ok((parent_id, children_ids)) => ApiResponse::success(FlowResponse {
            parent_id,
            children_ids,
        }),
        Err(e) => ApiResponse::error(e),
    }
}

/// Flow response with parent and children IDs.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct FlowResponse {
    pub parent_id: u64,
    pub children_ids: Vec<u64>,
}
