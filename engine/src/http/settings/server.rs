//! Server control handlers.
//!
//! Includes: settings, shutdown, restart, reset, clear operations,
//! auth settings, queue defaults, and cleanup settings.

use axum::{extract::State, response::Json};
use serde::Deserialize;
use utoipa::ToSchema;

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
///
/// Returns complete server configuration including ports, SQLite settings,
/// S3 backup config, authentication status, and uptime.
#[utoipa::path(
    get,
    path = "/settings",
    tag = "Settings",
    summary = "Get server configuration",
    description = "Returns full server configuration: version, TCP/HTTP/gRPC ports, SQLite settings (path, sync mode, snapshot config), S3 backup settings (endpoint, bucket, interval), auth status (enabled, token count), and uptime. Use for configuration display and diagnostics.",
    responses(
        (status = 200, description = "Complete server configuration", body = ServerSettings)
    )
)]
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
///
/// Initiates graceful server shutdown. Active jobs complete first,
/// then connections close and process exits.
#[utoipa::path(
    post,
    path = "/server/shutdown",
    tag = "Settings",
    summary = "Gracefully shutdown server",
    description = "Initiates graceful shutdown: stops accepting new connections, waits for active jobs to complete (up to 30s timeout), persists data to SQLite if enabled, then exits process. Response returns before shutdown completes.",
    responses(
        (status = 200, description = "Shutdown initiated")
    )
)]
pub async fn shutdown_server() -> Json<ApiResponse<&'static str>> {
    tokio::spawn(async {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        std::process::exit(0);
    });
    ApiResponse::success("Server shutting down...")
}

/// Restart server.
///
/// Triggers server restart. Process exits with code 100 which orchestration
/// tools (systemd, Docker) should interpret as restart request.
#[utoipa::path(
    post,
    path = "/server/restart",
    tag = "Settings",
    summary = "Restart server process",
    description = "Exits with code 100, signaling container/process manager to restart. Use for: applying config changes, recovering from memory issues, or scheduled restarts. Ensure restart policy is configured in Docker/systemd. Data is persisted before exit if SQLite enabled.",
    responses(
        (status = 200, description = "Restart initiated")
    )
)]
pub async fn restart_server() -> Json<ApiResponse<&'static str>> {
    tokio::spawn(async {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        std::process::exit(100);
    });
    ApiResponse::success("Server restarting...")
}

/// Reset server memory.
///
/// Clears all in-memory state: queues, jobs, metrics, workers. Does NOT clear
/// SQLite data (use clear-queues for that). Useful for testing.
#[utoipa::path(
    post,
    path = "/server/reset",
    tag = "Settings",
    summary = "Clear all in-memory state",
    description = "Resets server to initial state: clears all queues, jobs, DLQ, workers, metrics history, and configuration. SQLite data remains intact (re-loaded on restart). Use for: testing, development, or emergency recovery. WARNING: All pending jobs are lost.",
    responses(
        (status = 200, description = "In-memory state cleared")
    )
)]
pub async fn reset_server(State(qm): State<AppState>) -> Json<ApiResponse<&'static str>> {
    qm.reset().await;
    ApiResponse::success("Server memory cleared")
}

// ============================================================================
// Clear Operations
// ============================================================================

/// Clear all queues.
///
/// Removes all jobs from all queues (waiting, delayed, processing). DLQ and
/// completed jobs are preserved. Also clears SQLite if persistence enabled.
#[utoipa::path(
    post,
    path = "/server/clear-queues",
    tag = "Settings",
    summary = "Clear all jobs from all queues",
    description = "Removes all jobs in waiting, delayed, and processing states from all queues. Also removes from SQLite storage if enabled. DLQ is preserved (use clear-dlq separately). Returns total jobs removed. Use for: emergency cleanup or testing.",
    responses(
        (status = 200, description = "Total jobs removed from all queues", body = u64)
    )
)]
pub async fn clear_all_queues(State(qm): State<AppState>) -> Json<ApiResponse<u64>> {
    let count = qm.clear_all_queues().await;
    ApiResponse::success(count)
}

/// Clear all DLQ.
///
/// Removes all jobs from Dead Letter Queues across all queues. Jobs are
/// permanently deleted and cannot be recovered.
#[utoipa::path(
    post,
    path = "/server/clear-dlq",
    tag = "Settings",
    summary = "Clear all Dead Letter Queues",
    description = "Permanently removes all failed jobs from DLQ across all queues. Also clears from SQLite if enabled. Jobs cannot be recovered after this operation. Returns total DLQ jobs removed. Use after investigating and resolving failure causes.",
    responses(
        (status = 200, description = "Total DLQ jobs removed", body = u64)
    )
)]
pub async fn clear_all_dlq(State(qm): State<AppState>) -> Json<ApiResponse<u64>> {
    let count = qm.clear_all_dlq().await;
    ApiResponse::success(count)
}

