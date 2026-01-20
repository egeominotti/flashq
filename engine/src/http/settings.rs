//! Server settings HTTP handlers.

use axum::{extract::State, response::Json};
use serde::{Deserialize, Serialize};

use super::types::{ApiResponse, AppState};

static START_TIME: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// Initialize start time (call once at server startup).
pub fn init_start_time() {
    START_TIME.get_or_init(std::time::Instant::now);
}

/// Get server uptime in seconds.
pub fn get_uptime_seconds() -> u64 {
    START_TIME.get().map(|t| t.elapsed().as_secs()).unwrap_or(0)
}

/// Get start time instant.
pub fn get_start_time() -> Option<&'static std::time::Instant> {
    START_TIME.get()
}

/// S3 Backup settings.
#[derive(Serialize)]
pub struct S3BackupSettings {
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub interval_secs: u64,
    pub keep_count: usize,
    pub compress: bool,
}

/// SQLite settings.
#[derive(Serialize)]
pub struct SqliteSettings {
    pub enabled: bool,
    pub path: Option<String>,
    pub synchronous: bool,
    pub snapshot_interval: u64,
    pub snapshot_min_changes: u64,
}

/// Server settings response.
#[derive(Serialize)]
pub struct ServerSettings {
    pub version: &'static str,
    pub tcp_port: u16,
    pub http_port: u16,
    pub sqlite: SqliteSettings,
    pub s3_backup: S3BackupSettings,
    pub auth_enabled: bool,
    pub auth_token_count: usize,
    pub uptime_seconds: u64,
}

