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
    /// Uses streaming for non-compressed uploads, temp file for compressed to avoid OOM
    pub async fn backup(&self, db_path: &Path) -> Result<(), String> {
        use aws_sdk_s3::primitives::ByteStream;
        use std::io::{BufReader, BufWriter, Read};

        if !db_path.exists() {
            return Err("Database file does not exist".to_string());
        }

        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let extension = if self.config.compress { "db.gz" } else { "db" };
        let key = format!("{}flashq_{}.{}", self.config.prefix, timestamp, extension);

        // Track temp file for cleanup after upload (needed for Windows compatibility)
        let mut temp_file_to_cleanup: Option<std::path::PathBuf> = None;

        let (body, body_size) = if self.config.compress {
            // Compress to temp file to avoid loading entire DB into memory
            let temp_path = db_path.with_extension("db.gz.tmp");

            // Stream compress: read chunks from source, write compressed to temp
            {
                let source = std::fs::File::open(db_path)
                    .map_err(|e| format!("Failed to open database: {}", e))?;
                let mut reader = BufReader::with_capacity(64 * 1024, source); // 64KB buffer

                let temp_file = std::fs::File::create(&temp_path)
                    .map_err(|e| format!("Failed to create temp file: {}", e))?;
                let writer = BufWriter::with_capacity(64 * 1024, temp_file);
                let mut encoder = GzEncoder::new(writer, Compression::default());

                // Stream copy in chunks
                let mut buffer = [0u8; 64 * 1024]; // 64KB chunks
                loop {
                    let bytes_read = reader
                        .read(&mut buffer)
                        .map_err(|e| format!("Failed to read database: {}", e))?;
                    if bytes_read == 0 {
                        break;
                    }
                    encoder
                        .write_all(&buffer[..bytes_read])
                        .map_err(|e| format!("Compression failed: {}", e))?;
                }
                encoder
                    .finish()
                    .map_err(|e| format!("Compression finish failed: {}", e))?;
            }

            let size = std::fs::metadata(&temp_path)
                .map(|m| m.len() as usize)
                .unwrap_or(0);

            // Stream upload from temp file
            let stream = match ByteStream::from_path(&temp_path).await {
                Ok(s) => s,
                Err(e) => {
                    // Cleanup temp file on error
                    let _ = std::fs::remove_file(&temp_path);
                    return Err(format!("Failed to create stream: {}", e));
                }
            };

            // Mark temp file for cleanup AFTER upload completes (Windows compatibility)
            temp_file_to_cleanup = Some(temp_path);

            (stream, size)
        } else {
            // No compression: stream directly from source file (zero memory copy)
            let size = std::fs::metadata(db_path)
                .map(|m| m.len() as usize)
                .unwrap_or(0);

            let stream = ByteStream::from_path(db_path)
                .await
                .map_err(|e| format!("Failed to create stream: {}", e))?;

            (stream, size)
        };

        // Upload to S3
        let upload_result = self
            .client
            .put_object()
            .bucket(&self.config.bucket)
            .key(&key)
            .body(body)
            .send()
            .await;

        // Cleanup temp file AFTER upload (for Windows compatibility - can't delete open files)
        if let Some(temp_path) = temp_file_to_cleanup {
            let _ = std::fs::remove_file(&temp_path);
        }

        // Check upload result after cleanup
        upload_result.map_err(|e| format!("S3 upload failed: {}", e))?;

        self.last_backup
            .store(crate::queue::types::now_ms(), Ordering::Relaxed);
        info!(key = %key, size = body_size, "Backup uploaded to S3");

        // Cleanup old backups
        self.cleanup_old_backups().await.ok();

        Ok(())
    }

    /// List all objects with pagination support
    async fn list_all_objects(&self) -> Result<Vec<aws_sdk_s3::types::Object>, String> {
        let mut all_objects = Vec::new();
        let mut continuation_token: Option<String> = None;

        loop {
            let mut request = self
                .client
                .list_objects_v2()
                .bucket(&self.config.bucket)
                .prefix(&self.config.prefix);

            if let Some(token) = continuation_token.take() {
                request = request.continuation_token(token);
            }

            let response = request
                .send()
                .await
                .map_err(|e| format!("Failed to list objects: {}", e))?;

            // Collect objects from this page
            all_objects.extend(response.contents().iter().cloned());

            // Check if there are more pages
            if response.is_truncated() == Some(true) {
                continuation_token = response.next_continuation_token().map(|s| s.to_string());
            } else {
                break;
            }
        }

        Ok(all_objects)
    }

    /// Cleanup old backups, keeping only the most recent N
    async fn cleanup_old_backups(&self) -> Result<(), String> {
        let objects = self.list_all_objects().await?;

        let mut keys: Vec<_> = objects
            .iter()
            .filter_map(|obj| obj.key().map(|k| k.to_string()))
            .collect();

        // Sort by name (timestamp-based, newest first)
        keys.sort_by(|a, b| b.cmp(a));

        // Delete old backups
        for key in keys.iter().skip(self.config.keep_count) {
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
        let objects = self.list_all_objects().await?;

        let mut keys: Vec<_> = objects
            .iter()
            .filter_map(|obj| obj.key().map(|k| k.to_string()))
            .collect();

        keys.sort_by(|a, b| b.cmp(a));
        Ok(keys)
    }

    /// List available backups in S3 with detailed info (key, size, last_modified)
    pub async fn list_backups_detailed(
        &self,
    ) -> Result<Vec<(String, i64, Option<String>)>, String> {
        let objects = self.list_all_objects().await?;

        let mut detailed: Vec<_> = objects
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
        detailed.sort_by(|a, b| b.0.cmp(&a.0));
        Ok(detailed)
    }

    /// Download and restore from S3 backup.
    /// Uses streaming to avoid loading entire file into memory (prevents OOM on large DBs).
    pub async fn restore(&self, key: &str, target_path: &Path) -> Result<(), String> {
        use flate2::read::GzDecoder;
        use rusqlite::Connection;
        use std::io::{BufReader, BufWriter, Read, Write};
        use tokio::io::AsyncReadExt;

        let response = self
            .client
            .get_object()
            .bucket(&self.config.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| format!("Failed to download backup: {}", e))?;

        // Stream download to temp compressed file (avoids loading into memory)
        let compressed_temp = target_path.with_extension("db.download.tmp");
        let temp_path = target_path.with_extension("db.tmp");

        // Stream body to file in chunks
        {
            let file = std::fs::File::create(&compressed_temp)
                .map_err(|e| format!("Failed to create temp file: {}", e))?;
            let mut writer = BufWriter::with_capacity(64 * 1024, file);

            let mut stream = response.body.into_async_read();
            let mut buffer = [0u8; 64 * 1024]; // 64KB chunks

            loop {
                let bytes_read = stream
                    .read(&mut buffer)
                    .await
                    .map_err(|e| format!("Failed to read from S3: {}", e))?;
                if bytes_read == 0 {
                    break;
                }
                writer
                    .write_all(&buffer[..bytes_read])
                    .map_err(|e| format!("Failed to write temp file: {}", e))?;
            }
            writer
                .flush()
                .map_err(|e| format!("Failed to flush temp file: {}", e))?;
        }

        // Decompress if needed (streaming from file to file)
        if key.ends_with(".gz") {
            let source = std::fs::File::open(&compressed_temp)
                .map_err(|e| format!("Failed to open compressed file: {}", e))?;
            let reader = BufReader::with_capacity(64 * 1024, source);
            let mut decoder = GzDecoder::new(reader);

            let dest = std::fs::File::create(&temp_path)
                .map_err(|e| format!("Failed to create decompressed file: {}", e))?;
            let mut writer = BufWriter::with_capacity(64 * 1024, dest);

            // Stream decompress in chunks
            let mut buffer = [0u8; 64 * 1024];
            loop {
                let bytes_read = decoder
                    .read(&mut buffer)
                    .map_err(|e| format!("Decompression failed: {}", e))?;
                if bytes_read == 0 {
                    break;
                }
                writer
                    .write_all(&buffer[..bytes_read])
                    .map_err(|e| format!("Failed to write decompressed: {}", e))?;
            }
            writer
                .flush()
                .map_err(|e| format!("Failed to flush decompressed: {}", e))?;

            // Remove compressed temp
            std::fs::remove_file(&compressed_temp).ok();
        } else {
            // Not compressed - just rename
            std::fs::rename(&compressed_temp, &temp_path)
                .map_err(|e| format!("Failed to rename temp file: {}", e))?;
        }

        // Validate the downloaded file is a valid SQLite database
        let validation_result = (|| -> Result<(), String> {
            let conn =
                Connection::open(&temp_path).map_err(|e| format!("Invalid SQLite file: {}", e))?;

            // Run integrity check
            let integrity: String = conn
                .query_row("PRAGMA integrity_check", [], |row| row.get(0))
                .map_err(|e| format!("Integrity check failed: {}", e))?;

            if integrity != "ok" {
                return Err(format!("Database integrity check failed: {}", integrity));
            }

            // Verify it has the expected tables
            let has_jobs: i32 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='jobs'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| format!("Table check failed: {}", e))?;

            if has_jobs == 0 {
                return Err("Invalid flashQ backup: missing 'jobs' table".to_string());
            }

            Ok(())
        })();

        // If validation fails, remove temp files and return error
        if let Err(e) = validation_result {
            std::fs::remove_file(&temp_path).ok();
            std::fs::remove_file(&compressed_temp).ok();
            return Err(e);
        }

        // Validation passed - move temp file to target
        std::fs::rename(&temp_path, target_path)
            .map_err(|e| format!("Failed to replace database: {}", e))?;

        info!(key = %key, path = ?target_path, "Restored from S3 backup (validated, streamed)");
        Ok(())
    }
}
