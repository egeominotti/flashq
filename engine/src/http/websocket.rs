//! WebSocket HTTP handlers.

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
};
use parking_lot::RwLock;
use serde::Serialize;
use tokio::sync::broadcast;
use tokio::time::interval;

use crate::protocol::{CronJob, MetricsData, MetricsHistoryPoint, QueueInfo, WorkerInfo};
use crate::queue::QueueManager;

use super::settings::{SqliteStats, SystemMetrics};
use super::types::{AppState, StatsResponse, WsQuery};

/// Maximum concurrent WebSocket connections
const MAX_WS_CONNECTIONS: usize = 100;

/// Dashboard update interval in milliseconds (configurable via DASHBOARD_INTERVAL_MS env var)
const DEFAULT_DASHBOARD_INTERVAL_MS: u64 = 2000;

/// System metrics cache refresh interval (avoid spawning processes too often)
const SYSTEM_METRICS_CACHE_MS: u64 = 5000;

// ============================================================================
// Cached System Metrics (avoid spawning processes every update)
// ============================================================================

/// Cached system metrics to avoid expensive process spawning
struct CachedSystemMetrics {
    cpu_percent: f64,
    memory_used_mb: f64,
    memory_total_mb: f64,
}

static CACHED_METRICS: RwLock<Option<CachedSystemMetrics>> = RwLock::new(None);
static METRICS_LAST_UPDATE: AtomicU64 = AtomicU64::new(0);

/// Get system metrics with caching (refreshes every SYSTEM_METRICS_CACHE_MS)
fn get_cached_system_metrics() -> (f64, f64, f64) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let last_update = METRICS_LAST_UPDATE.load(Ordering::Relaxed);

    // Check if cache is still valid
    if now - last_update < SYSTEM_METRICS_CACHE_MS {
        if let Some(cached) = CACHED_METRICS.read().as_ref() {
            return (
                cached.cpu_percent,
                cached.memory_used_mb,
                cached.memory_total_mb,
            );
        }
    }

    // Refresh cache (only one thread should do this)
    if METRICS_LAST_UPDATE
        .compare_exchange(last_update, now, Ordering::SeqCst, Ordering::Relaxed)
        .is_ok()
    {
        let cpu_percent = get_cpu_percent();
        let (memory_used_mb, memory_total_mb) = get_memory_info();

        *CACHED_METRICS.write() = Some(CachedSystemMetrics {
            cpu_percent,
            memory_used_mb,
            memory_total_mb,
        });

        return (cpu_percent, memory_used_mb, memory_total_mb);
    }

    // Another thread is updating, return stale data or defaults
    if let Some(cached) = CACHED_METRICS.read().as_ref() {
        (
            cached.cpu_percent,
            cached.memory_used_mb,
            cached.memory_total_mb,
        )
    } else {
        (0.0, 0.0, 0.0)
    }
}

/// Global WebSocket connection counter
static WS_CONNECTION_COUNT: AtomicUsize = AtomicUsize::new(0);

/// WebSocket handler for all job events.
pub async fn ws_handler(
    State(qm): State<AppState>,
    Query(params): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    // Validate token if authentication is enabled
    let token = params.token.as_deref().unwrap_or("");
    if !qm.verify_token(token) {
        return (StatusCode::UNAUTHORIZED, "Invalid or missing token").into_response();
    }

    // Check connection limit
    if WS_CONNECTION_COUNT.load(Ordering::Relaxed) >= MAX_WS_CONNECTIONS {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "Too many WebSocket connections",
        )
            .into_response();
    }

    ws.on_upgrade(move |socket| handle_websocket(socket, qm, None))
}

/// WebSocket handler for queue-specific events.
pub async fn ws_queue_handler(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    Query(params): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    // Validate token if authentication is enabled
    let token = params.token.as_deref().unwrap_or("");
    if !qm.verify_token(token) {
        return (StatusCode::UNAUTHORIZED, "Invalid or missing token").into_response();
    }

    // Check connection limit
    if WS_CONNECTION_COUNT.load(Ordering::Relaxed) >= MAX_WS_CONNECTIONS {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "Too many WebSocket connections",
        )
            .into_response();
    }

    ws.on_upgrade(move |socket| handle_websocket(socket, qm, Some(queue)))
}

