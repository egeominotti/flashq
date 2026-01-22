//! Time utilities and hash type aliases.
//!
//! - GxHash: 20-30% faster than FxHash (uses AES-NI instructions)
//! - Coarse timestamp: cached timestamp updated every 1ms (avoids syscall per operation)
//! - CompactString: inline up to 24 chars (zero heap allocation)

use std::collections::{HashMap, HashSet};
use std::hash::BuildHasherDefault;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use compact_str::CompactString;
use gxhash::GxHasher;

// ============== GxHash Type Aliases ==============

pub type GxHashMap<K, V> = HashMap<K, V, BuildHasherDefault<GxHasher>>;
pub type GxHashSet<T> = HashSet<T, BuildHasherDefault<GxHasher>>;

#[allow(dead_code)]
pub type QueueName = CompactString;

// ============== Coarse Timestamp ==============

static COARSE_TIME_MS: AtomicU64 = AtomicU64::new(0);

/// Initialize coarse timestamp background updater
pub fn init_coarse_time() {
    COARSE_TIME_MS.store(actual_now_ms(), Ordering::Relaxed);

    tokio::spawn(async {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(1));
        loop {
            interval.tick().await;
            COARSE_TIME_MS.store(actual_now_ms(), Ordering::Relaxed);
        }
    });
}

#[inline(always)]
fn actual_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Get current timestamp (coarse, ±1ms precision, zero syscall)
#[inline(always)]
pub fn now_ms() -> u64 {
    let cached = COARSE_TIME_MS.load(Ordering::Relaxed);
    if cached == 0 {
        actual_now_ms()
    } else {
        cached
    }
}

// ============== Queue Name Helper ==============

/// Create a CompactString from a queue name (zero allocation for names <= 24 chars)
#[inline(always)]
#[allow(dead_code)]
pub fn queue_name(s: &str) -> CompactString {
    CompactString::from(s)
}

/// Legacy alias for compatibility - now just creates a CompactString
#[inline(always)]
pub fn intern(s: &str) -> CompactString {
    CompactString::from(s)
}

/// No-op for compatibility - CompactString doesn't need cleanup
#[inline(always)]
pub fn cleanup_interned_strings() {
    // CompactString is stack-allocated, no cleanup needed
}
