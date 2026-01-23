//! WebSocket HTTP handlers.

use std::sync::atomic::{AtomicUsize, Ordering};
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
use serde::Serialize;
use tokio::sync::broadcast;
use tokio::time::interval;

use crate::protocol::{CronJob, MetricsData, MetricsHistoryPoint, QueueInfo, WorkerInfo};
use crate::queue::QueueManager;

use super::settings::{get_total_memory_mb, refresh_process_metrics, SystemMetrics};
use super::types::{AppState, StatsResponse, WsQuery};

/// Maximum concurrent WebSocket connections
const MAX_WS_CONNECTIONS: usize = 100;

/// Dashboard update interval in milliseconds (configurable via DASHBOARD_INTERVAL_MS env var)
/// Increased to 3 seconds for better performance during high-load scenarios
const DEFAULT_DASHBOARD_INTERVAL_MS: u64 = 3000;

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

                // Collect system metrics using sysinfo (no shell spawning)
                let system_metrics = collect_system_metrics(&qm);

                let update = DashboardUpdate {
                    stats: StatsResponse { queued, processing, delayed, dlq, completed },
                    metrics,
                    queues,
                    workers,
                    crons,
                    metrics_history,
                    system_metrics,
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
// System Metrics Collection (using sysinfo)
// ============================================================================

/// Collect system metrics for dashboard WebSocket using sysinfo crate.
fn collect_system_metrics(qm: &Arc<QueueManager>) -> SystemMetrics {
    let uptime = super::settings::get_uptime_seconds();
    let tcp_connections = qm.connection_count();
    let pid = std::process::id();

    // Use sysinfo via shared refresh_process_metrics
    let pm = refresh_process_metrics();
    let total_memory_mb = get_total_memory_mb();
    let memory_percent = if total_memory_mb > 0.0 {
        (pm.memory_rss_mb / total_memory_mb) * 100.0
    } else {
        0.0
    };

    SystemMetrics {
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
    }
}