async fn handle_websocket(
    mut socket: WebSocket,
    qm: Arc<QueueManager>,
    queue_filter: Option<String>,
) {
    // Track connection
    WS_CONNECTION_COUNT.fetch_add(1, Ordering::Relaxed);

    let mut rx = qm.subscribe_events(queue_filter.clone());
    let mut ping_interval = interval(Duration::from_secs(30));
    let mut last_activity = std::time::Instant::now();
    let timeout_duration = Duration::from_secs(120);

    loop {
        // Check for timeout
        if last_activity.elapsed() > timeout_duration {
            break;
        }

        tokio::select! {
            // Server heartbeat - ping every 30s
            _ = ping_interval.tick() => {
                if socket.send(Message::Ping(vec![].into())).await.is_err() {
                    break;
                }
            }

            // Receive events from broadcast channel and send to WebSocket
            result = rx.recv() => {
                match result {
                    Ok(event) => {
                        // Filter by queue if specified
                        if let Some(ref filter) = queue_filter {
                            if event.queue != *filter {
                                continue;
                            }
                        }

                        // Serialize and send event
                        if let Ok(json) = serde_json::to_string(&event) {
                            if socket.send(Message::Text(json.into())).await.is_err() {
                                break; // Client disconnected
                            }
                            last_activity = std::time::Instant::now();
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        // Slow client, skip silently
                        continue;
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        break; // Channel closed
                    }
                }
            }

            // Handle incoming WebSocket messages (ping/pong, close)
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                        last_activity = std::time::Instant::now();
                    }
                    Some(Ok(Message::Pong(_))) => {
                        // Pong received, connection is alive
                        last_activity = std::time::Instant::now();
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        break; // Client closed connection
                    }
                    Some(Ok(Message::Text(_))) | Some(Ok(Message::Binary(_))) => {
                        // Ignore client messages (this is a push-only WebSocket)
                        last_activity = std::time::Instant::now();
                    }
                    Some(Err(_)) => {
                        break; // Error reading from socket
                    }
                }
            }
        }
    }

    // Untrack connection
    WS_CONNECTION_COUNT.fetch_sub(1, Ordering::Relaxed);
}

/// Dashboard update payload.
#[derive(Serialize)]
struct DashboardUpdate {
    stats: StatsResponse,
    metrics: MetricsData,
    queues: Vec<QueueInfo>,
    workers: Vec<WorkerInfo>,
    crons: Vec<CronJob>,
    metrics_history: Vec<MetricsHistoryPoint>,
    system_metrics: SystemMetrics,
    sqlite_stats: Option<SqliteStats>,
    timestamp: u64,
}

/// WebSocket handler for real-time dashboard updates.
pub async fn ws_dashboard_handler(
    State(qm): State<AppState>,
    Query(params): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let token = params.token.as_deref().unwrap_or("");
    if !qm.verify_token(token) {
        return (StatusCode::UNAUTHORIZED, "Invalid or missing token").into_response();
    }

    // Check connection limit
    if WS_CONNECTION_COUNT.load(Ordering::Relaxed) >= MAX_WS_CONNECTIONS {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "Too many WebSocket connections",
        )
            .into_response();
    }

    ws.on_upgrade(move |socket| handle_dashboard_websocket(socket, qm))
}

