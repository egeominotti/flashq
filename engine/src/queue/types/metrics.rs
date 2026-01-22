//! Global metrics with atomic counters for O(1) stats queries.
//!
//! Instead of iterating all 32 shards to count jobs (O(n)),
//! we maintain atomic counters updated on push/pull/ack/fail.

use std::sync::atomic::{AtomicU64, Ordering};

use super::time::now_ms;

pub struct GlobalMetrics {
    pub total_pushed: AtomicU64,
    pub total_completed: AtomicU64,
    pub total_failed: AtomicU64,
    pub total_timed_out: AtomicU64,
    pub latency_sum: AtomicU64,
    pub latency_count: AtomicU64,
    // === O(1) Stats Counters ===
    pub current_queued: AtomicU64,
    pub current_processing: AtomicU64,
    pub current_dlq: AtomicU64,
    // === Throughput Tracking ===
    pub throughput_window_count: AtomicU64,
    pub throughput_window_start: AtomicU64,
    pub throughput_per_second_x100: AtomicU64,
}

impl GlobalMetrics {
    pub fn new() -> Self {
        Self {
            total_pushed: AtomicU64::new(0),
            total_completed: AtomicU64::new(0),
            total_failed: AtomicU64::new(0),
            total_timed_out: AtomicU64::new(0),
            latency_sum: AtomicU64::new(0),
            latency_count: AtomicU64::new(0),
            current_queued: AtomicU64::new(0),
            current_processing: AtomicU64::new(0),
            current_dlq: AtomicU64::new(0),
            throughput_window_count: AtomicU64::new(0),
            throughput_window_start: AtomicU64::new(now_ms()),
            throughput_per_second_x100: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record_push(&self, count: u64) {
        self.total_pushed.fetch_add(count, Ordering::Relaxed);
        self.current_queued.fetch_add(count, Ordering::Relaxed);
    }

    #[inline(always)]
    pub fn record_pull(&self) {
        self.current_queued.fetch_sub(1, Ordering::Relaxed);
        self.current_processing.fetch_add(1, Ordering::Relaxed);
    }

    #[inline(always)]
    pub fn record_complete(&self, latency: u64) {
        self.total_completed.fetch_add(1, Ordering::Relaxed);
        self.latency_sum.fetch_add(latency, Ordering::Relaxed);
        self.latency_count.fetch_add(1, Ordering::Relaxed);
        self.current_processing.fetch_sub(1, Ordering::Relaxed);
        self.throughput_window_count.fetch_add(1, Ordering::Relaxed);
    }

    /// Calculate and return current throughput (jobs per second)
    pub fn get_throughput(&self) -> f64 {
        let now = now_ms();
        let window_start = self.throughput_window_start.load(Ordering::Relaxed);
        let window_count = self.throughput_window_count.load(Ordering::Relaxed);
        let elapsed_ms = now.saturating_sub(window_start);

        if elapsed_ms >= 1000 {
            let throughput = if elapsed_ms > 0 {
                (window_count as f64 * 1000.0) / elapsed_ms as f64
            } else {
                0.0
            };
            self.throughput_per_second_x100
                .store((throughput * 100.0) as u64, Ordering::Relaxed);
            self.throughput_window_start.store(now, Ordering::Relaxed);
            self.throughput_window_count.store(0, Ordering::Relaxed);
            throughput
        } else if elapsed_ms > 0 {
            (window_count as f64 * 1000.0) / elapsed_ms as f64
        } else {
            self.throughput_per_second_x100.load(Ordering::Relaxed) as f64 / 100.0
        }
    }

    #[inline(always)]
    pub fn record_fail(&self) {
        self.total_failed.fetch_add(1, Ordering::Relaxed);
    }

    #[inline(always)]
    pub fn record_dlq(&self) {
        self.current_processing.fetch_sub(1, Ordering::Relaxed);
        self.current_dlq.fetch_add(1, Ordering::Relaxed);
    }

    #[inline(always)]
    pub fn record_retry(&self) {
        self.current_processing.fetch_sub(1, Ordering::Relaxed);
        self.current_queued.fetch_add(1, Ordering::Relaxed);
    }

    #[inline(always)]
    #[allow(dead_code)]
    pub fn record_dlq_remove(&self) {
        self.current_dlq.fetch_sub(1, Ordering::Relaxed);
    }

    #[inline(always)]
    #[allow(dead_code)]
    pub fn record_dlq_retry(&self) {
        self.current_dlq.fetch_sub(1, Ordering::Relaxed);
        self.current_queued.fetch_add(1, Ordering::Relaxed);
    }

    #[inline(always)]
    pub fn record_timeout(&self) {
        self.total_timed_out.fetch_add(1, Ordering::Relaxed);
    }

    #[inline(always)]
    #[allow(dead_code)]
    pub fn get_current_stats(&self) -> (u64, u64, u64) {
        (
            self.current_queued.load(Ordering::Relaxed),
            self.current_processing.load(Ordering::Relaxed),
            self.current_dlq.load(Ordering::Relaxed),
        )
    }
}

impl Default for GlobalMetrics {
    fn default() -> Self {
        Self::new()
    }
}
