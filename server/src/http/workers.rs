//! Worker HTTP handlers.

use axum::{
    extract::{Path, State},
    response::Json,
};

use crate::protocol::WorkerInfo;

use super::types::{ApiResponse, AppState, WorkerHeartbeatRequest};

/// List all active workers.
pub async fn list_workers(State(qm): State<AppState>) -> Json<ApiResponse<Vec<WorkerInfo>>> {
    let workers = qm.list_workers().await;
    ApiResponse::success(workers)
}

/// Update worker heartbeat.
pub async fn worker_heartbeat(
    State(qm): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<WorkerHeartbeatRequest>,
) -> Json<ApiResponse<()>> {
    qm.worker_heartbeat(id, req.queues, req.concurrency, req.jobs_processed)
        .await;
    ApiResponse::success(())
}
