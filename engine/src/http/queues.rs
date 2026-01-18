//! Queue operation HTTP handlers.

use axum::{
    extract::{Path, Query, State},
    response::Json,
};

use crate::protocol::{Job, JobState, QueueInfo};

use super::types::{
    ApiResponse, AppState, CleanRequest, ConcurrencyRequest, PullQuery, PushRequest,
    RateLimitRequest,
};

/// List all queues.
pub async fn list_queues(State(qm): State<AppState>) -> Json<ApiResponse<Vec<QueueInfo>>> {
    let queues = qm.list_queues().await;
    ApiResponse::success(queues)
}

/// Push a job to a queue.
pub async fn push_job(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    Json(req): Json<PushRequest>,
) -> Json<ApiResponse<Job>> {
    match qm
        .push(
            queue,
            req.data,
            req.priority,
            req.delay,
            req.ttl,
            req.timeout,
            req.max_attempts,
            req.backoff,
            req.unique_key,
            req.depends_on,
            req.tags,
            req.lifo,
            req.remove_on_complete,
            req.remove_on_fail,
            req.stall_timeout,
            req.debounce_id,
            req.debounce_ttl,
            req.job_id,
            req.keep_completed_age,
            req.keep_completed_count,
            req.group_id,
        )
        .await
    {
        Ok(job) => ApiResponse::success(job),
        Err(e) => ApiResponse::error(e),
    }
}

/// Pull jobs from a queue.
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
pub async fn pause_queue(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<()>> {
    qm.pause(&queue).await;
    ApiResponse::success(())
}

/// Resume a queue.
pub async fn resume_queue(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<()>> {
    qm.resume(&queue).await;
    ApiResponse::success(())
}

/// Get dead letter queue jobs.
pub async fn get_dlq(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    Query(params): Query<PullQuery>,
) -> Json<ApiResponse<Vec<Job>>> {
    let jobs = qm.get_dlq(&queue, Some(params.count)).await;
    ApiResponse::success(jobs)
}

/// Retry dead letter queue jobs.
pub async fn retry_dlq(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<usize>> {
    let count = qm.retry_dlq(&queue, None).await;
    ApiResponse::success(count)
}

/// Set queue rate limit.
pub async fn set_rate_limit(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    Json(req): Json<RateLimitRequest>,
) -> Json<ApiResponse<()>> {
    qm.set_rate_limit(queue, req.limit).await;
    ApiResponse::success(())
}

/// Clear queue rate limit.
pub async fn clear_rate_limit(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<()>> {
    qm.clear_rate_limit(&queue).await;
    ApiResponse::success(())
}

/// Set queue concurrency limit.
pub async fn set_concurrency(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    Json(req): Json<ConcurrencyRequest>,
) -> Json<ApiResponse<()>> {
    qm.set_concurrency(queue, req.limit).await;
    ApiResponse::success(())
}

/// Clear queue concurrency limit.
pub async fn clear_concurrency(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<()>> {
    qm.clear_concurrency(&queue).await;
    ApiResponse::success(())
}

/// Drain all waiting jobs from a queue.
pub async fn drain_queue(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<usize>> {
    let count = qm.drain(&queue).await;
    ApiResponse::success(count)
}

/// Remove all queue data (obliterate).
pub async fn obliterate_queue(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Json<ApiResponse<usize>> {
    let count = qm.obliterate(&queue).await;
    ApiResponse::success(count)
}

/// Clean jobs by age and state.
pub async fn clean_queue(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    Json(req): Json<CleanRequest>,
) -> Json<ApiResponse<usize>> {
    let state_enum = match req.state.to_lowercase().as_str() {
        "waiting" => JobState::Waiting,
        "delayed" => JobState::Delayed,
        "completed" => JobState::Completed,
        "failed" => JobState::Failed,
        _ => return ApiResponse::error("Invalid state. Use: waiting, delayed, completed, failed"),
    };
    let count = qm.clean(&queue, req.grace, state_enum, req.limit).await;
    ApiResponse::success(count)
}
