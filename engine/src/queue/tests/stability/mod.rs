//! Phase 1-3 Stability Tests
//!
//! Tests for production-critical invariants:
//! - Memory growth under sustained load
//! - Background task deadlocks
//! - Job state race conditions
//! - Custom ID synchronization
//! - Timeout accuracy and stall detection
//! - Rate limiter behavior
//! - Cron scheduling precision
//! - Group FIFO guarantees
//! - Metrics accuracy

use super::*;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::timeout;

// Memory growth tests
mod memory;

// Background task deadlock tests
mod background;

// Job state race condition tests
mod races;

// Custom ID synchronization tests
mod custom_id;

// Phase 1 critical tests (additional memory bounds and race conditions)
mod phase1_critical;

// Phase 2 tests: Timeout, Stall Detection, Rate Limiter
mod phase2_tests;

// Phase 3 tests: Cron Scheduling, Group FIFO, Metrics Accuracy
mod phase3_tests;
