//! Miscellaneous types: Subscriber, Worker, SnapshotConfig, CircuitBreaker, Webhook.

use compact_str::CompactString;

use super::time::now_ms;

// ============== Subscriber ==============

#[derive(Clone)]
pub struct Subscriber {
    pub queue: CompactString,
    pub events: Vec<String>,
    pub tx: tokio::sync::mpsc::UnboundedSender<String>,
}

// ============== Worker ==============

pub struct Worker {
    pub id: String,
    pub queues: Vec<String>,
    pub concurrency: u32,
    pub last_heartbeat: u64,
    pub jobs_processed: u64,
}

impl Worker {
    pub fn new(id: String, queues: Vec<String>, concurrency: u32) -> Self {
        Self {
            id,
            queues,
            concurrency,
            last_heartbeat: now_ms(),
            jobs_processed: 0,
        }
    }
}

// ============== Snapshot Config ==============

#[allow(dead_code)]
pub struct SnapshotConfig {
    pub interval_secs: u64,
    pub min_changes: u64,
}

impl SnapshotConfig {
    #[allow(dead_code)]
    pub fn from_env() -> Option<Self> {
        let enabled = std::env::var("SNAPSHOT_MODE")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(false);

        if !enabled {
            return None;
        }

        let interval_secs = std::env::var("SNAPSHOT_INTERVAL")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60);

        let min_changes = std::env::var("SNAPSHOT_MIN_CHANGES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(100);

        Some(Self {
            interval_secs,
            min_changes,
        })
    }
}

// ============== Circuit Breaker ==============

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Debug)]
pub struct CircuitBreakerEntry {
    pub state: CircuitState,
    pub failures: u32,
    pub successes: u32,
    pub last_failure_at: u64,
    pub opened_at: u64,
}

impl Default for CircuitBreakerEntry {
    fn default() -> Self {
        Self {
            state: CircuitState::Closed,
            failures: 0,
            successes: 0,
            last_failure_at: 0,
            opened_at: 0,
        }
    }
}

impl CircuitBreakerEntry {
    pub fn should_allow(&self, now: u64, recovery_timeout_ms: u64) -> bool {
        match self.state {
            CircuitState::Closed => true,
            CircuitState::HalfOpen => true,
            CircuitState::Open => now >= self.opened_at + recovery_timeout_ms,
        }
    }

    pub fn record_success(&mut self) {
        match self.state {
            CircuitState::Closed => {
                self.failures = 0;
            }
            CircuitState::HalfOpen => {
                self.successes += 1;
                if self.successes >= 2 {
                    self.state = CircuitState::Closed;
                    self.failures = 0;
                    self.successes = 0;
                }
            }
            CircuitState::Open => {}
        }
    }

    pub fn record_failure(&mut self, now: u64, failure_threshold: u32) {
        self.failures += 1;
        self.last_failure_at = now;

        match self.state {
            CircuitState::Closed => {
                if self.failures >= failure_threshold {
                    self.state = CircuitState::Open;
                    self.opened_at = now;
                }
            }
            CircuitState::HalfOpen => {
                self.state = CircuitState::Open;
                self.opened_at = now;
                self.successes = 0;
            }
            CircuitState::Open => {
                self.opened_at = now;
            }
        }
    }

    pub fn try_half_open(&mut self, now: u64, recovery_timeout_ms: u64) -> bool {
        if self.state == CircuitState::Open && now >= self.opened_at + recovery_timeout_ms {
            self.state = CircuitState::HalfOpen;
            self.successes = 0;
            true
        } else {
            false
        }
    }
}

pub struct CircuitBreakerConfig {
    pub failure_threshold: u32,
    pub recovery_timeout_ms: u64,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 5,
            recovery_timeout_ms: 30_000,
        }
    }
}

// ============== Webhook ==============

pub struct Webhook {
    pub id: String,
    pub url: String,
    pub events: Vec<String>,
    pub queue: Option<String>,
    pub secret: Option<String>,
    pub created_at: u64,
}

impl Webhook {
    pub fn new(
        id: String,
        url: String,
        events: Vec<String>,
        queue: Option<String>,
        secret: Option<String>,
    ) -> Self {
        Self {
            id,
            url,
            events,
            queue,
            secret,
            created_at: now_ms(),
        }
    }
}
