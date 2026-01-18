//! Core protocol types for flashQ.
//!
//! Contains Job, JobState, and related data structures.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Job state enum - similar to BullMQ states
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobState {
    Waiting,         // In queue, ready to be processed
    Delayed,         // In queue, but run_at is in the future
    Active,          // Currently being processed
    Completed,       // Successfully completed
    Failed,          // In DLQ after max_attempts
    WaitingChildren, // Waiting for dependencies to complete
    WaitingParent,   // Parent waiting for children to complete (Flows)
    Stalled,         // Job is stalled (no heartbeat)
    Unknown,         // Job not found or state cannot be determined
}

/// Job log entry for debugging
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobLogEntry {
    pub timestamp: u64,
    pub message: String,
    pub level: String, // "info", "warn", "error", "debug"
}

/// Flow child definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowChild {
    pub queue: String,
    pub data: Value,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub delay: Option<u64>,
}

/// Flow result
#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)]
pub struct FlowResult {
    pub parent_id: u64,
    pub children_ids: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: u64,
    pub queue: String,
    /// Job payload data. Wrapped in Arc for cheap cloning (avoids copying large JSON).
    pub data: Arc<Value>,
    pub priority: i32,
    pub created_at: u64,
    pub run_at: u64,
    #[serde(default)]
    pub started_at: u64, // When job started processing
    #[serde(default)]
    pub attempts: u32,
    #[serde(default)]
    pub max_attempts: u32, // 0 = infinite
    #[serde(default)]
    pub backoff: u64, // Base backoff ms
    #[serde(default)]
    pub ttl: u64, // 0 = no expiration
    #[serde(default)]
    pub timeout: u64, // 0 = no timeout
    #[serde(default)]
    pub unique_key: Option<String>,
    #[serde(default)]
    pub depends_on: Vec<u64>,
    #[serde(default)]
    pub progress: u8,
    #[serde(default)]
    pub progress_msg: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>, // Job tags for filtering
    #[serde(default)]
    pub lifo: bool, // LIFO mode: last in, first out
    // === New fields for BullMQ-like features ===
    #[serde(default)]
    pub remove_on_complete: bool, // Don't store in completed_jobs after ACK
    #[serde(default)]
    pub remove_on_fail: bool, // Don't store in DLQ after failure
    #[serde(default)]
    pub last_heartbeat: u64, // Last heartbeat from worker (for stall detection)
    #[serde(default)]
    pub stall_timeout: u64, // Stall detection timeout in ms (0 = disabled, default 30s)
    #[serde(default)]
    pub stall_count: u32, // Number of times job was marked as stalled
    // === Flow (Parent-Child) fields ===
    #[serde(default)]
    pub parent_id: Option<u64>, // Parent job ID (for child jobs in flows)
    #[serde(default)]
    pub children_ids: Vec<u64>, // Child job IDs (for parent jobs in flows)
    #[serde(default)]
    pub children_completed: u32, // Number of children that completed
    // === Custom ID and Retention ===
    #[serde(default)]
    pub custom_id: Option<String>, // User-provided custom job ID
    #[serde(default)]
    pub keep_completed_age: u64, // Keep completed job for N ms (0 = use default)
    #[serde(default)]
    pub keep_completed_count: usize, // Keep in last N completed (0 = use default)
    #[serde(default)]
    pub completed_at: u64, // When job was completed (for retention)
    // === Group Support ===
    #[serde(default)]
    pub group_id: Option<String>, // Group ID for FIFO processing within group
}

impl Job {
    #[inline(always)]
    pub fn is_ready(&self, now: u64) -> bool {
        self.run_at <= now
    }

    /// Check if job has expired (TTL). Uses saturating_sub to prevent overflow.
    #[inline(always)]
    pub fn is_expired(&self, now: u64) -> bool {
        self.ttl > 0 && now.saturating_sub(self.created_at) > self.ttl
    }

