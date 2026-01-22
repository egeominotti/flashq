//! Shard structure for sharded queue storage.
//!
//! Each shard contains queues and their state.
//! Uses CompactString for queue names (inline up to 24 chars, zero heap alloc).
//! Uses IndexedPriorityQueue for O(log n) find/update/remove by job_id.

use std::collections::VecDeque;
use std::sync::Arc;

use compact_str::CompactString;
use tokio::sync::Notify;

use crate::protocol::Job;

use super::{GxHashMap, GxHashSet, IndexedPriorityQueue, QueueState};

pub struct Shard {
    pub queues: GxHashMap<CompactString, IndexedPriorityQueue>,
    pub dlq: GxHashMap<CompactString, VecDeque<Job>>,
    pub unique_keys: GxHashMap<CompactString, GxHashSet<String>>,
    pub waiting_deps: GxHashMap<u64, Job>,
    pub waiting_children: GxHashMap<u64, Job>,
    pub queue_state: GxHashMap<CompactString, QueueState>,
    pub notify: Arc<Notify>,
    /// Active groups: tracks which groups have jobs currently being processed
    pub active_groups: GxHashMap<CompactString, GxHashSet<String>>,
}

impl Shard {
    #[inline]
    pub fn new() -> Self {
        Self {
            queues: GxHashMap::with_capacity_and_hasher(16, Default::default()),
            dlq: GxHashMap::with_capacity_and_hasher(16, Default::default()),
            unique_keys: GxHashMap::with_capacity_and_hasher(16, Default::default()),
            waiting_deps: GxHashMap::with_capacity_and_hasher(256, Default::default()),
            waiting_children: GxHashMap::with_capacity_and_hasher(256, Default::default()),
            queue_state: GxHashMap::with_capacity_and_hasher(16, Default::default()),
            notify: Arc::new(Notify::new()),
            active_groups: GxHashMap::with_capacity_and_hasher(16, Default::default()),
        }
    }

    /// Get or create queue state
    #[inline]
    pub fn get_state(&mut self, queue: &CompactString) -> &mut QueueState {
        self.queue_state.entry(queue.clone()).or_default()
    }

    /// Remove a unique key from the queue's unique_keys set.
    #[inline]
    pub fn remove_unique_key(&mut self, queue: &CompactString, key: Option<&String>) {
        if let Some(k) = key {
            if let Some(keys) = self.unique_keys.get_mut(queue) {
                keys.remove(k);
            }
        }
    }

    /// Release a group from active_groups for the queue.
    #[inline]
    pub fn release_group(&mut self, queue: &CompactString, group_id: Option<&String>) {
        if let Some(gid) = group_id {
            if let Some(groups) = self.active_groups.get_mut(queue) {
                groups.remove(gid);
            }
        }
    }

    /// Release concurrency slot for a queue.
    #[inline]
    pub fn release_concurrency(&mut self, queue: &CompactString) {
        if let Some(ref mut conc) = self.get_state(queue).concurrency {
            conc.release();
        }
    }

    /// Release all resources for a completed/failed job.
    #[inline]
    pub fn release_job_resources(
        &mut self,
        queue: &CompactString,
        unique_key: Option<&String>,
        group_id: Option<&String>,
    ) {
        self.release_concurrency(queue);
        self.release_group(queue, group_id);
        self.remove_unique_key(queue, unique_key);
    }
}

impl Default for Shard {
    fn default() -> Self {
        Self::new()
    }
}
