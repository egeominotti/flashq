//! Job builder pattern for flashQ.
//!
//! Provides ergonomic API for creating jobs with many optional parameters.
//! Usage:
//!   JobBuilder::new("queue", json!({"task": "data"}))
//!       .priority(10)
//!       .delay(5000)
//!       .max_attempts(3)
//!       .build(job_id, now_ms)

use serde_json::Value;

use super::{next_id, Job};

/// Builder for creating Job instances with ergonomic API.
/// Replaces 20+ parameter functions with fluent chained calls.
#[derive(Debug, Clone, Default)]
pub struct JobBuilder {
    queue: String,
    data: Value,
    priority: i32,
    delay: Option<u64>,
    ttl: Option<u64>,
    timeout: Option<u64>,
    max_attempts: Option<u32>,
    backoff: Option<u64>,
    unique_key: Option<String>,
    depends_on: Option<Vec<u64>>,
    tags: Option<Vec<String>>,
    lifo: bool,
    remove_on_complete: bool,
    remove_on_fail: bool,
    stall_timeout: Option<u64>,
    custom_id: Option<String>,
    keep_completed_age: Option<u64>,
    keep_completed_count: Option<usize>,
}

#[allow(dead_code)]
impl JobBuilder {
    /// Create a new JobBuilder with required queue and data.
    #[inline]
    pub fn new(queue: impl Into<String>, data: Value) -> Self {
        Self {
            queue: queue.into(),
            data,
            ..Default::default()
        }
    }

    /// Set job priority (higher = processed first). Default: 0
    #[inline]
    pub fn priority(mut self, priority: i32) -> Self {
        self.priority = priority;
        self
    }

    /// Set delay in milliseconds before job becomes available. Default: None (immediate)
    #[inline]
    pub fn delay(mut self, delay: u64) -> Self {
        self.delay = Some(delay);
        self
    }

    /// Set optional delay (None = immediate)
    #[inline]
    pub fn delay_opt(mut self, delay: Option<u64>) -> Self {
        self.delay = delay;
        self
    }

    /// Set TTL in milliseconds (job expires after this). Default: None (no expiration)
    #[inline]
    pub fn ttl(mut self, ttl: u64) -> Self {
        self.ttl = Some(ttl);
        self
    }

    /// Set optional TTL
    #[inline]
    pub fn ttl_opt(mut self, ttl: Option<u64>) -> Self {
        self.ttl = ttl;
        self
    }

    /// Set processing timeout in milliseconds. Default: None (no timeout)
    #[inline]
    pub fn timeout(mut self, timeout: u64) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// Set optional timeout
    #[inline]
    pub fn timeout_opt(mut self, timeout: Option<u64>) -> Self {
        self.timeout = timeout;
        self
    }

    /// Set max retry attempts before moving to DLQ. Default: None (infinite)
    #[inline]
    pub fn max_attempts(mut self, attempts: u32) -> Self {
        self.max_attempts = Some(attempts);
        self
    }

    /// Set optional max attempts
    #[inline]
    pub fn max_attempts_opt(mut self, attempts: Option<u32>) -> Self {
        self.max_attempts = attempts;
        self
    }

    /// Set backoff base in milliseconds for exponential retry. Default: None
    #[inline]
    pub fn backoff(mut self, backoff: u64) -> Self {
        self.backoff = Some(backoff);
        self
    }

    /// Set optional backoff
    #[inline]
    pub fn backoff_opt(mut self, backoff: Option<u64>) -> Self {
        self.backoff = backoff;
        self
    }

    /// Set unique key for deduplication. Default: None
    #[inline]
    pub fn unique_key(mut self, key: impl Into<String>) -> Self {
        self.unique_key = Some(key.into());
        self
    }

    /// Set optional unique key
    #[inline]
    pub fn unique_key_opt(mut self, key: Option<String>) -> Self {
        self.unique_key = key;
        self
    }

    /// Set job dependencies (IDs of jobs that must complete first). Default: None
    #[inline]
    pub fn depends_on(mut self, deps: Vec<u64>) -> Self {
        self.depends_on = Some(deps);
        self
    }