/// Get server settings.
pub async fn get_settings(State(qm): State<AppState>) -> Json<ApiResponse<ServerSettings>> {
    let uptime = get_uptime_seconds();

    let sqlite = SqliteSettings {
        enabled: qm.has_storage(),
        path: std::env::var("DATA_PATH")
            .or_else(|_| std::env::var("SQLITE_PATH"))
            .ok(),
        synchronous: std::env::var("SQLITE_SYNCHRONOUS")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(true),
        snapshot_interval: std::env::var("SNAPSHOT_INTERVAL")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60),
        snapshot_min_changes: std::env::var("SNAPSHOT_MIN_CHANGES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(100),
    };

    let s3_backup = S3BackupSettings {
        enabled: std::env::var("S3_BACKUP_ENABLED")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(false),
        endpoint: std::env::var("S3_ENDPOINT").ok(),
        bucket: std::env::var("S3_BUCKET").ok(),
        region: std::env::var("S3_REGION").ok(),
        interval_secs: std::env::var("S3_BACKUP_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(300),
        keep_count: std::env::var("S3_BACKUP_KEEP_COUNT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(24),
        compress: std::env::var("S3_BACKUP_COMPRESS")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(true),
    };

    let settings = ServerSettings {
        version: env!("CARGO_PKG_VERSION"),
        tcp_port: std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(6789),
        http_port: std::env::var("HTTP_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(6790),
        sqlite,
        s3_backup,
        auth_enabled: !qm.verify_token(""),
        auth_token_count: qm.auth_token_count(),
        uptime_seconds: uptime,
    };
    ApiResponse::success(settings)
}

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

/// System metrics response.
#[derive(Serialize)]
pub struct SystemMetrics {
    pub memory_used_mb: f64,
    pub memory_total_mb: f64,
    pub memory_percent: f64,
    pub cpu_percent: f64,
    pub tcp_connections: usize,
    pub uptime_seconds: u64,
    pub process_id: u32,
}

/// Get system metrics.
pub async fn get_system_metrics(State(qm): State<AppState>) -> Json<ApiResponse<SystemMetrics>> {
    let uptime = get_uptime_seconds();
    let (memory_used, memory_total) = get_memory_info();
    let tcp_connections = qm.connection_count();

    let metrics = SystemMetrics {
        memory_used_mb: memory_used,
        memory_total_mb: memory_total,
        memory_percent: if memory_total > 0.0 {
            (memory_used / memory_total) * 100.0
        } else {
            0.0
        },
        cpu_percent: 0.0,
        tcp_connections,
        uptime_seconds: uptime,
        process_id: std::process::id(),
    };
    ApiResponse::success(metrics)
}

fn get_memory_info() -> (f64, f64) {
    #[cfg(target_os = "linux")]
    {
        if let Ok(statm) = std::fs::read_to_string("/proc/self/statm") {
            let parts: Vec<&str> = statm.split_whitespace().collect();
            if parts.len() >= 2 {
                let page_size = 4096.0;
                let resident: f64 = parts[1].parse().unwrap_or(0.0) * page_size / 1024.0 / 1024.0;
                if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") {
                    for line in meminfo.lines() {
                        if line.starts_with("MemTotal:") {
                            let total_kb: f64 = line
                                .split_whitespace()
                                .nth(1)
                                .and_then(|s| s.parse().ok())
                                .unwrap_or(0.0);
                            return (resident, total_kb / 1024.0);
                        }
                    }
                }
                return (resident, 0.0);
            }
        }
        (0.0, 0.0)
    }

    #[cfg(target_os = "macos")]
    {
        (0.0, 0.0)
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        (0.0, 0.0)
    }
}

// ============================================================================
// SQLite Configuration API
// ============================================================================

use std::io::Write;
use parking_lot::RwLock;

/// Runtime SQLite configuration (pending, requires restart)
static PENDING_SQLITE_CONFIG: RwLock<Option<SqliteConfigRequest>> = RwLock::new(None);

/// SQLite settings request.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SqliteConfigRequest {
    pub enabled: bool,
    pub path: Option<String>,
    pub synchronous: Option<bool>,
    pub cache_size_mb: Option<i32>,
}

/// Get pending SQLite configuration (if any).
pub fn get_pending_sqlite_config() -> Option<SqliteConfigRequest> {
    PENDING_SQLITE_CONFIG.read().clone()
}

/// Save SQLite settings (writes to .env file, requires restart).
pub async fn save_sqlite_settings(
    Json(req): Json<SqliteConfigRequest>,
) -> Json<ApiResponse<&'static str>> {
    // Store pending config
    {
        let mut guard = PENDING_SQLITE_CONFIG.write();
        *guard = Some(req.clone());
    }

    // Try to write to .env file for persistence across restarts
    let env_content = if req.enabled {
        let path = req.path.unwrap_or_else(|| "flashq.db".to_string());
        let sync = if req.synchronous.unwrap_or(true) { "1" } else { "0" };
        let cache = req.cache_size_mb.unwrap_or(64);
        format!(
            "# flashQ SQLite Configuration\nDATA_PATH={}\nSQLITE_SYNCHRONOUS={}\nSQLITE_CACHE_SIZE=-{}\n",
            path, sync, cache * 1000
        )
    } else {
        "# flashQ SQLite Configuration\n# DATA_PATH is not set - running in memory mode\n".to_string()
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
        snapshot_interval: std::env::var("SNAPSHOT_INTERVAL")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60),
        snapshot_min_changes: std::env::var("SNAPSHOT_MIN_CHANGES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(100),
    };

    // If there's a pending config, indicate restart is needed
    if pending.is_some() {
        tracing::info!("Pending SQLite configuration exists - restart required to apply");
    }

    ApiResponse::success(settings)
}

// ============================================================================
// S3 Backup Configuration API
// ============================================================================

use crate::queue::sqlite::{S3BackupConfig, set_runtime_s3_config, get_runtime_s3_config, clear_runtime_s3_config};

/// S3 settings request.
#[derive(Deserialize)]
pub struct SaveS3SettingsRequest {
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub access_key: Option<String>,
    pub secret_key: Option<String>,
    pub interval_secs: Option<u64>,
    pub keep_count: Option<usize>,
    pub prefix: Option<String>,
    pub compress: Option<bool>,
}

