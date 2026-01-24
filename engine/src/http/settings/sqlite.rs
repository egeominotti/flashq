//! SQLite configuration handlers.
//!
//! Includes: SQLite settings, stats, async writer config,
//! export/download/restore operations.

use axum::{extract::State, response::Json};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::io::Write;
use utoipa::ToSchema;

use crate::http::types::{ApiResponse, AppState};

use super::{get_db_path, parse_env, SqliteSettings};

// ============================================================================
// Pending Config Storage
// ============================================================================

/// Runtime SQLite configuration (pending, requires restart).
static PENDING_SQLITE_CONFIG: RwLock<Option<SqliteConfigRequest>> = RwLock::new(None);

/// Get pending SQLite configuration (if any).
pub fn get_pending_sqlite_config() -> Option<SqliteConfigRequest> {
    PENDING_SQLITE_CONFIG.read().clone()
}

// ============================================================================
// Types
// ============================================================================

/// SQLite settings request.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct SqliteConfigRequest {
    pub enabled: bool,
    pub path: Option<String>,
    pub synchronous: Option<bool>,
    pub cache_size_mb: Option<i32>,
}

/// SQLite storage statistics.
#[derive(Serialize, ToSchema)]
pub struct SqliteStats {
    pub enabled: bool,
    pub path: Option<String>,
    pub file_size_bytes: u64,
    pub file_size_mb: f64,
    pub total_jobs: u64,
    pub queued_jobs: u64,
    pub processing_jobs: u64,
    pub completed_jobs: u64,
    pub failed_jobs: u64,
    pub delayed_jobs: u64,
    // Async writer stats
    pub async_writer_enabled: bool,
    pub async_writer_queue_len: usize,
    pub async_writer_ops_queued: u64,
    pub async_writer_ops_written: u64,
    pub async_writer_batches_written: u64,
    pub async_writer_batch_interval_ms: u64,
    pub async_writer_max_batch_size: usize,
}

/// Async writer configuration request.
#[derive(Deserialize, ToSchema)]
pub struct AsyncWriterConfigRequest {
    pub batch_interval_ms: Option<u64>,
    pub max_batch_size: Option<usize>,
}

// ============================================================================
// Settings Handlers
// ============================================================================

/// Save SQLite settings (writes to .env file, requires restart).
///
/// Configures SQLite persistence. Changes are saved to .env.flashq file
/// and require server restart to take effect.
#[utoipa::path(
    post,
    path = "/sqlite/settings",
    tag = "SQLite",
    summary = "Configure SQLite persistence",
    description = "Saves SQLite configuration: enabled (toggle persistence), path (database file location), synchronous (FULL for durability, OFF for speed), cache_size_mb (in-memory cache). Writes to .env.flashq file. Requires restart to apply. Use for: enabling persistence or tuning performance.",
    request_body = SqliteConfigRequest,
    responses(
        (status = 200, description = "Configuration saved, restart required")
    )
)]
pub async fn save_sqlite_settings(
    Json(req): Json<SqliteConfigRequest>,
) -> Json<ApiResponse<&'static str>> {
    tracing::info!("save_sqlite_settings: received request = {:?}", req);

    // Store pending config
    {
        let mut guard = PENDING_SQLITE_CONFIG.write();
        *guard = Some(req.clone());
        tracing::info!("save_sqlite_settings: stored in PENDING_SQLITE_CONFIG");
    }

    // Verify it was stored
    {
        let verify = PENDING_SQLITE_CONFIG.read();
        tracing::info!(
            "save_sqlite_settings: verification read = {:?}",
            verify.as_ref()
        )
    }

    // Try to write to .env file for persistence across restarts
    let env_content = if req.enabled {
        let path = req.path.unwrap_or_else(|| "flashq.db".to_string());
        let sync = if req.synchronous.unwrap_or(true) {
            "1"
        } else {
            "0"
        };
        let cache = req.cache_size_mb.unwrap_or(64);
        format!(
            "# flashQ SQLite Configuration\nDATA_PATH={}\nSQLITE_SYNCHRONOUS={}\nSQLITE_CACHE_SIZE=-{}\n",
            path, sync, cache * 1000
        )
    } else {
        "# flashQ SQLite Configuration\n# DATA_PATH is not set - running in memory mode\n"
            .to_string()
    };

    // Write to .env.flashq file
    let env_path = std::path::Path::new(".env.flashq");
    match std::fs::File::create(env_path) {
        Ok(mut file) => {
            if let Err(e) = file.write_all(env_content.as_bytes()) {
                return ApiResponse::error_string(format!("Failed to write config: {}", e));
            }
        }
        Err(e) => {
            return ApiResponse::error_string(format!("Failed to create config file: {}", e));
        }
    }

    ApiResponse::success("SQLite configuration saved. Restart server to apply changes.")
}