    /// Check if job has timed out. Uses saturating_sub to prevent overflow.
    #[inline(always)]
    pub fn is_timed_out(&self, now: u64) -> bool {
        self.timeout > 0
            && self.started_at > 0
            && now.saturating_sub(self.started_at) > self.timeout
    }

    #[inline(always)]
    pub fn should_go_to_dlq(&self) -> bool {
        self.max_attempts > 0 && self.attempts >= self.max_attempts
    }

    #[inline(always)]
    pub fn next_backoff(&self) -> u64 {
        if self.backoff == 0 {
            return 0;
        }
        // Exponential backoff: base * 2^attempts
        self.backoff * (1 << self.attempts.min(10))
    }
}

impl Eq for Job {}

impl PartialEq for Job {
    #[inline(always)]
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl Ord for Job {
    #[inline(always)]
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Higher priority = greater (popped first from max-heap)
        // Earlier run_at = greater (popped first for delayed jobs)
        // LIFO: higher ID = greater (newer jobs first)
        // FIFO: lower ID = greater (older jobs first)
        self.priority
            .cmp(&other.priority)
            .then_with(|| other.run_at.cmp(&self.run_at))
            .then_with(|| {
                if self.lifo || other.lifo {
                    // LIFO: prefer higher ID (newer)
                    self.id.cmp(&other.id)
                } else {
                    // FIFO: prefer lower ID (older)
                    other.id.cmp(&self.id)
                }
            })
    }
}

impl PartialOrd for Job {
    #[inline(always)]
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Job with its current state (for browser/API)
#[derive(Debug, Clone, Serialize)]
pub struct JobBrowserItem {
    #[serde(flatten)]
    pub job: Job,
    pub state: JobState,
}

/// Historical metrics point for charts
#[derive(Debug, Clone, Serialize)]
pub struct MetricsHistoryPoint {
    pub timestamp: u64,
    pub queued: usize,
    pub processing: usize,
    pub completed: u64,
    pub failed: u64,
    pub throughput: f64,
    pub latency_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronJob {
    pub name: String,
    pub queue: String,
    pub data: Value,
    #[serde(default)]
    pub schedule: Option<String>, // Cron expression (optional if repeat_every is set)
    #[serde(default)]
    pub repeat_every: Option<u64>, // Repeat every N ms (alternative to schedule)
    pub priority: i32,
    pub next_run: u64,
    #[serde(default)]
    pub executions: u64, // Number of times this job has been executed
    #[serde(default)]
    pub limit: Option<u64>, // Max executions (None = infinite)
}

#[derive(Debug, Clone, Serialize)]
pub struct MetricsData {
    pub total_pushed: u64,
    pub total_completed: u64,
    pub total_failed: u64,
    pub jobs_per_second: f64,
    pub avg_latency_ms: f64,
    pub queues: Vec<QueueMetrics>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueueMetrics {
    pub name: String,
    pub pending: usize,
    pub processing: usize,
    pub dlq: usize,
    pub rate_limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProgressInfo {
    pub id: u64,
    pub progress: u8,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueueInfo {
    pub name: String,
    pub pending: usize,
    pub processing: usize,
    pub dlq: usize,
    pub paused: bool,
    pub rate_limit: Option<u32>,
    pub concurrency_limit: Option<u32>,
}

// === Worker Registration ===

#[derive(Debug, Clone, Serialize)]
pub struct WorkerInfo {
    pub id: String,
    pub queues: Vec<String>,
    pub concurrency: u32,
    pub last_heartbeat: u64,
    pub jobs_processed: u64,
}

// === Webhooks ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookConfig {
    pub id: String,
    pub url: String,
    pub events: Vec<String>, // "job.completed", "job.failed", "job.progress"
    pub queue: Option<String>, // Filter by queue, None = all queues
    pub secret: Option<String>, // HMAC signing secret
    pub created_at: u64,
}

// === Events (for SSE/WebSocket) ===

#[derive(Debug, Clone, Serialize)]
pub struct JobEvent {
    pub event_type: String, // "completed", "failed", "progress", "pushed"
    pub queue: String,
    pub job_id: u64,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<u8>,
}
