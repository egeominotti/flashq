//! Queue operation HTTP handlers.

use axum::{
    extract::{Path, Query, State},
    response::Json,
};

use crate::protocol::{Job, JobState, QueueInfo};

use super::types::{
    ApiResponse, AppState, CleanRequest, ConcurrencyRequest, PullQuery, PushRequest,
    RateLimitRequest, RetryDlqRequest,
};

/// List all queues.
#[utoipa::path(
    get,
    path = "/queues",
    tag = "Queues",
    responses(
        (status = 200, description = "List of queues", body = Vec<QueueInfo>)
    )
)]
pub async fn list_queues(State(qm): State<AppState>) -> Json<ApiResponse<Vec<QueueInfo>>> {
    let queues = qm.list_queues().await;
    ApiResponse::success(queues)
}

/// Push a job to a queue.
#[utoipa::path(
    post,
    path = "/queues/{queue}/jobs",
    tag = "Queues",
    params(("queue" = String, Path, description = "Queue name")),
    request_body = crate::protocol::JobInput,
    responses(
        (status = 200, description = "Job created", body = Job)
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
#[utoipa::path(
    get,
    path = "/queues/{queue}/jobs",
    tag = "Queues",
    params(
        ("queue" = String, Path, description = "Queue name"),
        PullQuery
    ),
    responses(
        (status = 200, description = "Jobs pulled", body = Vec<Job>)
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
#[utoipa::path(
    post,
    path = "/queues/{queue}/pause",
    tag = "Queues",
    params(("queue" = String, Path, description = "Queue name")),
    responses(
        (status = 200, description = "Queue paused")
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
#[utoipa::path(
    post,
    path = "/queues/{queue}/resume",
    tag = "Queues",
    params(("queue" = String, Path, description = "Queue name")),
    responses(
        (status = 200, description = "Queue resumed")
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
#[utoipa::path(
    get,
    path = "/queues/{queue}/dlq",
    tag = "Queues",
    params(
        ("queue" = String, Path, description = "Queue name"),
        PullQuery
    ),
    responses(
        (status = 200, description = "DLQ jobs", body = Vec<Job>)
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
/// If job_id is provided in the body, retries only that job.
/// Otherwise, retries all jobs in the DLQ for the queue.
#[utoipa::path(
    post,
    path = "/queues/{queue}/dlq/retry",
    tag = "Queues",
    params(("queue" = String, Path, description = "Queue name")),
    request_body = RetryDlqRequest,
    responses(
        (status = 200, description = "Number of jobs retried", body = usize)
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
#[utoipa::path(
    post,
    path = "/queues/{queue}/rate-limit",
    tag = "Queues",
    params(("queue" = String, Path, description = "Queue name")),
    request_body = RateLimitRequest,
    responses(
        (status = 200, description = "Rate limit set")
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
#[utoipa::path(
    delete,
    path = "/queues/{queue}/rate-limit",
    tag = "Queues",
    params(("queue" = String, Path, description = "Queue name")),
    responses(
        (status = 200, description = "Rate limit cleared")
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
#[utoipa::path(
    post,
    path = "/queues/{queue}/concurrency",
    tag = "Queues",
    params(("queue" = String, Path, description = "Queue name")),
    request_body = ConcurrencyRequest,
    responses(
        (status = 200, description = "Concurrency limit set")
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
#[utoipa::path(
    delete,
    path = "/queues/{queue}/concurrency",
    tag = "Queues",
    params(("queue" = String, Path, description = "Queue name")),
    responses(
        (status = 200, description = "Concurrency limit cleared")
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
#[utoipa::path(
    post,
    path = "/queues/{queue}/drain",
    tag = "Queues",
    params(("queue" = String, Path, description = "Queue name")),
    responses(
        (status = 200, description = "Number of jobs drained", body = usize)
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
#[utoipa::path(
    delete,
    path = "/queues/{queue}/obliterate",
    tag = "Queues",
    params(("queue" = String, Path, description = "Queue name")),
    responses(
        (status = 200, description = "Number of items removed", body = usize)
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
#[utoipa::path(
    post,
    path = "/queues/{queue}/clean",
    tag = "Queues",
    params(("queue" = String, Path, description = "Queue name")),
    request_body = CleanRequest,
    responses(
        (status = 200, description = "Number of jobs cleaned", body = usize)
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
