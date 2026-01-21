//! Server control handlers.
//!
//! Includes: settings, shutdown, restart, reset, clear operations,
//! auth settings, queue defaults, and cleanup settings.

use axum::{extract::State, response::Json};
use serde::Deserialize;

use crate::http::types::{ApiResponse, AppState};
use crate::queue::sqlite::get_runtime_s3_config;

use super::{
    get_pending_sqlite_config, get_uptime_seconds, parse_env, parse_env_bool, S3BackupSettings,
    ServerSettings, SqliteSettings,
};

// ============================================================================
// Server Settings
// ============================================================================

/// Get server settings.
pub async fn get_settings(State(qm): State<AppState>) -> Json<ApiResponse<ServerSettings>> {
    let uptime = get_uptime_seconds();

    // Check for pending SQLite config
    let pending_sqlite = get_pending_sqlite_config();
    tracing::info!("get_settings: pending_sqlite = {:?}", pending_sqlite);

    // Check runtime S3 config
    let runtime_s3 = get_runtime_s3_config();
    tracing::info!("get_settings: runtime_s3 = {:?}", runtime_s3.is_some());

    let sqlite_enabled = pending_sqlite
        .as_ref()
        .map(|c| c.enabled)
        .unwrap_or_else(|| qm.has_storage());
    tracing::info!(
        "get_settings: sqlite_enabled = {} (from pending: {})",
        sqlite_enabled,
        pending_sqlite.is_some()
    );

    let sqlite = SqliteSettings {
        enabled: sqlite_enabled,
        path: pending_sqlite
            .as_ref()
            .and_then(|c| c.path.clone())
            .or_else(|| {
                std::env::var("DATA_PATH")
                    .or_else(|_| std::env::var("SQLITE_PATH"))
                    .ok()
            }),
        synchronous: pending_sqlite
            .as_ref()
            .and_then(|c| c.synchronous)
            .unwrap_or_else(|| {
                std::env::var("SQLITE_SYNCHRONOUS")
                    .map(|v| v == "1" || v.to_lowercase() == "true")
                    .unwrap_or(true)
            }),
        snapshot_interval: parse_env!("SNAPSHOT_INTERVAL", 60),
        snapshot_min_changes: parse_env!("SNAPSHOT_MIN_CHANGES", 100),
    };

    // Check runtime S3 config first, then fall back to env vars
    let s3_backup = if let Some(config) = get_runtime_s3_config() {
        S3BackupSettings {
            enabled: true,
            endpoint: Some(config.endpoint),
            bucket: Some(config.bucket),
            region: Some(config.region),
            interval_secs: config.interval_secs,
            keep_count: config.keep_count,
            compress: config.compress,
        }
    } else {
        S3BackupSettings {
            enabled: parse_env_bool!("S3_BACKUP_ENABLED", false),
            endpoint: std::env::var("S3_ENDPOINT").ok(),
            bucket: std::env::var("S3_BUCKET").ok(),
            region: std::env::var("S3_REGION").ok(),
            interval_secs: parse_env!("S3_BACKUP_INTERVAL_SECS", 300),
            keep_count: parse_env!("S3_BACKUP_KEEP_COUNT", 24),
            compress: parse_env_bool!("S3_BACKUP_COMPRESS", true),
        }
    };

    let settings = ServerSettings {
        version: env!("CARGO_PKG_VERSION"),
        tcp_port: parse_env!("PORT", 6789),
        http_port: parse_env!("HTTP_PORT", 6790),
        sqlite,
        s3_backup,
        auth_enabled: !qm.verify_token(""),
        auth_token_count: qm.auth_token_count(),
        uptime_seconds: uptime,
    };
    ApiResponse::success(settings)
}

// ============================================================================
// Server Control
// ============================================================================

/// Shutdown server.
pub async fn shutdown_server() -> Json<ApiResponse<&'static str>> {
    tokio::spawn(async {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        std::process::exit(0);
    });
    ApiResponse::success("Server shutting down...")
}

/// Restart server.
pub async fn restart_server() -> Json<ApiResponse<&'static str>> {
    tokio::spawn(async {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        std::process::exit(100);
    });
    ApiResponse::success("Server restarting...")
}

/// Reset server memory.
pub async fn reset_server(State(qm): State<AppState>) -> Json<ApiResponse<&'static str>> {
    qm.reset().await;
    ApiResponse::success("Server memory cleared")
}

// ============================================================================
// Clear Operations
// ============================================================================

/// Clear all queues.
pub async fn clear_all_queues(State(qm): State<AppState>) -> Json<ApiResponse<u64>> {
    let count = qm.clear_all_queues().await;
    ApiResponse::success(count)
}

/// Clear all DLQ.
pub async fn clear_all_dlq(State(qm): State<AppState>) -> Json<ApiResponse<u64>> {
    let count = qm.clear_all_dlq().await;
    ApiResponse::success(count)
}

/// Clear completed jobs.
pub async fn clear_completed_jobs(State(qm): State<AppState>) -> Json<ApiResponse<u64>> {
    let count = qm.clear_completed_jobs().await;
    ApiResponse::success(count)
}

/// Reset metrics.
pub async fn reset_metrics(State(qm): State<AppState>) -> Json<ApiResponse<&'static str>> {
    qm.reset_metrics().await;
    ApiResponse::success("Metrics reset")
}

// ============================================================================
// Auth Settings
// ============================================================================

/// Save auth settings request.
#[derive(Deserialize)]
pub struct SaveAuthRequest {
    pub tokens: String,
}

/// Save auth settings.
pub async fn save_auth_settings(
    State(qm): State<AppState>,
    Json(req): Json<SaveAuthRequest>,
) -> Json<ApiResponse<&'static str>> {
    let tokens: Vec<String> = req
        .tokens
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    qm.set_auth_tokens(tokens);
    ApiResponse::success("Auth tokens updated")
}

// ============================================================================
// Queue Defaults
// ============================================================================

/// Queue defaults request.
#[derive(Deserialize)]
pub struct QueueDefaultsRequest {
    pub default_timeout: Option<u64>,
    pub default_max_attempts: Option<u32>,
    pub default_backoff: Option<u64>,
    pub default_ttl: Option<u64>,
}

/// Save queue defaults.
pub async fn save_queue_defaults(
    State(qm): State<AppState>,
    Json(req): Json<QueueDefaultsRequest>,
) -> Json<ApiResponse<&'static str>> {
    qm.set_queue_defaults(
        req.default_timeout,
        req.default_max_attempts,
        req.default_backoff,
        req.default_ttl,
    );
    ApiResponse::success("Queue defaults updated")
}

// ============================================================================
// Cleanup Settings
// ============================================================================

/// Cleanup settings request.
#[derive(Deserialize)]
pub struct CleanupSettingsRequest {
    pub max_completed_jobs: Option<usize>,
    pub max_job_results: Option<usize>,
    pub cleanup_interval_secs: Option<u64>,
    pub metrics_history_size: Option<usize>,
}

/// Save cleanup settings.
pub async fn save_cleanup_settings(
    State(qm): State<AppState>,
    Json(req): Json<CleanupSettingsRequest>,
) -> Json<ApiResponse<&'static str>> {
    qm.set_cleanup_settings(
        req.max_completed_jobs,
        req.max_job_results,
        req.cleanup_interval_secs,
        req.metrics_history_size,
    );
    ApiResponse::success("Cleanup settings updated")
}

/// Run cleanup now.
pub async fn run_cleanup_now(State(qm): State<AppState>) -> Json<ApiResponse<&'static str>> {
    qm.run_cleanup();
    ApiResponse::success("Cleanup triggered")
}