    /// Set optional dependencies
    #[inline]
    pub fn depends_on_opt(mut self, deps: Option<Vec<u64>>) -> Self {
        self.depends_on = deps;
        self
    }

    /// Set job tags for filtering. Default: None
    #[inline]
    pub fn tags(mut self, tags: Vec<String>) -> Self {
        self.tags = Some(tags);
        self
    }

    /// Set optional tags
    #[inline]
    pub fn tags_opt(mut self, tags: Option<Vec<String>>) -> Self {
        self.tags = tags;
        self
    }

    /// Enable LIFO mode (last in, first out). Default: false
    #[inline]
    pub fn lifo(mut self, lifo: bool) -> Self {
        self.lifo = lifo;
        self
    }

    /// Don't store job after completion. Default: false
    #[inline]
    pub fn remove_on_complete(mut self, remove: bool) -> Self {
        self.remove_on_complete = remove;
        self
    }

    /// Don't store job in DLQ after failure. Default: false
    #[inline]
    pub fn remove_on_fail(mut self, remove: bool) -> Self {
        self.remove_on_fail = remove;
        self
    }

    /// Set stall detection timeout in milliseconds. Default: None (30s default)
    #[inline]
    pub fn stall_timeout(mut self, timeout: u64) -> Self {
        self.stall_timeout = Some(timeout);
        self
    }

    /// Set optional stall timeout
    #[inline]
    pub fn stall_timeout_opt(mut self, timeout: Option<u64>) -> Self {
        self.stall_timeout = timeout;
        self
    }

    /// Set custom job ID for idempotency. Default: None
    #[inline]
    pub fn custom_id(mut self, id: impl Into<String>) -> Self {
        self.custom_id = Some(id.into());
        self
    }

    /// Set optional custom ID
    #[inline]
    pub fn custom_id_opt(mut self, id: Option<String>) -> Self {
        self.custom_id = id;
        self
    }

    /// Set retention: keep completed job for N milliseconds. Default: None
    #[inline]
    pub fn keep_completed_age(mut self, age: u64) -> Self {
        self.keep_completed_age = Some(age);
        self
    }

    /// Set optional retention age
    #[inline]
    pub fn keep_completed_age_opt(mut self, age: Option<u64>) -> Self {
        self.keep_completed_age = age;
        self
    }

    /// Set retention: keep job in last N completed. Default: None
    #[inline]
    pub fn keep_completed_count(mut self, count: usize) -> Self {
        self.keep_completed_count = Some(count);
        self
    }

    /// Set optional retention count
    #[inline]
    pub fn keep_completed_count_opt(mut self, count: Option<usize>) -> Self {
        self.keep_completed_count = count;
        self
    }

    /// Build the Job with the given ID and current timestamp.
    #[inline]
    pub fn build(self, id: u64, now: u64) -> Job {
        Job {
            id,
            queue: self.queue,
            data: self.data,
            priority: self.priority,
            created_at: now,
            run_at: self.delay.map_or(now, |d| now + d),
            started_at: 0,
            attempts: 0,
            max_attempts: self.max_attempts.unwrap_or(0),
            backoff: self.backoff.unwrap_or(0),
            ttl: self.ttl.unwrap_or(0),
            timeout: self.timeout.unwrap_or(0),
            unique_key: self.unique_key,
            depends_on: self.depends_on.unwrap_or_default(),
            progress: 0,
            progress_msg: None,
            tags: self.tags.unwrap_or_default(),
            lifo: self.lifo,
            remove_on_complete: self.remove_on_complete,
            remove_on_fail: self.remove_on_fail,
            last_heartbeat: 0,
            stall_timeout: self.stall_timeout.unwrap_or(0),
            stall_count: 0,
            parent_id: None,
            children_ids: Vec::new(),
            children_completed: 0,
            custom_id: self.custom_id,
            keep_completed_age: self.keep_completed_age.unwrap_or(0),
            keep_completed_count: self.keep_completed_count.unwrap_or(0),
            completed_at: 0,
        }
    }

    /// Build the Job with auto-generated ID (uses the global counter).
    #[inline]
    pub fn build_with_auto_id(self, now: u64) -> Job {
        self.build(next_id(), now)
    }
}
