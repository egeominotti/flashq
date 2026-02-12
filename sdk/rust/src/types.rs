use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::constants::*;

/// Client connection options.
#[derive(Debug, Clone)]
pub struct ClientOptions {
    pub host: String,
    pub port: u16,
    pub http_port: u16,
    pub token: Option<String>,
    pub timeout: Duration,
    pub use_binary: bool,
    pub auto_reconnect: bool,
    pub reconnect_delay: Duration,
    pub max_reconnect_delay: Duration,
    pub max_reconnect_attempts: u32,
    pub pool_size: usize,
}

impl Default for ClientOptions {
    fn default() -> Self {
        Self {
            host: DEFAULT_HOST.to_string(),
            port: DEFAULT_PORT,
            http_port: DEFAULT_HTTP_PORT,
            token: None,
            timeout: DEFAULT_TIMEOUT,
            use_binary: false,
            auto_reconnect: true,
            reconnect_delay: DEFAULT_RECONNECT_DELAY,
            max_reconnect_delay: DEFAULT_MAX_RECONNECT_DELAY,
            max_reconnect_attempts: DEFAULT_MAX_RECONNECT_ATTEMPTS,
            pool_size: DEFAULT_POOL_SIZE,
        }
    }
}

/// Push options for job creation.
#[derive(Debug, Clone, Default, Serialize)]
pub struct PushOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_attempts: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backoff: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unique_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depends_on: Option<Vec<u64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifo: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remove_on_complete: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remove_on_fail: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stall_timeout: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debounce_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debounce_ttl: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_completed_age: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_completed_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
}

impl PushOptions {
    /// Merge non-None fields into a JSON command object.
    pub fn merge_into(&self, cmd: &mut Value) {
        let obj = cmd.as_object_mut().expect("cmd must be an object");
        if let Ok(val) = serde_json::to_value(self) {
            if let Some(opts_obj) = val.as_object() {
                for (k, v) in opts_obj {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
    }
}

/// Job data from the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: u64,
    pub queue: String,
    pub data: Value,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub run_at: u64,
    #[serde(default)]
    pub started_at: u64,
    #[serde(default)]
    pub attempts: u32,
    #[serde(default)]
    pub max_attempts: u32,
    #[serde(default)]
    pub backoff: u64,
    #[serde(default)]
    pub ttl: u64,
    #[serde(default)]
    pub timeout: u64,
    #[serde(default)]
    pub unique_key: Option<String>,
    #[serde(default)]
    pub depends_on: Vec<u64>,
    #[serde(default)]
    pub progress: u8,
    #[serde(default)]
    pub progress_msg: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub lifo: bool,
    #[serde(default)]
    pub remove_on_complete: bool,
    #[serde(default)]
    pub remove_on_fail: bool,
    #[serde(default)]
    pub last_heartbeat: u64,
    #[serde(default)]
    pub stall_timeout: u64,
    #[serde(default)]
    pub stall_count: u32,
    #[serde(default)]
    pub parent_id: Option<u64>,
    #[serde(default)]
    pub children_ids: Vec<u64>,
    #[serde(default)]
    pub children_completed: u32,
    #[serde(default)]
    pub custom_id: Option<String>,
    #[serde(default)]
    pub keep_completed_age: u64,
    #[serde(default)]
    pub keep_completed_count: u64,
    #[serde(default)]
    pub completed_at: u64,
    #[serde(default)]
    pub group_id: Option<String>,
}

/// Job state enum matching the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobState {
    Waiting,
    Delayed,
    Active,
    Completed,
    Failed,
    #[serde(rename = "waiting-children")]
    WaitingChildren,
    #[serde(rename = "waiting-parent")]
    WaitingParent,
    Stalled,
    Unknown,
}

impl std::fmt::Display for JobState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JobState::Waiting => write!(f, "waiting"),
            JobState::Delayed => write!(f, "delayed"),
            JobState::Active => write!(f, "active"),
            JobState::Completed => write!(f, "completed"),
            JobState::Failed => write!(f, "failed"),
            JobState::WaitingChildren => write!(f, "waiting-children"),
            JobState::WaitingParent => write!(f, "waiting-parent"),
            JobState::Stalled => write!(f, "stalled"),
            JobState::Unknown => write!(f, "unknown"),
        }
    }
}

/// Job with its current state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobWithState {
    pub job: Job,
    pub state: JobState,
}