/// Save S3 settings (runtime configuration).
pub async fn save_s3_settings(
    Json(req): Json<SaveS3SettingsRequest>,
) -> Json<ApiResponse<&'static str>> {
    if !req.enabled {
        clear_runtime_s3_config();
        return ApiResponse::success("S3 backup disabled");
    }

    // Validate required fields
    let endpoint = match req.endpoint {
        Some(e) if !e.is_empty() => e,
        _ => return ApiResponse::error("S3 endpoint is required"),
    };
    let bucket = match req.bucket {
        Some(b) if !b.is_empty() => b,
        _ => return ApiResponse::error("S3 bucket is required"),
    };
    let access_key = match req.access_key {
        Some(k) if !k.is_empty() => k,
        _ => return ApiResponse::error("S3 access key is required"),
    };
    let secret_key = match req.secret_key {
        Some(s) if !s.is_empty() => s,
        _ => return ApiResponse::error("S3 secret key is required"),
    };

    let config = S3BackupConfig::new(endpoint, bucket, access_key, secret_key)
        .with_region(req.region.unwrap_or_else(|| "auto".to_string()))
        .with_interval(req.interval_secs.unwrap_or(300))
        .with_keep_count(req.keep_count.unwrap_or(24))
        .with_prefix(req.prefix.unwrap_or_else(|| "backups/".to_string()))
        .with_compress(req.compress.unwrap_or(true));

    set_runtime_s3_config(config);
    ApiResponse::success("S3 backup configuration saved")
}

/// Test S3 connection.
pub async fn test_s3_connection(
    Json(req): Json<SaveS3SettingsRequest>,
) -> Json<ApiResponse<&'static str>> {
    // Validate required fields
    let endpoint = match req.endpoint {
        Some(e) if !e.is_empty() => e,
        _ => return ApiResponse::error("S3 endpoint is required"),
    };
    let bucket = match req.bucket {
        Some(b) if !b.is_empty() => b,
        _ => return ApiResponse::error("S3 bucket is required"),
    };
    let access_key = match req.access_key {
        Some(k) if !k.is_empty() => k,
        _ => return ApiResponse::error("S3 access key is required"),
    };
    let secret_key = match req.secret_key {
        Some(s) if !s.is_empty() => s,
        _ => return ApiResponse::error("S3 secret key is required"),
    };

    let config = S3BackupConfig::new(endpoint, bucket, access_key, secret_key)
        .with_region(req.region.unwrap_or_else(|| "auto".to_string()));

    // Try to create backup manager and list objects
    match crate::queue::sqlite::S3BackupManager::new(config).await {
        Ok(manager) => {
            match manager.list_backups().await {
                Ok(_) => ApiResponse::success("Connection successful"),
                Err(e) => ApiResponse::error_string(format!("Connection failed: {}", e)),
            }
        }
        Err(e) => ApiResponse::error_string(format!("Failed to initialize S3 client: {}", e)),
    }
}

