//! NATS JetStream storage backend for flashQ.
//!
//! Provides distributed persistence using NATS JetStream with:
//! - Priority-based streams (high/normal/low)
//! - KV stores for job metadata, results, and state
//! - Leader election for singleton background tasks
//! - Horizontal scaling across multiple flashQ instances
//!
//! ## Architecture
//!
//! ```text
//! STREAMS:
//!   flashq.{queue}.priority.high   (priority >= 5)
//!   flashq.{queue}.priority.normal (priority 0-4)
//!   flashq.{queue}.priority.low    (priority < 0)
//!   flashq.{queue}.delayed         (delayed jobs)
//!   flashq.{queue}.dlq             (dead letter queue)
//!
//! KV STORES:
//!   flashq-jobs      (job metadata)
//!   flashq-results   (job results)
//!   flashq-state     (queue state, limits)
//!   flashq-custom-ids (idempotency lookup)
//!   flashq-progress  (job progress)
//! ```

#[allow(dead_code, unused_variables)]
mod ack;
#[allow(dead_code, unused_variables)]
mod config;
#[allow(dead_code, unused_variables)]
mod connection;
#[allow(dead_code, unused_variables)]
mod kv;
#[allow(dead_code, unused_variables)]
mod leader;
#[allow(dead_code, unused_variables)]
pub mod pull;
#[allow(dead_code, unused_variables)]
mod push;
#[allow(dead_code, unused_variables)]
mod scheduler;
#[allow(dead_code, unused_variables)]
mod storage;
#[allow(dead_code, unused_variables)]
mod streams;

// Public exports for integration with QueueManager
#[allow(unused_imports)]
pub use config::NatsConfig;
#[allow(unused_imports)]
pub use connection::{NatsConnection, NatsError};
#[allow(unused_imports)]
pub use storage::NatsStorage;

#[cfg(test)]
mod tests;
