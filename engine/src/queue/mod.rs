//! Queue module - job queue management with sharding and persistence.
//!
//! ## Module Organization
//!
//! - `manager.rs` - Core QueueManager struct, constructors, shard helpers
//! - `types/` - IndexedPriorityQueue, RateLimiter, Shard, GlobalMetrics, etc.
//! - `sqlite/` - SQLite embedded persistence with S3 backup
//! - `background/` - Background tasks (cleanup, cron, timeout, snapshots)
//!
//! ### Core operations
//!
//! - `validation.rs` - Input validation and size limits
//! - `push.rs` - Push and push_batch operations
//! - `pull.rs` - Pull and pull_batch operations
//! - `ack.rs` - Ack, ack_batch, fail, and get_result operations
//!
//! ### Manager modules
//!
//! - `persistence.rs` - SQLite persistence methods (persist_*)
//! - `query.rs` - Job query operations (get_job, get_state, wait_for_job)
//! - `admin.rs` - Admin operations (workers, webhooks, settings, reset)
//!
//! ### Feature modules
//!
//! - `dlq.rs` - Dead letter queue operations
//! - `rate_limit.rs` - Rate limiting and concurrency control
//! - `queue_control.rs` - Pause, resume, list queues
//! - `cron.rs` - Cron/repeatable job scheduling
//! - `job_ops.rs` - Job operations (cancel, progress, priority, etc.)
//! - `flows.rs` - Parent-child job workflows
//! - `monitoring.rs` - Metrics, stats, stalled job detection
//! - `logs.rs` - Job logging
//! - `browser.rs` - Job browser (list, filter, clean, drain, obliterate)

mod background;
mod manager;
pub mod sqlite;
pub mod types;

// Core operations (split from core.rs)
mod ack;
mod pull;
mod push;
mod validation;

// Manager modules (split from manager.rs)
mod admin;
mod persistence;
mod query;
mod settings;
mod webhooks;

// Feature modules (split from features.rs)
mod browser;
mod cron;
mod dlq;
mod flows;
mod job_ops;
mod kv;
mod logs;
pub mod monitoring;
mod pubsub;
mod queue_control;
mod rate_limit;

#[cfg(test)]
mod tests;

pub use manager::QueueManager;
