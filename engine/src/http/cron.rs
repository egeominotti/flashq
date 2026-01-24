//! Cron job HTTP handlers.

use axum::{
    extract::{Path, State},
    response::Json,
};

use crate::protocol::CronJob;

use super::types::{ApiResponse, AppState, CronRequest};

/// List all cron jobs.
#[utoipa::path(
    get,
    path = "/crons",
    tag = "Cron",
    responses(
        (status = 200, description = "List of cron jobs", body = Vec<CronJob>)
    )
)]
pub async fn list_crons(State(qm): State<AppState>) -> Json<ApiResponse<Vec<CronJob>>> {
    let crons = qm.list_crons().await;
    ApiResponse::success(crons)
}

/// Create a cron job.
#[utoipa::path(
    post,
    path = "/crons/{name}",
    tag = "Cron",
    params(("name" = String, Path, description = "Cron job name")),
    request_body = CronRequest,
    responses(
        (status = 200, description = "Cron job created")
    )
)]
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
#[utoipa::path(
    delete,
    path = "/crons/{name}",
    tag = "Cron",
    params(("name" = String, Path, description = "Cron job name")),
    responses(
        (status = 200, description = "Cron job deleted", body = bool)
    )
)]
pub async fn delete_cron(
    State(qm): State<AppState>,
    Path(name): Path<String>,
) -> Json<ApiResponse<bool>> {
    let deleted = qm.delete_cron(&name).await;
    ApiResponse::success(deleted)
}
