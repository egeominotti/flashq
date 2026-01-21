//! S3-compatible backup for flashQ.
//!
//! Supports AWS S3, Cloudflare R2, MinIO, Backblaze B2, etc.

use aws_config::Region;
use aws_credential_types::Credentials;
use aws_sdk_s3::Client;
use flate2::write::GzEncoder;
use flate2::Compression;
use parking_lot::RwLock;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use tracing::{error, info};

/// Global runtime S3 configuration (set via API)
static RUNTIME_S3_CONFIG: RwLock<Option<S3BackupConfig>> = RwLock::new(None);

/// Set runtime S3 configuration (called from API)
pub fn set_runtime_s3_config(config: S3BackupConfig) {
    let mut guard = RUNTIME_S3_CONFIG.write();
    *guard = Some(config);
}

/// Get runtime S3 configuration
pub fn get_runtime_s3_config() -> Option<S3BackupConfig> {
    RUNTIME_S3_CONFIG.read().clone()
}

/// Clear runtime S3 configuration
pub fn clear_runtime_s3_config() {
    let mut guard = RUNTIME_S3_CONFIG.write();
    *guard = None;
}

/// S3 backup configuration
#[derive(Debug, Clone)]
pub struct S3BackupConfig {
    /// S3 endpoint URL (e.g., https://s3.amazonaws.com, https://xxx.r2.cloudflarestorage.com)
    pub endpoint: String,
    /// S3 bucket name
    pub bucket: String,
    /// S3 region
    pub region: String,
    /// Access key ID
    pub access_key: String,
    /// Secret access key
    pub secret_key: String,
    /// Backup interval in seconds
    pub interval_secs: u64,
    /// Number of backups to keep in S3
    pub keep_count: usize,
    /// Prefix for backup files in S3
    pub prefix: String,
    /// Enable gzip compression
    pub compress: bool,
}

