//! HTTP API request and response types.

use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

use crate::queue::QueueManager;

/// Shared application state.
pub type AppState = Arc<QueueManager>;

/// Push job request.
#[derive(Deserialize)]
pub struct PushRequest {
    pub data: Value,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub delay: Option<u64>,
    #[serde(default)]
    pub ttl: Option<u64>,
    #[serde(default)]
    pub timeout: Option<u64>,
    #[serde(default)]
    pub max_attempts: Option<u32>,
    #[serde(default)]
    pub backoff: Option<u64>,
    #[serde(default)]
    pub unique_key: Option<String>,
    #[serde(default)]
    pub depends_on: Option<Vec<u64>>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub lifo: bool,
    #[serde(default)]
    pub remove_on_complete: bool,
    #[serde(default)]
    pub remove_on_fail: bool,
    #[serde(default)]
    pub stall_timeout: Option<u64>,
    #[serde(default)]
    pub debounce_id: Option<String>,
    #[serde(default)]
    pub debounce_ttl: Option<u64>,
    #[serde(default)]
    pub job_id: Option<String>,
    #[serde(default)]
    pub keep_completed_age: Option<u64>,
    #[serde(default)]
    pub keep_completed_count: Option<usize>,
    #[serde(default)]
    pub group_id: Option<String>,
}

/// Acknowledge job request.
#[derive(Deserialize)]
pub struct AckRequest {
    #[serde(default)]
    pub result: Option<Value>,
}

/// Fail job request.
#[derive(Deserialize)]
pub struct FailRequest {
    #[serde(default)]
    pub error: Option<String>,
}

/// Update progress request.
#[derive(Deserialize)]
pub struct ProgressRequest {
    pub progress: u8,
    #[serde(default)]
    pub message: Option<String>,
}

/// Create cron job request.
#[derive(Deserialize)]
pub struct CronRequest {
    pub queue: String,
    pub data: Value,
    pub schedule: String,
    #[serde(default)]
    pub priority: i32,
}

/// Set rate limit request.
#[derive(Deserialize)]
pub struct RateLimitRequest {
    pub limit: u32,
}

/// Set concurrency request.
#[derive(Deserialize)]
pub struct ConcurrencyRequest {
    pub limit: u32,
}

/// Pull jobs query parameters.
#[derive(Deserialize)]
pub struct PullQuery {
    #[serde(default = "default_count")]
    pub count: usize,
}

fn default_count() -> usize {
    1
}

/// WebSocket query parameters.
#[derive(Deserialize)]
pub struct WsQuery {
    #[serde(default)]
    pub token: Option<String>,
}

/// Clean queue request.
#[derive(Deserialize)]
pub struct CleanRequest {
    pub grace: u64,
    pub state: String,
    #[serde(default)]
    pub limit: Option<usize>,
}

/// Jobs list query parameters.
#[derive(Deserialize)]
pub struct JobsQuery {
    #[serde(default)]
    pub queue: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default = "default_job_limit")]
    pub limit: usize,
    #[serde(default)]
    pub offset: usize,
}

fn default_job_limit() -> usize {
    100
}

/// Change priority request.
#[derive(Deserialize)]
pub struct ChangePriorityRequest {
    pub priority: i32,
}

/// Move to delayed request.
#[derive(Deserialize)]
pub struct MoveToDelayedRequest {
    pub delay: u64,
}

/// Worker heartbeat request.
#[derive(Deserialize)]
pub struct WorkerHeartbeatRequest {
    pub queues: Vec<String>,
    #[serde(default)]
    pub concurrency: u32,
    #[serde(default)]
    pub jobs_processed: u64,
}

/// Create webhook request.
#[derive(Deserialize)]
pub struct CreateWebhookRequest {
    pub url: String,
    pub events: Vec<String>,
    #[serde(default)]
    pub queue: Option<String>,
    #[serde(default)]
    pub secret: Option<String>,
}

/// Generic API response wrapper.
#[derive(Serialize)]
pub struct ApiResponse<T> {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Json<Self> {
        Json(Self {
            ok: true,
            data: Some(data),
            error: None,
        })
    }

    pub fn error(msg: impl Into<String>) -> Json<Self> {
        Json(Self {
            ok: false,
            data: None,
            error: Some(msg.into()),
        })
    }

    pub fn error_string(msg: String) -> Json<Self> {
        Json(Self {
            ok: false,
            data: None,
            error: Some(msg),
        })
    }
}

/// Job detail response with state and result.
#[derive(Serialize)]
pub struct JobDetailResponse {
    #[serde(flatten)]
    pub job: Option<crate::protocol::Job>,
    pub state: crate::protocol::JobState,
    pub result: Option<Value>,
}

/// Stats response.
#[derive(Serialize)]
pub struct StatsResponse {
    pub queued: usize,
    pub processing: usize,
    pub delayed: usize,
    pub dlq: usize,
}
