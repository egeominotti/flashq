//! S3 backup configuration and operations handlers.
//!
//! Includes: S3 settings, connection test, backup operations,
//! list backups, and restore from backup.

use axum::response::Json;
use serde::{Deserialize, Serialize};

use crate::http::types::ApiResponse;
use crate::queue::sqlite::{
    clear_runtime_s3_config, get_runtime_s3_config, set_runtime_s3_config, S3BackupConfig,
    S3BackupManager,
};

use super::{get_db_path, parse_env, parse_env_bool, S3BackupSettings};

// ============================================================================
// Types
// ============================================================================

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

impl SaveS3SettingsRequest {
    /// Validate required S3 fields and return them if valid.
    fn validate_required(&self) -> Result<(String, String, String, String), &'static str> {
        let endpoint = self
            .endpoint
            .as_ref()
            .filter(|e| !e.is_empty())
            .ok_or("S3 endpoint is required")?
            .clone();
        let bucket = self
            .bucket
            .as_ref()
            .filter(|b| !b.is_empty())
            .ok_or("S3 bucket is required")?
            .clone();
        let access_key = self
            .access_key
            .as_ref()
            .filter(|k| !k.is_empty())
            .ok_or("S3 access key is required")?
            .clone();
        let secret_key = self
            .secret_key
            .as_ref()
            .filter(|s| !s.is_empty())
            .ok_or("S3 secret key is required")?
            .clone();
        Ok((endpoint, bucket, access_key, secret_key))
    }
}

/// S3 backup info response.
#[derive(Serialize)]
pub struct S3BackupInfo {
    pub key: String,
    pub size: i64,
    pub last_modified: Option<String>,
}

/// Restore request.
#[derive(Deserialize)]
pub struct RestoreRequest {
    pub key: String,
}

// ============================================================================
// Settings Handlers
// ============================================================================

/// Save S3 settings (runtime configuration).
pub async fn save_s3_settings(
    Json(req): Json<SaveS3SettingsRequest>,
) -> Json<ApiResponse<&'static str>> {
    tracing::info!("save_s3_settings: enabled = {}", req.enabled);

    if !req.enabled {
        clear_runtime_s3_config();
        tracing::info!("save_s3_settings: S3 backup disabled, config cleared");
        return ApiResponse::success("S3 backup disabled");
    }

    // Validate required fields
    let (endpoint, bucket, access_key, secret_key) = match req.validate_required() {
        Ok(v) => v,
        Err(e) => return ApiResponse::error(e),
    };

    let config = S3BackupConfig::new(endpoint, bucket, access_key, secret_key)
        .with_region(req.region.unwrap_or_else(|| "auto".to_string()))
        .with_interval(req.interval_secs.unwrap_or(300))
        .with_keep_count(req.keep_count.unwrap_or(24))
        .with_prefix(req.prefix.unwrap_or_else(|| "backups/".to_string()))
        .with_compress(req.compress.unwrap_or(true));

    set_runtime_s3_config(config);
    tracing::info!(
        "save_s3_settings: S3 config stored, verifying: {:?}",
        get_runtime_s3_config().is_some()
    );
    ApiResponse::success("S3 backup configuration saved")
}

/// Test S3 connection.
pub async fn test_s3_connection(
    Json(req): Json<SaveS3SettingsRequest>,
) -> Json<ApiResponse<&'static str>> {
    // Validate required fields
    let (endpoint, bucket, access_key, secret_key) = match req.validate_required() {
        Ok(v) => v,
        Err(e) => return ApiResponse::error(e),
    };

    let config = S3BackupConfig::new(endpoint, bucket, access_key, secret_key)
        .with_region(req.region.unwrap_or_else(|| "auto".to_string()));

    // Try to create backup manager and list objects
    match S3BackupManager::new(config).await {
        Ok(manager) => match manager.list_backups().await {
            Ok(_) => ApiResponse::success("Connection successful"),
            Err(e) => ApiResponse::error_string(format!("Connection failed: {}", e)),
        },
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
        enabled: parse_env_bool!("S3_BACKUP_ENABLED", false),
        endpoint: std::env::var("S3_ENDPOINT").ok(),
        bucket: std::env::var("S3_BUCKET").ok(),
        region: std::env::var("S3_REGION").ok(),
        interval_secs: parse_env!("S3_BACKUP_INTERVAL_SECS", 300),
        keep_count: parse_env!("S3_BACKUP_KEEP_COUNT", 24),
        compress: parse_env_bool!("S3_BACKUP_COMPRESS", true),
    };
    ApiResponse::success(settings)
}

// ============================================================================
// Backup Operations
// ============================================================================

/// Trigger manual S3 backup.
pub async fn trigger_s3_backup() -> Json<ApiResponse<&'static str>> {
    let config = match S3BackupConfig::from_env() {
        Some(c) => c,
        None => return ApiResponse::error("S3 backup not configured"),
    };

    let db_path = match get_db_path() {
        Some(p) => std::path::PathBuf::from(p),
        None => return ApiResponse::error("DATA_PATH not configured"),
    };

    let backup_manager = match S3BackupManager::new(config).await {
        Ok(m) => m,
        Err(e) => {
            return ApiResponse::error_string(format!("Failed to create backup manager: {}", e))
        }
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

    let backup_manager = match S3BackupManager::new(config).await {
        Ok(m) => m,
        Err(e) => {
            return ApiResponse::error_string(format!("Failed to create backup manager: {}", e))
        }
    };

    match backup_manager.list_backups_detailed().await {
        Ok(backups) => ApiResponse::success(
            backups
                .into_iter()
                .map(|(key, size, modified)| S3BackupInfo {
                    key,
                    size,
                    last_modified: modified,
                })
                .collect(),
        ),
        Err(e) => ApiResponse::error_string(format!("Failed to list backups: {}", e)),
    }
}

/// Restore from S3 backup.
pub async fn restore_s3_backup(Json(req): Json<RestoreRequest>) -> Json<ApiResponse<&'static str>> {
    let config = match S3BackupConfig::from_env() {
        Some(c) => c,
        None => return ApiResponse::error("S3 backup not configured"),
    };

    let db_path = match get_db_path() {
        Some(p) => std::path::PathBuf::from(p),
        None => return ApiResponse::error("DATA_PATH not configured"),
    };

    let backup_manager = match S3BackupManager::new(config).await {
        Ok(m) => m,
        Err(e) => {
            return ApiResponse::error_string(format!("Failed to create backup manager: {}", e))
        }
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
                    return ApiResponse::error_string(format!(
                        "Failed to backup current db: {}",
                        e
                    ));
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
