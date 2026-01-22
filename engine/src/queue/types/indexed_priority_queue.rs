//! Indexed Priority Queue with O(log n) operations.
//!
//! Combines HashMap (O(1) lookup) with BinaryHeap (O(log n) priority ops).
//! Memory-optimized: heap stores only 28-byte metadata entries,
//! full Jobs are stored once in the index HashMap.

use std::collections::BinaryHeap;

use crate::protocol::Job;

use super::GxHashMap;

/// Lightweight heap entry with only ordering metadata.
/// Full Job is stored in the index HashMap, not duplicated here.
#[derive(Debug, Clone, Copy)]
struct HeapEntry {
    job_id: u64,
    priority: i32,
    run_at: u64,
    lifo: bool,
    /// Generation counter to handle stale entries after updates
    generation: u64,
}

impl Eq for HeapEntry {}

impl PartialEq for HeapEntry {
    fn eq(&self, other: &Self) -> bool {
        self.job_id == other.job_id
    }
}

impl Ord for HeapEntry {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Higher priority = greater (popped first from max-heap)
        // Earlier run_at = greater (popped first for delayed jobs)
        // LIFO: higher ID = greater (newer jobs first)
        // FIFO: lower ID = greater (older jobs first)
        self.priority
            .cmp(&other.priority)
            .then_with(|| other.run_at.cmp(&self.run_at))
            .then_with(|| {
                if self.lifo || other.lifo {
                    self.job_id.cmp(&other.job_id)
                } else {
                    other.job_id.cmp(&self.job_id)
                }
            })
    }
}

impl PartialOrd for HeapEntry {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Indexed Priority Queue with O(log n) operations for find/update/remove
pub struct IndexedPriorityQueue {
    /// Lightweight heap for priority ordering (28 bytes per entry)
    heap: BinaryHeap<HeapEntry>,
    /// Map from job_id to (job, generation) - single source of truth for Job data
    index: GxHashMap<u64, (Job, u64)>,
    /// Current generation counter (incremented on updates)
    generation: u64,
}

impl IndexedPriorityQueue {
    pub fn new() -> Self {
        Self {
            heap: BinaryHeap::new(),
            index: GxHashMap::with_capacity_and_hasher(256, Default::default()),
            generation: 0,
        }
    }

    #[allow(dead_code)]
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            heap: BinaryHeap::with_capacity(capacity),
            index: GxHashMap::with_capacity_and_hasher(capacity, Default::default()),
            generation: 0,
        }
    }

    /// Push a job - O(log n)
    #[inline]
    pub fn push(&mut self, job: Job) {
        let id = job.id;
        let priority = job.priority;
        let run_at = job.run_at;
        let lifo = job.lifo;
        let gen = self.generation;
        self.generation += 1;

        self.index.insert(id, (job, gen));
        self.heap.push(HeapEntry {
            job_id: id,
            priority,
            run_at,
            lifo,
            generation: gen,
        });
    }

    /// Pop highest priority job - O(log n) amortized
    #[inline]
    pub fn pop(&mut self) -> Option<Job> {
        while let Some(entry) = self.heap.pop() {
            if let Some((_, stored_gen)) = self.index.get(&entry.job_id) {
                if *stored_gen == entry.generation {
                    return self.index.remove(&entry.job_id).map(|(job, _)| job);
                }
            }
        }
        None
    }

    /// Peek at highest priority job - O(log n) amortized
    #[inline]
    #[allow(dead_code)]
    pub fn peek(&mut self) -> Option<&Job> {
        while let Some(entry) = self.heap.peek() {
            if let Some((_, stored_gen)) = self.index.get(&entry.job_id) {
                if *stored_gen == entry.generation {
                    return self.index.get(&entry.job_id).map(|(job, _)| job);
                }
            }
            self.heap.pop();
        }
        None
    }

    /// Get a job by ID - O(1)
    #[inline]
    #[allow(dead_code)]
    pub fn get(&self, job_id: u64) -> Option<&Job> {
        self.index.get(&job_id).map(|(job, _)| job)
    }

    /// Check if job exists - O(1)
    #[inline]
    pub fn contains(&self, job_id: u64) -> bool {
        self.index.contains_key(&job_id)
    }

    /// Remove a job by ID - O(1) (lazy removal)
    #[inline]
    pub fn remove(&mut self, job_id: u64) -> Option<Job> {
        self.index.remove(&job_id).map(|(job, _)| job)
    }

    /// Update a job - O(log n)
    #[inline]
    #[allow(dead_code)]
    pub fn update(&mut self, job: Job) -> Option<Job> {
        let id = job.id;
        let old = self.remove(id);
        self.push(job);
        old
    }

    /// Number of jobs
    #[inline]
    pub fn len(&self) -> usize {
        self.index.len()
    }

    #[inline]
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.index.is_empty()
    }

    /// Iterate over all jobs (not in priority order)
    #[inline]
    pub fn iter(&self) -> impl Iterator<Item = &Job> {
        self.index.values().map(|(job, _)| job)
    }

    #[inline]
    #[allow(dead_code)]
    pub fn drain(&mut self) -> impl Iterator<Item = Job> + '_ {
        self.heap.clear();
        self.index.drain().map(|(_, (job, _))| job)
    }

    #[inline]
    pub fn shrink_to_fit(&mut self) {
        self.heap.shrink_to_fit();
        self.index.shrink_to_fit();
    }

    #[inline]
    pub fn clear(&mut self) {
        self.heap.clear();
        self.index.clear();
    }

    #[inline]
    pub fn retain<F>(&mut self, mut f: F)
    where
        F: FnMut(&Job) -> bool,
    {
        let removed: Vec<u64> = self
            .index
            .iter()
            .filter(|(_, (job, _))| !f(job))
            .map(|(id, _)| *id)
            .collect();

        for id in removed {
            self.index.remove(&id);
        }
    }
}

impl Default for IndexedPriorityQueue {
    fn default() -> Self {
        Self::new()
    }
}
