//! Health check HTTP handlers (single-node mode).

use axum::{extract::State, response::Json};
use serde::Serialize;
use utoipa::ToSchema;

use super::settings::get_start_time;
use super::types::{ApiResponse, AppState};

/// Health check response.
#[derive(Serialize, ToSchema)]
pub struct HealthResponse {
    pub status: &'static str,
    pub uptime_ms: u64,
    pub sqlite_enabled: bool,
}

/// Health check endpoint.
///
/// Returns server health status, uptime, and configuration. Use for load balancer
/// health checks and monitoring. Always returns 200 if server is running.
#[utoipa::path(
    get,
    path = "/health",
    tag = "Health",
    summary = "Server health check",
    description = "Returns: status ('healthy'), uptime in milliseconds, SQLite persistence enabled flag. Always returns 200 if HTTP server is responsive. Use for: Kubernetes probes, load balancer health checks, uptime monitoring. Lightweight endpoint with no heavy computation.",
    responses(
        (status = 200, description = "Health status with uptime and config", body = HealthResponse)
    )
)]
pub async fn health_check(State(qm): State<AppState>) -> Json<ApiResponse<HealthResponse>> {
    let uptime = get_start_time()
        .map(|t| t.elapsed().as_millis() as u64)
        .unwrap_or(0);

    let health = HealthResponse {
        status: "healthy",
        uptime_ms: uptime,
        sqlite_enabled: qm.has_storage(),
    };
    ApiResponse::success(health)
}
