//! Type definitions for flashQ queue system.
//!
//! Module organization:
//! - `indexed_priority_queue.rs` - O(log n) priority queue with indexing
//! - `time.rs` - Coarse timestamp, hash type aliases
//! - `location.rs` - Job location tracking
//! - `limiters.rs` - Rate and concurrency limiters
//! - `shard.rs` - Sharded queue storage
//! - `metrics.rs` - Global atomic metrics
//! - `misc.rs` - Subscriber, Worker, SnapshotConfig, CircuitBreaker, Webhook

mod indexed_priority_queue;
mod limiters;
mod location;
mod metrics;
mod misc;
mod shard;
mod time;

// Re-export all public types
pub use indexed_priority_queue::IndexedPriorityQueue;
pub use limiters::{ConcurrencyLimiter, QueueState, RateLimiter};
pub use location::JobLocation;
pub use metrics::GlobalMetrics;
pub use misc::{
    CircuitBreakerConfig, CircuitBreakerEntry, CircuitState, Subscriber, Webhook, Worker,
};
pub use shard::Shard;
pub use time::{cleanup_interned_strings, init_coarse_time, intern, now_ms, GxHashMap, GxHashSet};