/// Batch push result.
#[derive(Debug, Clone)]
pub struct BatchPushResult {
    pub ids: Vec<u64>,
}

/// Job counts by state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobCounts {
    #[serde(default)]
    pub waiting: u64,
    #[serde(default)]
    pub active: u64,
    #[serde(default)]
    pub delayed: u64,
    #[serde(default)]
    pub completed: u64,
    #[serde(default)]
    pub failed: u64,
}

/// Jobs list result with total count.
#[derive(Debug, Clone)]
pub struct JobsResult {
    pub jobs: Vec<JobWithState>,
    pub total: u64,
}

/// Queue info from LISTQUEUES.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueInfo {
    pub name: String,
    #[serde(default)]
    pub pending: u64,
    #[serde(default)]
    pub processing: u64,
    #[serde(default)]
    pub completed: u64,
    #[serde(default)]
    pub delayed: u64,
    #[serde(default)]
    pub dlq: u64,
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub rate_limit: Option<u32>,
    #[serde(default)]
    pub concurrency_limit: Option<u32>,
}

/// Log entry for a job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: u64,
    pub message: String,
    pub level: String,
}

/// Progress info for a job.
#[derive(Debug, Clone)]
pub struct ProgressInfo {
    pub progress: u8,
    pub message: Option<String>,
}

/// Cron job options for creating a cron.
#[derive(Debug, Clone, Default)]
pub struct CronOptions {
    pub queue: String,
    pub data: Value,
    pub schedule: Option<String>,
    pub repeat_every: Option<u64>,
    pub priority: Option<i32>,
    pub limit: Option<u64>,
}

/// Cron job info from the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronJob {
    pub name: String,
    pub queue: String,
    pub data: Value,
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub repeat_every: Option<u64>,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub next_run: u64,
    #[serde(default)]
    pub executions: u64,
    #[serde(default)]
    pub limit: Option<u64>,
}

/// Flow child definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowChild {
    pub queue: String,
    pub data: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay: Option<u64>,
}

/// Flow push result.
#[derive(Debug, Clone)]
pub struct FlowResult {
    pub parent_id: u64,
    pub children_ids: Vec<u64>,
}

/// Queue statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stats {
    #[serde(default)]
    pub queued: u64,
    #[serde(default)]
    pub processing: u64,
    #[serde(default)]
    pub delayed: u64,
    #[serde(default)]
    pub dlq: u64,
}

/// Detailed metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metrics {
    #[serde(default)]
    pub total_pushed: u64,
    #[serde(default)]
    pub total_completed: u64,
    #[serde(default)]
    pub total_failed: u64,
    #[serde(default)]
    pub jobs_per_second: f64,
    #[serde(default)]
    pub avg_latency_ms: f64,
    #[serde(default)]
    pub queues: Vec<QueueMetrics>,
}

/// Per-queue metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueMetrics {
    pub name: String,
    #[serde(default)]
    pub pending: u64,
    #[serde(default)]
    pub processing: u64,
    #[serde(default)]
    pub dlq: u64,
    #[serde(default)]
    pub rate_limit: Option<u32>,
}

/// Worker options.
#[derive(Debug, Clone)]
pub struct WorkerOptions {
    pub concurrency: usize,
    pub batch_size: usize,
    pub auto_start: bool,
    pub close_timeout: Duration,
    pub stall_timeout: Duration,
    pub client_options: Option<ClientOptions>,
}

impl Default for WorkerOptions {
    fn default() -> Self {
        Self {
            concurrency: DEFAULT_WORKER_CONCURRENCY,
            batch_size: DEFAULT_WORKER_BATCH_SIZE,
            auto_start: true,
            close_timeout: DEFAULT_WORKER_CLOSE_TIMEOUT,
            stall_timeout: Duration::from_secs(30),
            client_options: None,
        }
    }
}

/// Batch job input for push_batch.
#[derive(Debug, Clone, Serialize)]
pub struct JobPayload {
    pub data: Value,
    #[serde(flatten)]
    pub options: PushOptions,
}

/// Worker event types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WorkerEvent {
    Ready,
    Active,
    Completed,
    Failed,
    Error,
    Stopping,
    Stopped,
    Drained,
}

/// Bulk job for Queue.add_bulk.
#[derive(Debug, Clone)]
pub struct BulkJob {
    pub name: String,
    pub data: Value,
    pub options: Option<PushOptions>,
}