/// Get current S3 configuration (without secrets).
pub async fn get_s3_settings() -> Json<ApiResponse<S3BackupSettings>> {
    // Check runtime config first
    if let Some(config) = get_runtime_s3_config() {
        return ApiResponse::success(S3BackupSettings {
            enabled: true,
            endpoint: Some(config.endpoint),
            bucket: Some(config.bucket),
            region: Some(config.region),
            interval_secs: config.interval_secs,
            keep_count: config.keep_count,
            compress: config.compress,
        });
    }

    // Fall back to env settings
    let settings = S3BackupSettings {
        enabled: std::env::var("S3_BACKUP_ENABLED")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(false),
        endpoint: std::env::var("S3_ENDPOINT").ok(),
        bucket: std::env::var("S3_BUCKET").ok(),
        region: std::env::var("S3_REGION").ok(),
        interval_secs: std::env::var("S3_BACKUP_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(300),
        keep_count: std::env::var("S3_BACKUP_KEEP_COUNT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(24),
        compress: std::env::var("S3_BACKUP_COMPRESS")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(true),
    };
    ApiResponse::success(settings)
}

// ============================================================================
// S3 Backup Operations API
// ============================================================================

/// S3 backup info response.
#[derive(Serialize)]
pub struct S3BackupInfo {
    pub key: String,
    pub size: i64,
    pub last_modified: Option<String>,
}

/// Trigger manual S3 backup.
pub async fn trigger_s3_backup() -> Json<ApiResponse<&'static str>> {
    let config = match S3BackupConfig::from_env() {
        Some(c) => c,
        None => return ApiResponse::error("S3 backup not configured"),
    };

    let db_path = match std::env::var("DATA_PATH").or_else(|_| std::env::var("SQLITE_PATH")) {
        Ok(p) => std::path::PathBuf::from(p),
        Err(_) => return ApiResponse::error("DATA_PATH not configured"),
    };

    let backup_manager = match crate::queue::sqlite::S3BackupManager::new(config).await {
        Ok(m) => m,
        Err(e) => return ApiResponse::error_string(format!("Failed to create backup manager: {}", e)),
    };

    match backup_manager.backup(&db_path).await {
        Ok(()) => ApiResponse::success("Backup completed successfully"),
        Err(e) => ApiResponse::error_string(format!("Backup failed: {}", e)),
    }
}

/// List available S3 backups.
pub async fn list_s3_backups() -> Json<ApiResponse<Vec<S3BackupInfo>>> {
    let config = match S3BackupConfig::from_env() {
        Some(c) => c,
        None => return ApiResponse::error("S3 backup not configured"),
    };

    let backup_manager = match crate::queue::sqlite::S3BackupManager::new(config).await {
        Ok(m) => m,
        Err(e) => return ApiResponse::error_string(format!("Failed to create backup manager: {}", e)),
    };

    match backup_manager.list_backups_detailed().await {
        Ok(backups) => ApiResponse::success(backups.into_iter().map(|(key, size, modified)| {
            S3BackupInfo {
                key,
                size,
                last_modified: modified,
            }
        }).collect()),
        Err(e) => ApiResponse::error_string(format!("Failed to list backups: {}", e)),
    }
}

/// Restore request.
#[derive(Deserialize)]
pub struct RestoreRequest {
    pub key: String,
}

/// Restore from S3 backup.
pub async fn restore_s3_backup(
    Json(req): Json<RestoreRequest>,
) -> Json<ApiResponse<&'static str>> {
    let config = match S3BackupConfig::from_env() {
        Some(c) => c,
        None => return ApiResponse::error("S3 backup not configured"),
    };

    let db_path = match std::env::var("DATA_PATH").or_else(|_| std::env::var("SQLITE_PATH")) {
        Ok(p) => std::path::PathBuf::from(p),
        Err(_) => return ApiResponse::error("DATA_PATH not configured"),
    };

    let backup_manager = match crate::queue::sqlite::S3BackupManager::new(config).await {
        Ok(m) => m,
        Err(e) => return ApiResponse::error_string(format!("Failed to create backup manager: {}", e)),
    };

    // Restore to a temporary file first, then swap
    let restore_path = db_path.with_extension("restore.db");

    match backup_manager.restore(&req.key, &restore_path).await {
        Ok(()) => {
            // Rename current db to .bak, then rename restore to current
            let backup_path = db_path.with_extension("bak");
            if db_path.exists() {
                if let Err(e) = std::fs::rename(&db_path, &backup_path) {
                    let _ = std::fs::remove_file(&restore_path);
                    return ApiResponse::error_string(format!("Failed to backup current db: {}", e));
                }
            }
            if let Err(e) = std::fs::rename(&restore_path, &db_path) {
                // Try to restore the backup
                let _ = std::fs::rename(&backup_path, &db_path);
                return ApiResponse::error_string(format!("Failed to restore db: {}", e));
            }
            // Remove the backup
            let _ = std::fs::remove_file(&backup_path);
            ApiResponse::success("Restore completed. Please restart the server.")
        }
        Err(e) => {
            let _ = std::fs::remove_file(&restore_path);
            ApiResponse::error_string(format!("Restore failed: {}", e))
        }
    }
}