impl S3BackupConfig {
    /// Create from environment variables OR runtime config
    /// Runtime config takes precedence over environment variables
    pub fn from_env() -> Option<Self> {
        // First check runtime config (set via API)
        if let Some(config) = get_runtime_s3_config() {
            return Some(config);
        }

        // Fall back to environment variables
        let enabled = std::env::var("S3_BACKUP_ENABLED")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(false);

        if !enabled {
            return None;
        }

        let endpoint = std::env::var("S3_ENDPOINT").ok()?;
        let bucket = std::env::var("S3_BUCKET").ok()?;
        let access_key = std::env::var("S3_ACCESS_KEY").ok()?;
        let secret_key = std::env::var("S3_SECRET_KEY").ok()?;

        Some(Self {
            endpoint,
            bucket,
            region: std::env::var("S3_REGION").unwrap_or_else(|_| "auto".to_string()),
            access_key,
            secret_key,
            interval_secs: std::env::var("S3_BACKUP_INTERVAL_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(300),
            keep_count: std::env::var("S3_BACKUP_KEEP_COUNT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(24),
            prefix: std::env::var("S3_BACKUP_PREFIX").unwrap_or_else(|_| "backups/".to_string()),
            compress: std::env::var("S3_BACKUP_COMPRESS")
                .map(|v| v != "0" && v.to_lowercase() != "false")
                .unwrap_or(true),
        })
    }

    /// Create a new S3BackupConfig with required fields
    pub fn new(endpoint: String, bucket: String, access_key: String, secret_key: String) -> Self {
        Self {
            endpoint,
            bucket,
            region: "auto".to_string(),
            access_key,
            secret_key,
            interval_secs: 300,
            keep_count: 24,
            prefix: "backups/".to_string(),
            compress: true,
        }
    }

    /// Builder method to set region
    pub fn with_region(mut self, region: String) -> Self {
        self.region = region;
        self
    }

    /// Builder method to set interval
    pub fn with_interval(mut self, secs: u64) -> Self {
        self.interval_secs = secs;
        self
    }

    /// Builder method to set keep count
    pub fn with_keep_count(mut self, count: usize) -> Self {
        self.keep_count = count;
        self
    }

    /// Builder method to set prefix
    pub fn with_prefix(mut self, prefix: String) -> Self {
        self.prefix = prefix;
        self
    }

    /// Builder method to set compression
    pub fn with_compress(mut self, compress: bool) -> Self {
        self.compress = compress;
        self
    }
}

/// S3 backup manager
pub struct S3BackupManager {
    client: Client,
    config: S3BackupConfig,
    last_backup: AtomicU64,
}

impl S3BackupManager {
    /// Create a new S3 backup manager
    pub async fn new(config: S3BackupConfig) -> Result<Self, String> {
        let credentials =
            Credentials::new(&config.access_key, &config.secret_key, None, None, "flashq");

        let s3_config = aws_sdk_s3::Config::builder()
            .endpoint_url(&config.endpoint)
            .region(Region::new(config.region.clone()))
            .credentials_provider(credentials)
            .force_path_style(true)
            .build();

        let client = Client::from_conf(s3_config);

        info!(bucket = %config.bucket, endpoint = %config.endpoint, "S3 backup manager initialized");

        Ok(Self {
            client,
            config,
            last_backup: AtomicU64::new(0),
        })
    }

    /// Check if backup is needed based on interval
    pub fn should_backup(&self) -> bool {
        let now = crate::queue::types::now_ms();
        let last = self.last_backup.load(Ordering::Relaxed);
        let elapsed_secs = (now - last) / 1000;
        elapsed_secs >= self.config.interval_secs
    }

    /// Upload database backup to S3
    pub async fn backup(&self, db_path: &Path) -> Result<(), String> {
        if !db_path.exists() {
            return Err("Database file does not exist".to_string());
        }

        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let extension = if self.config.compress { "db.gz" } else { "db" };
        let key = format!("{}flashq_{}.{}", self.config.prefix, timestamp, extension);

        // Read database file
        let data = std::fs::read(db_path).map_err(|e| format!("Failed to read database: {}", e))?;

        // Compress if enabled
        let body = if self.config.compress {
            let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
            encoder
                .write_all(&data)
                .map_err(|e| format!("Compression failed: {}", e))?;
            encoder
                .finish()
                .map_err(|e| format!("Compression finish failed: {}", e))?
        } else {
            data
        };

        let body_size = body.len();

        // Upload to S3
        self.client
            .put_object()
            .bucket(&self.config.bucket)
            .key(&key)
            .body(body.into())
            .send()
            .await
            .map_err(|e| format!("S3 upload failed: {}", e))?;

        self.last_backup
            .store(crate::queue::types::now_ms(), Ordering::Relaxed);
        info!(key = %key, size = body_size, "Backup uploaded to S3");

        // Cleanup old backups
        self.cleanup_old_backups().await.ok();

        Ok(())
    }

    /// Cleanup old backups, keeping only the most recent N
    async fn cleanup_old_backups(&self) -> Result<(), String> {
        let list = self
            .client
            .list_objects_v2()
            .bucket(&self.config.bucket)
            .prefix(&self.config.prefix)
            .send()
            .await
            .map_err(|e| format!("Failed to list objects: {}", e))?;

        let mut objects: Vec<_> = list
            .contents()
            .iter()
            .filter_map(|obj| obj.key().map(|k| k.to_string()))
            .collect();

        // Sort by name (timestamp-based, newest first)
        objects.sort_by(|a, b| b.cmp(a));

        // Delete old backups
        for key in objects.iter().skip(self.config.keep_count) {
            if let Err(e) = self
                .client
                .delete_object()
                .bucket(&self.config.bucket)
                .key(key)
                .send()
                .await
            {
                error!(key = %key, error = %e, "Failed to delete old backup");
            }
        }

        Ok(())
    }

    /// List available backups in S3
    pub async fn list_backups(&self) -> Result<Vec<String>, String> {
        let list = self
            .client
            .list_objects_v2()
            .bucket(&self.config.bucket)
            .prefix(&self.config.prefix)
            .send()
            .await
            .map_err(|e| format!("Failed to list objects: {}", e))?;

        let mut objects: Vec<_> = list
            .contents()
            .iter()
            .filter_map(|obj| obj.key().map(|k| k.to_string()))
            .collect();

        objects.sort_by(|a, b| b.cmp(a));
        Ok(objects)
    }

    /// List available backups in S3 with detailed info (key, size, last_modified)
    pub async fn list_backups_detailed(
        &self,
    ) -> Result<Vec<(String, i64, Option<String>)>, String> {
        let list = self
            .client
            .list_objects_v2()
            .bucket(&self.config.bucket)
            .prefix(&self.config.prefix)
            .send()
            .await
            .map_err(|e| format!("Failed to list objects: {}", e))?;

        let mut objects: Vec<_> = list
            .contents()
            .iter()
            .filter_map(|obj| {
                obj.key().map(|k| {
                    let size = obj.size().unwrap_or(0);
                    let modified = obj.last_modified().map(|dt| dt.to_string());
                    (k.to_string(), size, modified)
                })
            })
            .collect();

        // Sort by key (timestamp-based, newest first)
        objects.sort_by(|a, b| b.0.cmp(&a.0));
        Ok(objects)
    }

    /// Download and restore from S3 backup
    pub async fn restore(&self, key: &str, target_path: &Path) -> Result<(), String> {
        let response = self
            .client
            .get_object()
            .bucket(&self.config.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| format!("Failed to download backup: {}", e))?;

        let data = response
            .body
            .collect()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?
            .into_bytes();

        // Decompress if needed
        let db_data = if key.ends_with(".gz") {
            use flate2::read::GzDecoder;
            use std::io::Read;
            let mut decoder = GzDecoder::new(&data[..]);
            let mut decompressed = Vec::new();
            decoder
                .read_to_end(&mut decompressed)
                .map_err(|e| format!("Decompression failed: {}", e))?;
            decompressed
        } else {
            data.to_vec()
        };

        std::fs::write(target_path, db_data)
            .map_err(|e| format!("Failed to write database: {}", e))?;

        info!(key = %key, path = ?target_path, "Restored from S3 backup");
        Ok(())
    }
}
