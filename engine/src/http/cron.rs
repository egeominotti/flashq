//! Cron job HTTP handlers.

use axum::{
    extract::{Path, State},
    response::Json,
};

use crate::protocol::CronJob;

use super::types::{ApiResponse, AppState, CronRequest};

/// List all cron jobs.
///
/// Returns all scheduled recurring jobs across all queues with their schedules,
/// next run times, and last execution status.
#[utoipa::path(
    get,
    path = "/crons",
    tag = "Cron",
    summary = "List all scheduled cron jobs",
    description = "Returns all registered cron jobs. Each includes: name, target queue, cron schedule expression, priority, next run timestamp, and last run result. Cron jobs automatically push jobs to queues on schedule. Use for monitoring scheduled tasks.",
    responses(
        (status = 200, description = "All registered cron jobs with schedule info", body = Vec<CronJob>)
    )
)]
pub async fn list_crons(State(qm): State<AppState>) -> Json<ApiResponse<Vec<CronJob>>> {
    let crons = qm.list_crons().await;
    ApiResponse::success(crons)
}

/// Create a cron job.
///
/// Schedules a recurring job using cron expression syntax. Jobs are automatically
/// pushed to the target queue at scheduled times with the configured data and priority.
#[utoipa::path(
    post,
    path = "/crons/{name}",
    tag = "Cron",
    summary = "Create scheduled recurring job",
    description = "Creates a cron job that auto-pushes to a queue on schedule. Supports 6-field cron expressions: 'sec min hour day month weekday' (e.g., '0 */5 * * * *' = every 5 minutes). Data payload and priority are applied to each generated job. Name must be unique. Updates existing cron if name exists.",
    params(("name" = String, Path, description = "Unique cron job identifier")),
    request_body = CronRequest,
    responses(
        (status = 200, description = "Cron job created/updated and scheduled")
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
///
/// Stops and removes a scheduled cron job. Already-created jobs remain in their queues.
/// No new jobs will be created for this schedule.
#[utoipa::path(
    delete,
    path = "/crons/{name}",
    tag = "Cron",
    summary = "Delete scheduled cron job",
    description = "Removes a cron job by name. Stops future job creation. Jobs already pushed to queues continue normally. Returns true if found and deleted, false if name not found.",
    params(("name" = String, Path, description = "Cron job name to delete")),
    responses(
        (status = 200, description = "True if deleted, false if not found", body = bool)
    )
)]
pub async fn delete_cron(
    State(qm): State<AppState>,
    Path(name): Path<String>,
) -> Json<ApiResponse<bool>> {
    let deleted = qm.delete_cron(&name).await;
    ApiResponse::success(deleted)
}
