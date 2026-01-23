//! System metrics handlers using sysinfo crate.
//!
//! Provides CPU, memory, disk I/O, and connection metrics with professional-grade accuracy.

use std::sync::OnceLock;

use axum::{extract::State, response::Json};
use parking_lot::Mutex;
use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

use crate::http::types::{ApiResponse, AppState};

use super::get_uptime_seconds;

// ============================================================================
// Global System Info (cached, refreshed on demand)
// ============================================================================

static SYSTEM: OnceLock<Mutex<System>> = OnceLock::new();

/// Get the global System instance for metrics collection.
pub fn get_system() -> &'static Mutex<System> {
    SYSTEM.get_or_init(|| Mutex::new(System::new()))
}

// ============================================================================
// Types
// ============================================================================

/// Disk I/O metrics for the process.
#[derive(Serialize, Clone, Default)]
pub struct DiskIoMetrics {
    pub read_bytes: u64,
    pub written_bytes: u64,
    pub read_mb: f64,
    pub written_mb: f64,
}

/// Detailed process metrics from sysinfo.
#[derive(Serialize, Clone, Default)]
pub struct ProcessMetrics {
    pub memory_rss_mb: f64,
    pub memory_virtual_mb: f64,
    pub cpu_percent: f32,
    pub disk_io: DiskIoMetrics,
    pub start_time_unix: u64,
    pub run_time_seconds: u64,
    pub status: String,
}

/// System metrics response (full telemetry).
#[derive(Serialize)]
pub struct SystemMetrics {
    // Process memory
    pub memory_used_mb: f64,
    pub memory_total_mb: f64,
    pub memory_percent: f64,
    pub memory_rss_mb: f64,
    pub memory_virtual_mb: f64,
    // CPU
    pub cpu_percent: f32,
    // Disk I/O
    pub disk_read_bytes: u64,
    pub disk_written_bytes: u64,
    pub disk_read_mb: f64,
    pub disk_written_mb: f64,
    // Process info
    pub process_id: u32,
    pub start_time_unix: u64,
    pub run_time_seconds: u64,
    pub process_status: String,
    // Server state
    pub tcp_connections: usize,
    pub uptime_seconds: u64,
}

// ============================================================================
// Shared Helpers
// ============================================================================

/// Refresh and get detailed process metrics.
/// Used by both HTTP endpoint and WebSocket dashboard.
pub fn refresh_process_metrics() -> ProcessMetrics {
    let pid = std::process::id();
    let mut sys = get_system().lock();

    // Refresh only this process with all available info
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
        true,
        ProcessRefreshKind::new()
            .with_cpu()
            .with_memory()
            .with_disk_usage(),
    );

    if let Some(process) = sys.process(Pid::from_u32(pid)) {
        let disk = process.disk_usage();
        ProcessMetrics {
            memory_rss_mb: process.memory() as f64 / 1024.0 / 1024.0,
            memory_virtual_mb: process.virtual_memory() as f64 / 1024.0 / 1024.0,
            cpu_percent: process.cpu_usage(),
            disk_io: DiskIoMetrics {
                read_bytes: disk.read_bytes,
                written_bytes: disk.written_bytes,
                read_mb: disk.read_bytes as f64 / 1024.0 / 1024.0,
                written_mb: disk.written_bytes as f64 / 1024.0 / 1024.0,
            },
            start_time_unix: process.start_time(),
            run_time_seconds: process.run_time(),
            status: format!("{:?}", process.status()),
        }
    } else {
        ProcessMetrics::default()
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// Get total system memory in MB.
pub fn get_total_memory_mb() -> f64 {
    let mut sys = get_system().lock();
    sys.refresh_memory();
    sys.total_memory() as f64 / 1024.0 / 1024.0
}

/// Get system metrics using sysinfo crate.
pub async fn get_system_metrics(State(qm): State<AppState>) -> Json<ApiResponse<SystemMetrics>> {
    let uptime = get_uptime_seconds();
    let tcp_connections = qm.connection_count();
    let pid = std::process::id();

    let pm = refresh_process_metrics();
    let total_memory_mb = get_total_memory_mb();
    let memory_percent = if total_memory_mb > 0.0 {
        (pm.memory_rss_mb / total_memory_mb) * 100.0
    } else {
        0.0
    };

    let metrics = SystemMetrics {
        memory_used_mb: pm.memory_rss_mb,
        memory_total_mb: total_memory_mb,
        memory_percent,
        memory_rss_mb: pm.memory_rss_mb,
        memory_virtual_mb: pm.memory_virtual_mb,
        cpu_percent: pm.cpu_percent,
        disk_read_bytes: pm.disk_io.read_bytes,
        disk_written_bytes: pm.disk_io.written_bytes,
        disk_read_mb: pm.disk_io.read_mb,
        disk_written_mb: pm.disk_io.written_mb,
        process_id: pid,
        start_time_unix: pm.start_time_unix,
        run_time_seconds: pm.run_time_seconds,
        process_status: pm.status,
        tcp_connections,
        uptime_seconds: uptime,
    };

    ApiResponse::success(metrics)
}
