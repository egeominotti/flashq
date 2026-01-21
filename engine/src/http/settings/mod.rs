//! Server settings HTTP handlers - modular organization.
//!
//! Split into logical modules:
//! - `server` - Server control, auth, queue defaults, cleanup
//! - `metrics` - System metrics (CPU, memory, uptime)
//! - `sqlite` - SQLite configuration and operations
//! - `s3` - S3 backup configuration and operations

mod metrics;
mod s3;
mod server;
mod sqlite;

// Re-export all public items
pub use metrics::*;
pub use s3::*;
pub use server::*;
pub use sqlite::*;

use serde::Serialize;

// ============================================================================
// Common Macros
// ============================================================================

/// Parse environment variable to type T with default value.
macro_rules! parse_env {
    ($name:expr, $default:expr) => {
        std::env::var($name)
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or($default)
    };
}

/// Parse environment variable as bool (accepts "1" or "true").
macro_rules! parse_env_bool {
    ($name:expr, $default:expr) => {
        std::env::var($name)
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or($default)
    };
}

pub(crate) use parse_env;
pub(crate) use parse_env_bool;

// ============================================================================
// Common Types
// ============================================================================

/// S3 Backup settings (read-only, for API responses).
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

/// SQLite settings (read-only, for API responses).
#[derive(Serialize)]
pub struct SqliteSettings {
    pub enabled: bool,
    pub path: Option<String>,
    pub synchronous: bool,
    pub snapshot_interval: u64,
    pub snapshot_min_changes: u64,
}

/// Server settings response (combined view).
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

// ============================================================================
// Uptime Tracking
// ============================================================================

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

// ============================================================================
// Common Utilities
// ============================================================================

/// Get database path from environment (DATA_PATH or SQLITE_PATH).
#[inline]
pub(crate) fn get_db_path() -> Option<String> {
    std::env::var("DATA_PATH")
        .or_else(|_| std::env::var("SQLITE_PATH"))
        .ok()
}
