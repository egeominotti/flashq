//! WebSocket HTTP handlers.

use std::sync::Arc;

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
use tracing::warn;

use crate::protocol::{MetricsData, MetricsHistoryPoint, QueueInfo, WorkerInfo};
use crate::queue::QueueManager;

use super::types::{AppState, StatsResponse, WsQuery};

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

    ws.on_upgrade(move |socket| handle_websocket(socket, qm, Some(queue)))
}

async fn handle_websocket(
    mut socket: WebSocket,
    qm: Arc<QueueManager>,
    queue_filter: Option<String>,
) {
    let mut rx = qm.subscribe_events(queue_filter.clone());

    loop {
        tokio::select! {
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
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        // Missed some messages, log and continue
                        warn!(lagged = n, "WebSocket client lagged behind");
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
                    }
                    Some(Ok(Message::Pong(_))) => {
                        // Pong received, connection is alive
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        break; // Client closed connection
                    }
                    Some(Ok(Message::Text(_))) | Some(Ok(Message::Binary(_))) => {
                        // Ignore client messages (this is a push-only WebSocket)
                    }
                    Some(Err(_)) => {
                        break; // Error reading from socket
                    }
                }
            }
        }
    }
}

/// Dashboard update payload.
#[derive(Serialize)]
struct DashboardUpdate {
    stats: StatsResponse,
    metrics: MetricsData,
    queues: Vec<QueueInfo>,
    workers: Vec<WorkerInfo>,
    metrics_history: Vec<MetricsHistoryPoint>,
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

    ws.on_upgrade(move |socket| handle_dashboard_websocket(socket, qm))
}

async fn handle_dashboard_websocket(mut socket: WebSocket, qm: Arc<QueueManager>) {
    // Send updates every second
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));

    loop {
        tokio::select! {
            _ = interval.tick() => {
                // Collect all dashboard data
                let (queued, processing, delayed, dlq) = qm.stats().await;
                let metrics = qm.get_metrics().await;
                let queues = qm.list_queues().await;
                let workers = qm.list_workers().await;
                let metrics_history = qm.get_metrics_history();

                let update = DashboardUpdate {
                    stats: StatsResponse { queued, processing, delayed, dlq },
                    metrics,
                    queues,
                    workers,
                    metrics_history,
                    timestamp: crate::queue::QueueManager::now_ms(),
                };

                if let Ok(json) = serde_json::to_string(&update) {
                    if socket.send(Message::Text(json.into())).await.is_err() {
                        break; // Client disconnected
                    }
                }
            }

            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Text(_))) | Some(Ok(Message::Binary(_))) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }
}