async fn handle_dashboard_websocket(mut socket: WebSocket, qm: Arc<QueueManager>) {
    // Track connection
    WS_CONNECTION_COUNT.fetch_add(1, Ordering::Relaxed);

    // Configurable update interval (default 2 seconds)
    let interval_ms = std::env::var("DASHBOARD_INTERVAL_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_DASHBOARD_INTERVAL_MS);

    let mut update_interval = interval(Duration::from_millis(interval_ms));
    let mut ping_interval = interval(Duration::from_secs(30));
    let mut last_activity = std::time::Instant::now();
    let timeout_duration = Duration::from_secs(120);

    loop {
        // Check for timeout
        if last_activity.elapsed() > timeout_duration {
            break;
        }

        tokio::select! {
            // Server heartbeat
            _ = ping_interval.tick() => {
                if socket.send(Message::Ping(vec![].into())).await.is_err() {
                    break;
                }
            }

            _ = update_interval.tick() => {
                // Collect all dashboard data in PARALLEL using tokio::join!
                let qm_ref = &qm;
                let (
                    stats_result,
                    metrics,
                    queues,
                    workers,
                    crons,
                ) = tokio::join!(
                    qm_ref.stats(),
                    qm_ref.get_metrics(),
                    qm_ref.list_queues(),
                    qm_ref.list_workers(),
                    qm_ref.list_crons(),
                );

                let (queued, processing, delayed, dlq, completed) = stats_result;

                // Collect metrics history (sync, fast)
                let metrics_history = qm.get_metrics_history();

                // Collect system metrics (uses cache, no process spawning)
                let system_metrics = collect_system_metrics(&qm);

                // Collect SQLite stats if enabled
                let sqlite_stats = if qm.has_storage() {
                    Some(collect_sqlite_stats(&qm, queued, processing, delayed, dlq, completed).await)
                } else {
                    None
                };

                let update = DashboardUpdate {
                    stats: StatsResponse { queued, processing, delayed, dlq, completed },
                    metrics,
                    queues,
                    workers,
                    crons,
                    metrics_history,
                    system_metrics,
                    sqlite_stats,
                    timestamp: crate::queue::QueueManager::now_ms(),
                };

                if let Ok(json) = serde_json::to_string(&update) {
                    if socket.send(Message::Text(json.into())).await.is_err() {
                        break; // Client disconnected
                    }
                    last_activity = std::time::Instant::now();
                }
            }

            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                        last_activity = std::time::Instant::now();
                    }
                    Some(Ok(Message::Pong(_))) => {
                        last_activity = std::time::Instant::now();
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Text(_))) | Some(Ok(Message::Binary(_))) => {
                        last_activity = std::time::Instant::now();
                    }
                    Some(Err(_)) => break,
                }
            }
        }
    }

    // Untrack connection
    WS_CONNECTION_COUNT.fetch_sub(1, Ordering::Relaxed);
}

/// Get current WebSocket connection count.
#[allow(dead_code)]
pub fn ws_connection_count() -> usize {
    WS_CONNECTION_COUNT.load(Ordering::Relaxed)
}

// ============================================================================
// System Metrics Collection
// ============================================================================

/// Collect system metrics for dashboard WebSocket (uses cached values).
fn collect_system_metrics(qm: &Arc<QueueManager>) -> SystemMetrics {
    let uptime = super::settings::get_uptime_seconds();
    let tcp_connections = qm.connection_count();

    // Use cached metrics (refreshes every 5 seconds, avoids process spawning)
    let (cpu_percent, memory_used, memory_total) = get_cached_system_metrics();

    SystemMetrics {
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
    }
}

/// Collect SQLite stats for dashboard WebSocket.
async fn collect_sqlite_stats(
    qm: &Arc<QueueManager>,
    queued: usize,
    processing: usize,
    delayed: usize,
    dlq: usize,
    completed: usize,
) -> SqliteStats {
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

    SqliteStats {
        enabled: true,
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
    }
}

// ============================================================================
// Platform-specific CPU metrics (implementation - called by cache)
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
        if let Ok(stat) = std::fs::read_to_string("/proc/self/stat") {
            let parts: Vec<&str> = stat.split_whitespace().collect();
            if parts.len() > 14 {
                let utime: f64 = parts[13].parse().unwrap_or(0.0);
                let stime: f64 = parts[14].parse().unwrap_or(0.0);
                let total_time = utime + stime;
                let uptime = super::settings::get_uptime_seconds() as f64;
                if uptime > 0.0 {
                    let clock_ticks = 100.0;
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
// Platform-specific Memory metrics (implementation - called by cache)
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
        let pid = std::process::id();
        if let Ok(output) = Command::new("ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .output()
        {
            if let Ok(rss_str) = String::from_utf8(output.stdout) {
                let rss_kb: f64 = rss_str.trim().parse().unwrap_or(0.0);
                let used_mb = rss_kb / 1024.0;

                if let Ok(total_output) = Command::new("sysctl").args(["-n", "hw.memsize"]).output()
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
