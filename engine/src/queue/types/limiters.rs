//! Rate and concurrency limiters.

use super::time::now_ms;

// ============== Rate Limiter ==============
// Token bucket algorithm

pub struct RateLimiter {
    pub limit: u32,
    tokens: f64,
    last_update: u64,
}

impl RateLimiter {
    pub fn new(limit: u32) -> Self {
        Self {
            limit,
            tokens: limit as f64,
            last_update: now_ms(),
        }
    }

    #[inline]
    pub fn try_acquire(&mut self) -> bool {
        let now = now_ms();
        let elapsed = (now.saturating_sub(self.last_update)) as f64 / 1000.0;
        self.tokens = (self.tokens + elapsed * self.limit as f64).min(self.limit as f64);
        self.last_update = now;

        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

// ============== Concurrency Limiter ==============

pub struct ConcurrencyLimiter {
    pub limit: u32,
    pub current: u32,
}

impl ConcurrencyLimiter {
    pub fn new(limit: u32) -> Self {
        Self { limit, current: 0 }
    }

    #[inline]
    pub fn try_acquire(&mut self) -> bool {
        if self.current < self.limit {
            self.current += 1;
            true
        } else {
            false
        }
    }

    #[inline]
    pub fn release(&mut self) {
        self.current = self.current.saturating_sub(1);
    }
}

// ============== Queue State ==============

pub struct QueueState {
    pub paused: bool,
    pub rate_limiter: Option<RateLimiter>,
    pub concurrency: Option<ConcurrencyLimiter>,
}

impl QueueState {
    pub fn new() -> Self {
        Self {
            paused: false,
            rate_limiter: None,
            concurrency: None,
        }
    }
}

impl Default for QueueState {
    fn default() -> Self {
        Self::new()
    }
}
