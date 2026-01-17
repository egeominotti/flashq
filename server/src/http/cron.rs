//! Cron job HTTP handlers.

use axum::{
    extract::{Path, State},
    response::Json,
};

use crate::protocol::CronJob;

use super::types::{ApiResponse, AppState, CronRequest};

/// List all cron jobs.
pub async fn list_crons(State(qm): State<AppState>) -> Json<ApiResponse<Vec<CronJob>>> {
    let crons = qm.list_crons().await;
    ApiResponse::success(crons)
}

/// Create a cron job.
pub async fn create_cron(
    State(qm): State<AppState>,
    Path(name): Path<String>,
    Json(req): Json<CronRequest>,
) -> Json<ApiResponse<()>> {
    match qm
        .add_cron(name, req.queue, req.data, req.schedule, req.priority)
        .await
    {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

/// Delete a cron job.
pub async fn delete_cron(
    State(qm): State<AppState>,
    Path(name): Path<String>,
) -> Json<ApiResponse<bool>> {
    let deleted = qm.delete_cron(&name).await;
    ApiResponse::success(deleted)
}
