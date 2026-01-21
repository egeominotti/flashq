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
pub async fn get_job(
    State(qm): State<AppState>,
    Path(id): Path<u64>,
) -> Json<ApiResponse<JobDetailResponse>> {
    let (job, state) = qm.get_job(id);
    let result = qm.get_result(id).await;
    ApiResponse::success(JobDetailResponse { job, state, result })
}

/// Acknowledge job completion.
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
pub async fn cancel_job(State(qm): State<AppState>, Path(id): Path<u64>) -> Json<ApiResponse<()>> {
    match qm.cancel(id).await {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

/// Update job progress.
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
pub async fn get_result(
    State(qm): State<AppState>,
    Path(id): Path<u64>,
) -> Json<ApiResponse<Option<Value>>> {
    let result = qm.get_result(id).await;
    ApiResponse::success(result)
}

/// Change job priority.
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
pub async fn promote_job(State(qm): State<AppState>, Path(id): Path<u64>) -> Json<ApiResponse<()>> {
    match qm.promote(id).await {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

/// Discard job to DLQ.
pub async fn discard_job(State(qm): State<AppState>, Path(id): Path<u64>) -> Json<ApiResponse<()>> {
    match qm.discard(id).await {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}
