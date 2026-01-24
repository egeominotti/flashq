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
#[utoipa::path(
    get,
    path = "/jobs",
    tag = "Jobs",
    params(JobsQuery),
    responses(
        (status = 200, description = "List of jobs", body = Vec<JobBrowserItem>)
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
#[utoipa::path(
    get,
    path = "/jobs/{id}",
    tag = "Jobs",
    params(("id" = u64, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Job details", body = JobDetailResponse)
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
#[utoipa::path(
    post,
    path = "/jobs/{id}/ack",
    tag = "Jobs",
    params(("id" = u64, Path, description = "Job ID")),
    request_body = AckRequest,
    responses(
        (status = 200, description = "Job acknowledged")
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
#[utoipa::path(
    post,
    path = "/jobs/{id}/fail",
    tag = "Jobs",
    params(("id" = u64, Path, description = "Job ID")),
    request_body = FailRequest,
    responses(
        (status = 200, description = "Job failed")
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
#[utoipa::path(
    post,
    path = "/jobs/{id}/cancel",
    tag = "Jobs",
    params(("id" = u64, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Job cancelled")
    )
)]
pub async fn cancel_job(State(qm): State<AppState>, Path(id): Path<u64>) -> Json<ApiResponse<()>> {
    match qm.cancel(id).await {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

/// Update job progress.
#[utoipa::path(
    post,
    path = "/jobs/{id}/progress",
    tag = "Jobs",
    params(("id" = u64, Path, description = "Job ID")),
    request_body = ProgressRequest,
    responses(
        (status = 200, description = "Progress updated")
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
#[utoipa::path(
    get,
    path = "/jobs/{id}/progress",
    tag = "Jobs",
    params(("id" = u64, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Job progress", body = (u8, Option<String>))
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
#[utoipa::path(
    get,
    path = "/jobs/{id}/result",
    tag = "Jobs",
    params(("id" = u64, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Job result")
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
#[utoipa::path(
    post,
    path = "/jobs/{id}/priority",
    tag = "Jobs",
    params(("id" = u64, Path, description = "Job ID")),
    request_body = ChangePriorityRequest,
    responses(
        (status = 200, description = "Priority changed")
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
#[utoipa::path(
    post,
    path = "/jobs/{id}/move-to-delayed",
    tag = "Jobs",
    params(("id" = u64, Path, description = "Job ID")),
    request_body = MoveToDelayedRequest,
    responses(
        (status = 200, description = "Job moved to delayed")
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
#[utoipa::path(
    post,
    path = "/jobs/{id}/promote",
    tag = "Jobs",
    params(("id" = u64, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Job promoted to waiting")
    )
)]
pub async fn promote_job(State(qm): State<AppState>, Path(id): Path<u64>) -> Json<ApiResponse<()>> {
    match qm.promote(id).await {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

/// Discard job to DLQ.
#[utoipa::path(
    post,
    path = "/jobs/{id}/discard",
    tag = "Jobs",
    params(("id" = u64, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Job discarded to DLQ")
    )
)]
pub async fn discard_job(State(qm): State<AppState>, Path(id): Path<u64>) -> Json<ApiResponse<()>> {
    match qm.discard(id).await {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}
