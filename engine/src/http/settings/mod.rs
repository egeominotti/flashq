//! Server settings HTTP handlers - modular organization.
//!
//! Split into logical modules:
//! - `server` - Server control, auth, queue defaults, cleanup
//! - `metrics` - System metrics (CPU, memory, uptime)

mod metrics;
mod server;

// Re-export all public items
pub use metrics::*;
pub use server::*;

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

pub(crate) use parse_env;

// ============================================================================
// Common Types
// ============================================================================

/// Server settings response.
#[derive(Serialize)]
pub struct ServerSettings {
    pub version: &'static str,
    pub tcp_port: u16,
    pub http_port: u16,
    pub storage_backend: &'static str,
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