/// Get current SQLite configuration status.
///
/// Returns active SQLite configuration including path, sync mode,
/// and snapshot settings. Also indicates if pending config exists.
#[utoipa::path(
    get,
    path = "/sqlite/settings",
    tag = "SQLite",
    summary = "Get SQLite configuration",
    description = "Returns current SQLite config: enabled status, database path, synchronous mode (affects durability vs speed), snapshot interval (seconds between checkpoints), snapshot_min_changes (minimum changes before snapshot). If pending config exists (from save), indicates restart is needed.",
    responses(
        (status = 200, description = "Current SQLite configuration", body = SqliteSettings)
    )
)]
pub async fn get_sqlite_settings(State(qm): State<AppState>) -> Json<ApiResponse<SqliteSettings>> {
    let pending = get_pending_sqlite_config();

    let settings = SqliteSettings {
        enabled: qm.has_storage(),
        path: std::env::var("DATA_PATH")
            .or_else(|_| std::env::var("SQLITE_PATH"))
            .ok(),
        synchronous: std::env::var("SQLITE_SYNCHRONOUS")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(true),
        snapshot_interval: parse_env!("SNAPSHOT_INTERVAL", 60),
        snapshot_min_changes: parse_env!("SNAPSHOT_MIN_CHANGES", 100),
    };

    // If there's a pending config, indicate restart is needed
    if pending.is_some() {
        tracing::info!("Pending SQLite configuration exists - restart required to apply");
    }

    ApiResponse::success(settings)
}

// ============================================================================
// Stats Handlers
// ============================================================================

/// Get SQLite storage statistics.
///
/// Returns storage metrics: file size, job counts by state, and async writer
/// statistics for performance monitoring.
#[utoipa::path(
    get,
    path = "/sqlite/stats",
    tag = "SQLite",
    summary = "Get SQLite storage statistics",
    description = "Returns: database file size (bytes/MB), job counts by state (queued, processing, completed, failed, delayed), async writer stats (queue length, ops queued/written, batch count, interval, batch size). Use for monitoring storage growth and write performance.",
    responses(
        (status = 200, description = "Storage stats and async writer metrics", body = SqliteStats)
    )
)]
pub async fn get_sqlite_stats(State(qm): State<AppState>) -> Json<ApiResponse<SqliteStats>> {
    let enabled = qm.has_storage();
    let path = std::env::var("DATA_PATH")
        .or_else(|_| std::env::var("SQLITE_PATH"))
        .ok();

    // Get file size if path exists
    let (file_size_bytes, file_size_mb) = if let Some(ref p) = path {
        match std::fs::metadata(p) {
            Ok(meta) => {
                let bytes = meta.len();
                (bytes, bytes as f64 / 1024.0 / 1024.0)
            }
            Err(_) => (0, 0.0),
        }
    } else {
        (0, 0.0)
    };

    // Get job counts from queue manager
    // stats() returns (queued, processing, delayed, dlq, completed)
    let (queued, processing, delayed, dlq, completed) = qm.stats().await;

    // Get async writer stats if enabled
    let (
        async_writer_enabled,
        queue_len,
        ops_queued,
        ops_written,
        batches_written,
        batch_interval_ms,
        max_batch_size,
    ) = if let Some((q_len, ops_q, ops_w, batches, interval, batch_sz)) =
        qm.get_async_writer_stats()
    {
        (true, q_len, ops_q, ops_w, batches, interval, batch_sz)
    } else {
        (false, 0, 0, 0, 0, 50, 1000)
    };

    let sqlite_stats = SqliteStats {
        enabled,
        path,
        file_size_bytes,
        file_size_mb,
        total_jobs: (queued + processing + delayed + dlq + completed) as u64,
        queued_jobs: queued as u64,
        processing_jobs: processing as u64,
        completed_jobs: completed as u64,
        failed_jobs: dlq as u64,
        delayed_jobs: delayed as u64,
        async_writer_enabled,
        async_writer_queue_len: queue_len,
        async_writer_ops_queued: ops_queued,
        async_writer_ops_written: ops_written,
        async_writer_batches_written: batches_written,
        async_writer_batch_interval_ms: batch_interval_ms,
        async_writer_max_batch_size: max_batch_size,
    };

    ApiResponse::success(sqlite_stats)
}

// ============================================================================
// Async Writer Config
// ============================================================================

/// Update async writer configuration at runtime.
///
/// Tunes async writer performance. Changes apply immediately without restart.
/// Balance between write latency and throughput.
#[utoipa::path(
    post,
    path = "/sqlite/async-writer",
    tag = "SQLite",
    summary = "Tune async writer performance",
    description = "Adjusts async writer: batch_interval_ms (10-5000, time between batch writes), max_batch_size (10-10000, ops per batch). Lower interval = lower latency, higher CPU. Larger batches = higher throughput, more memory. Changes apply immediately. Requires SQLite + async writer enabled.",
    request_body = AsyncWriterConfigRequest,
    responses(
        (status = 200, description = "Async writer config updated immediately")
    )
)]
pub async fn update_async_writer_config(
    State(qm): State<AppState>,
    Json(req): Json<AsyncWriterConfigRequest>,
) -> Json<ApiResponse<&'static str>> {
    // Validate inputs
    if let Some(interval) = req.batch_interval_ms {
        if interval < 10 {
            return ApiResponse::error("Batch interval must be at least 10ms");
        }
        if interval > 5000 {
            return ApiResponse::error("Batch interval must be at most 5000ms");
        }
    }
    if let Some(size) = req.max_batch_size {
        if size < 10 {
            return ApiResponse::error("Batch size must be at least 10");
        }
        if size > 10000 {
            return ApiResponse::error("Batch size must be at most 10000");
        }
    }

    if qm.update_async_writer_config(req.batch_interval_ms, req.max_batch_size) {
        ApiResponse::success("Async writer configuration updated")
    } else {
        ApiResponse::error("Async writer not enabled")
    }
}

