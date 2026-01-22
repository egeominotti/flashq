//! Deadlock detection tests - modular organization.
//!
//! Split into focused modules:
//! - basic: Lock ordering tests
//! - cleanup: Background cleanup task tests
//! - batch: Batch operation tests
//! - stress: Heavy load tests

use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::time::timeout;

/// Short timeout for basic deadlock detection
pub const TIMEOUT_SHORT: Duration = Duration::from_secs(2);
/// Extended timeout for stress tests
pub const TIMEOUT_STRESS: Duration = Duration::from_secs(10);

/// Run concurrent tasks and detect deadlock via timeout.
pub async fn run_concurrent<F, Fut>(
    timeout_duration: Duration,
    task_count: usize,
    task_fn: F,
) -> bool
where
    F: Fn(usize) -> Fut + Send + Sync + Clone + 'static,
    Fut: std::future::Future<Output = ()> + Send,
{
    let result = timeout(timeout_duration, async {
        let handles: Vec<_> = (0..task_count)
            .map(|i| {
                let f = task_fn.clone();
                tokio::spawn(async move { f(i).await })
            })
            .collect();
        for h in handles {
            let _ = h.await;
        }
    })
    .await;
    result.is_ok()
}

/// Counter for tracking operations in stress tests.
#[derive(Default)]
pub struct OpsCounter(AtomicUsize);

impl OpsCounter {
    pub fn new() -> Self {
        Self(AtomicUsize::new(0))
    }
    pub fn inc(&self) {
        self.0.fetch_add(1, Ordering::Relaxed);
    }
    pub fn get(&self) -> usize {
        self.0.load(Ordering::Relaxed)
    }
}

mod basic;
mod batch;
mod cleanup;
mod regression;
mod stress;
