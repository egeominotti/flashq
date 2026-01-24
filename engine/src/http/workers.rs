//! Worker HTTP handlers.

use axum::{
    extract::{Path, State},
    response::Json,
};

use crate::protocol::WorkerInfo;

use super::types::{ApiResponse, AppState, WorkerHeartbeatRequest};

/// List all active workers.
///
/// Returns all workers that have sent heartbeats recently. Includes worker
/// metadata, assigned queues, concurrency, and jobs processed count.
#[utoipa::path(
    get,
    path = "/workers",
    tag = "Workers",
    summary = "List active workers",
    description = "Returns workers with recent heartbeats (within timeout window). Each includes: worker ID, assigned queues, concurrency setting, total jobs processed, last heartbeat time. Workers auto-expire if heartbeat stops. Use for monitoring worker fleet health.",
    responses(
        (status = 200, description = "Active workers with status and stats", body = Vec<WorkerInfo>)
    )
)]
pub async fn list_workers(State(qm): State<AppState>) -> Json<ApiResponse<Vec<WorkerInfo>>> {
    let workers = qm.list_workers().await;
    ApiResponse::success(workers)
}

/// Update worker heartbeat.
///
/// Reports worker liveness and updates stats. Workers should call this periodically
/// to remain in the active worker list. Includes current queues and job count.
#[utoipa::path(
    post,
    path = "/workers/{id}/heartbeat",
    tag = "Workers",
    summary = "Send worker heartbeat",
    description = "Updates worker status and resets expiry timer. Call every 10-30 seconds to stay active. Include: queues being processed, concurrency limit, jobs processed since last heartbeat. Workers not sending heartbeats are removed from active list after timeout.",
    params(("id" = String, Path, description = "Unique worker identifier")),
    request_body = WorkerHeartbeatRequest,
    responses(
        (status = 200, description = "Heartbeat recorded, worker marked active")
    )
)]
pub async fn worker_heartbeat(
    State(qm): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<WorkerHeartbeatRequest>,
) -> Json<ApiResponse<()>> {
    qm.worker_heartbeat(id, req.queues, req.concurrency, req.jobs_processed)
        .await;
    ApiResponse::success(())
}
