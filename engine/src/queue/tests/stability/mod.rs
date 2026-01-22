//! Phase 1 Critical Stability Tests
//!
//! Tests for production-critical invariants:
//! - Memory growth under sustained load
//! - Background task deadlocks
//! - Job state race conditions
//! - Custom ID synchronization

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
