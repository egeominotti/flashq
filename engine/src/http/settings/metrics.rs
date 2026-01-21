//! System metrics handlers.
//!
//! Provides CPU, memory, and connection metrics.

use axum::{extract::State, response::Json};
use serde::Serialize;

use crate::http::types::{ApiResponse, AppState};

use super::get_uptime_seconds;

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Handlers
// ============================================================================

/// Get system metrics.
pub async fn get_system_metrics(State(qm): State<AppState>) -> Json<ApiResponse<SystemMetrics>> {
    let uptime = get_uptime_seconds();
    let (memory_used, memory_total) = get_memory_info();
    let tcp_connections = qm.connection_count();
    let cpu_percent = get_cpu_percent();

    let metrics = SystemMetrics {
        memory_used_mb: memory_used,
        memory_total_mb: memory_total,
        memory_percent: if memory_total > 0.0 {
            (memory_used / memory_total) * 100.0
        } else {
            0.0
        },
        cpu_percent,
        tcp_connections,
        uptime_seconds: uptime,
        process_id: std::process::id(),
    };
    ApiResponse::success(metrics)
}

// ============================================================================
// Platform-specific CPU metrics
// ============================================================================

fn get_cpu_percent() -> f64 {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let pid = std::process::id();
        if let Ok(output) = Command::new("ps")
            .args(["-o", "%cpu=", "-p", &pid.to_string()])
            .output()
        {
            if let Ok(cpu_str) = String::from_utf8(output.stdout) {
                return cpu_str.trim().parse().unwrap_or(0.0);
            }
        }
        0.0
    }

    #[cfg(target_os = "linux")]
    {
        // Read /proc/self/stat for CPU usage (simplified)
        if let Ok(stat) = std::fs::read_to_string("/proc/self/stat") {
            let parts: Vec<&str> = stat.split_whitespace().collect();
            if parts.len() > 14 {
                let utime: f64 = parts[13].parse().unwrap_or(0.0);
                let stime: f64 = parts[14].parse().unwrap_or(0.0);
                let total_time = utime + stime;
                // Approximate CPU percentage (simplified)
                let uptime = get_uptime_seconds() as f64;
                if uptime > 0.0 {
                    let clock_ticks = 100.0; // Usually 100 on Linux
                    return (total_time / clock_ticks / uptime) * 100.0;
                }
            }
        }
        0.0
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        0.0
    }
}

// ============================================================================
// Platform-specific Memory metrics
// ============================================================================

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
        use std::process::Command;
        // Get process memory using ps
        let pid = std::process::id();
        if let Ok(output) = Command::new("ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .output()
        {
            if let Ok(rss_str) = String::from_utf8(output.stdout) {
                let rss_kb: f64 = rss_str.trim().parse().unwrap_or(0.0);
                let used_mb = rss_kb / 1024.0;

                // Get total system memory using sysctl
                if let Ok(total_output) = Command::new("sysctl")
                    .args(["-n", "hw.memsize"])
                    .output()
                {
                    if let Ok(total_str) = String::from_utf8(total_output.stdout) {
                        let total_bytes: f64 = total_str.trim().parse().unwrap_or(0.0);
                        let total_mb = total_bytes / 1024.0 / 1024.0;
                        return (used_mb, total_mb);
                    }
                }
                return (used_mb, 0.0);
            }
        }
        (0.0, 0.0)
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        (0.0, 0.0)
    }
}