// ============================================================================
// Export/Download/Restore
// ============================================================================

/// Export SQLite database - returns download URL info.
///
/// Returns the database file path for export. Use /sqlite/download
/// for actual file download.
#[utoipa::path(
    get,
    path = "/sqlite/export",
    tag = "SQLite",
    summary = "Get database path for export",
    description = "Returns the SQLite database file path. For downloading the actual file, use /sqlite/download endpoint instead. This endpoint is useful for scripted backup workflows where you need the path. Requires SQLite to be configured (DATA_PATH set).",
    responses(
        (status = 200, description = "Database file path", body = String)
    )
)]
pub async fn export_sqlite_database() -> Json<ApiResponse<String>> {
    let path = match get_db_path() {
        Some(p) => p,
        None => return ApiResponse::error("SQLite not configured"),
    };

    // Check if file exists
    if !std::path::Path::new(&path).exists() {
        return ApiResponse::error("Database file not found");
    }

    // Return the path - client will handle download
    ApiResponse::success(path)
}

/// Download SQLite database file directly.
///
/// Returns the raw SQLite database file as a binary download.
/// Useful for backup purposes or migrating data to another server.
#[utoipa::path(
    get,
    path = "/sqlite/download",
    tag = "SQLite",
    summary = "Download database file",
    description = "Downloads the SQLite database as binary file. Content-Type is application/octet-stream. Use for: manual backups, data migration, offline analysis. File may be large depending on data volume. Consider S3 backup for automated backups. Requires SQLite to be configured.",
    responses(
        (status = 200, description = "SQLite database binary file", content_type = "application/octet-stream"),
        (status = 400, description = "SQLite not configured (DATA_PATH not set)"),
        (status = 500, description = "Failed to read database file")
    )
)]
pub async fn download_sqlite_database() -> impl axum::response::IntoResponse {
    use axum::http::{header, StatusCode};

    let path = match get_db_path() {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                [(header::CONTENT_TYPE, "application/json")],
                vec![],
            );
        }
    };

    match std::fs::read(&path) {
        Ok(data) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/octet-stream")],
            data,
        ),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(header::CONTENT_TYPE, "application/json")],
            vec![],
        ),
    }
}

/// Restore SQLite database from uploaded file.
///
/// Replaces current database with uploaded file. Current database is backed up
/// before replacement. Requires server restart to load restored data.
#[utoipa::path(
    post,
    path = "/sqlite/restore",
    tag = "SQLite",
    summary = "Upload and restore database",
    description = "Uploads a SQLite database file to replace current data. Validates SQLite magic header, backs up current database as .bak, then writes uploaded file. Restart required to load new data. On failure, original database is restored from backup. Multipart form with 'file' field.",
    request_body(content = inline(String), content_type = "multipart/form-data"),
    responses(
        (status = 200, description = "Database restored, restart required to apply")
    )
)]
pub async fn restore_sqlite_database(
    mut multipart: axum::extract::Multipart,
) -> Json<ApiResponse<&'static str>> {
    let path = match get_db_path() {
        Some(p) => p,
        None => return ApiResponse::error("SQLite not configured"),
    };

    // Find the file field
    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().map(String::from);
        if name.as_deref() == Some("file") {
            match field.bytes().await {
                Ok(data) => {
                    // Verify it looks like a SQLite file (magic header)
                    if data.len() < 16 || &data[0..16] != b"SQLite format 3\0" {
                        return ApiResponse::error("Invalid SQLite database file");
                    }

                    // Backup current database
                    let backup_path = format!("{}.bak", path);
                    if std::path::Path::new(&path).exists() {
                        if let Err(e) = std::fs::copy(&path, &backup_path) {
                            return ApiResponse::error_string(format!(
                                "Failed to backup current database: {}",
                                e
                            ));
                        }
                    }

                    // Write new database
                    match std::fs::write(&path, &data) {
                        Ok(()) => {
                            // Remove backup on success
                            let _ = std::fs::remove_file(&backup_path);
                            return ApiResponse::success(
                                "Database restored successfully. Restart server to apply.",
                            );
                        }
                        Err(e) => {
                            // Restore backup on failure
                            let _ = std::fs::rename(&backup_path, &path);
                            return ApiResponse::error_string(format!(
                                "Failed to write database: {}",
                                e
                            ));
                        }
                    }
                }
                Err(e) => {
                    return ApiResponse::error_string(format!("Failed to read upload: {}", e))
                }
            }
        }
    }

    ApiResponse::error("No file uploaded")
}