/// Clear completed jobs.
///
/// Removes all completed job records and their results from memory and storage.
/// Frees memory but loses completion history and results.
#[utoipa::path(
    post,
    path = "/server/clear-completed",
    tag = "Settings",
    summary = "Clear completed jobs history",
    description = "Removes all completed job IDs and stored results. Frees memory used for tracking completion status. After clearing, getResult() returns null for previously completed jobs. Use to free resources when completion history is not needed.",
    responses(
        (status = 200, description = "Total completed job records removed", body = u64)
    )
)]
pub async fn clear_completed_jobs(State(qm): State<AppState>) -> Json<ApiResponse<u64>> {
    let count = qm.clear_completed_jobs().await;
    ApiResponse::success(count)
}

/// Reset metrics.
///
/// Clears all metrics counters and history. Total pushed/completed/failed
/// counts reset to zero. Metrics history for graphs is cleared.
#[utoipa::path(
    post,
    path = "/server/reset-metrics",
    tag = "Settings",
    summary = "Reset all metrics counters",
    description = "Resets: total_pushed, total_completed, total_failed counters to zero, clears metrics history (time series data), resets per-queue throughput calculations. Use for: starting fresh measurement period or after data migration.",
    responses(
        (status = 200, description = "All metrics reset to zero")
    )
)]
pub async fn reset_metrics(State(qm): State<AppState>) -> Json<ApiResponse<&'static str>> {
    qm.reset_metrics().await;
    ApiResponse::success("Metrics reset")
}

// ============================================================================
// Auth Settings
// ============================================================================

/// Save auth settings request.
#[derive(Deserialize, ToSchema)]
pub struct SaveAuthRequest {
    pub tokens: String,
}

/// Save auth settings.
///
/// Updates authentication tokens at runtime. Tokens are comma-separated.
/// Empty string disables authentication. Changes apply immediately.
#[utoipa::path(
    post,
    path = "/settings/auth",
    tag = "Settings",
    summary = "Update authentication tokens",
    description = "Sets the list of valid auth tokens (comma-separated). Tokens are used for: HTTP Authorization header, WebSocket ?token= parameter, TCP AUTH command. Empty string disables auth. Changes apply immediately without restart. Existing connections keep their auth state.",
    request_body = SaveAuthRequest,
    responses(
        (status = 200, description = "Auth tokens updated and active")
    )
)]
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
#[derive(Deserialize, ToSchema)]
pub struct QueueDefaultsRequest {
    pub default_timeout: Option<u64>,
    pub default_max_attempts: Option<u32>,
    pub default_backoff: Option<u64>,
    pub default_ttl: Option<u64>,
}

/// Save queue defaults.
///
/// Sets default values for new jobs that don't specify these options.
/// Affects timeout, max_attempts, backoff, and TTL.
#[utoipa::path(
    post,
    path = "/settings/queue-defaults",
    tag = "Settings",
    summary = "Set default job options",
    description = "Configures defaults for jobs without explicit options: timeout (ms before job considered stalled), max_attempts (retry count before DLQ), backoff (base delay for exponential retry), ttl (auto-expire time). Applies to new jobs only; existing jobs unchanged.",
    request_body = QueueDefaultsRequest,
    responses(
        (status = 200, description = "Queue defaults applied to new jobs")
    )
)]
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
#[derive(Deserialize, ToSchema)]
pub struct CleanupSettingsRequest {
    pub max_completed_jobs: Option<usize>,
    pub max_job_results: Option<usize>,
    pub cleanup_interval_secs: Option<u64>,
    pub metrics_history_size: Option<usize>,
}

/// Save cleanup settings.
///
/// Configures automatic cleanup thresholds for memory management.
/// Controls retention of completed jobs, results, and metrics history.
#[utoipa::path(
    post,
    path = "/settings/cleanup",
    tag = "Settings",
    summary = "Configure automatic cleanup",
    description = "Sets thresholds for automatic cleanup: max_completed_jobs (cleanup when exceeded, removes oldest half), max_job_results (same behavior), cleanup_interval_secs (how often cleanup runs), metrics_history_size (max data points kept). Prevents unbounded memory growth.",
    request_body = CleanupSettingsRequest,
    responses(
        (status = 200, description = "Cleanup thresholds updated")
    )
)]
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
///
/// Triggers immediate cleanup cycle. Removes old completed jobs, results,
/// and stale index entries based on current thresholds.
#[utoipa::path(
    post,
    path = "/settings/cleanup/run",
    tag = "Settings",
    summary = "Trigger immediate cleanup",
    description = "Forces cleanup cycle now instead of waiting for interval. Cleans: completed jobs over threshold, job results over threshold, stale job index entries, expired debounce cache entries. Use for: immediate memory recovery or before metrics snapshot.",
    responses(
        (status = 200, description = "Cleanup cycle completed")
    )
)]
pub async fn run_cleanup_now(State(qm): State<AppState>) -> Json<ApiResponse<&'static str>> {
    qm.run_cleanup();
    ApiResponse::success("Cleanup triggered")
}
