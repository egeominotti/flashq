//! Health check HTTP handlers (single-node mode).

use axum::{extract::State, response::Json};
use serde::Serialize;

use super::settings::get_start_time;
use super::types::{ApiResponse, AppState};

/// Health check response.
#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub uptime_ms: u64,
    pub sqlite_enabled: bool,
}

/// Health check endpoint.
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
