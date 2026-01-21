//! SQLite configuration handlers.
//!
//! Includes: SQLite settings, stats, async writer config,
//! export/download/restore operations.

use axum::{extract::State, response::Json};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::io::Write;

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
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SqliteConfigRequest {
    pub enabled: bool,
    pub path: Option<String>,
    pub synchronous: Option<bool>,
    pub cache_size_mb: Option<i32>,
}

/// SQLite storage statistics.
#[derive(Serialize)]
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
#[derive(Deserialize)]
pub struct AsyncWriterConfigRequest {
    pub batch_interval_ms: Option<u64>,
    pub max_batch_size: Option<usize>,
}

// ============================================================================
// Settings Handlers
// ============================================================================

/// Save SQLite settings (writes to .env file, requires restart).
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
