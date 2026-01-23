# flashQ: A High-Performance In-Memory Job Queue System

**Technical Paper v2.0**

---

## Abstract

flashQ is a high-performance job queue system implemented in Rust, designed to achieve throughput exceeding 1.9 million operations per second while maintaining sub-millisecond latency. This paper presents the architectural decisions, data structures, concurrency model, and algorithmic optimizations that enable flashQ to outperform existing solutions by 3-5x in latency and up to 57x in batch throughput. We detail the sharded architecture, lock-free patterns, memory management strategies, and the hybrid persistence model that combines in-memory speed with SQLite durability.

---

## 1. Introduction

### 1.1 Problem Statement

Modern distributed systems require job queues that can:
- Process millions of jobs per second
- Maintain sub-millisecond latency for real-time applications
- Provide reliability guarantees (at-least-once delivery)
- Support advanced scheduling (priorities, delays, dependencies, groups)
- Handle large payloads efficiently (AI/ML workloads with embeddings)

Existing solutions like BullMQ (Redis-based) and Celery (Python) sacrifice performance for features, while high-throughput systems like Kafka lack job queue semantics.

### 1.2 Contributions

flashQ addresses this gap with:
1. **Dual-sharded architecture** - 32 queue shards + 32 processing shards for minimal contention
2. **Lock-free job index** - DashMap for O(1) concurrent job location lookup
3. **IndexedPriorityQueue** - O(log n) operations with generation-based lazy removal
4. **Coarse timestamps** - Cached millisecond timestamps eliminate syscall overhead
5. **CompactString queue names** - Zero heap allocation for names ≤24 characters
6. **Hybrid persistence** - In-memory speed with SQLite durability and S3 backup

---

## 2. System Architecture

### 2.1 High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
├─────────────┬─────────────┬─────────────┬──────────────────────┤
│    TCP      │    HTTP     │    gRPC     │    Unix Socket       │
│  (6789)     │   (6790)    │   (6791)    │   (/tmp/flashq.sock) │
└──────┬──────┴──────┬──────┴──────┬──────┴──────────┬───────────┘
       │             │             │                  │
       └─────────────┴──────┬──────┴──────────────────┘
                            │
                    ┌───────▼───────┐
                    │   PROTOCOL    │
                    │    PARSER     │
                    │  (JSON/MsgPack)│
                    └───────┬───────┘
                            │
              ┌─────────────▼─────────────┐
              │      QUEUE MANAGER        │
              │  ┌─────────────────────┐  │
              │  │   SHARDED QUEUES    │  │
              │  │     [32 shards]     │  │
              │  │  RwLock<Shard>[32]  │  │
              │  └─────────────────────┘  │
              │  ┌─────────────────────┐  │
              │  │ SHARDED PROCESSING  │  │
              │  │     [32 shards]     │  │
              │  │RwLock<HashMap>[32]  │  │
              │  └─────────────────────┘  │
              │  ┌─────────────────────┐  │
              │  │   JOB INDEX         │  │
              │  │  DashMap (lock-free)│  │
              │  └─────────────────────┘  │
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │    PERSISTENCE LAYER      │
              │   (SQLite + Async Writer) │
              │   (Optional S3 Backup)    │
              └───────────────────────────┘
```

### 2.2 Component Responsibilities

| Component | Responsibility | Concurrency Model |
|-----------|---------------|-------------------|
| Protocol Parser | Command deserialization (JSON/MessagePack) | Stateless, per-connection |
| Queue Manager | Job lifecycle orchestration | Shared state, sharded locks |
| Shard | Queue storage per hash bucket | Single RwLock per shard |
| Processing Shards | Active job tracking (32 shards) | RwLock per shard, sharded by job_id |
| Job Index | O(1) job location lookup | DashMap (lock-free) |
| Persistence | Durability, recovery | Async batched writes |

### 2.3 Dual-Sharding Strategy

flashQ employs two independent sharding strategies:

**Queue Shards (32)**: Sharded by queue name hash
```rust
fn shard_index(queue: &str) -> usize {
    let mut hasher = GxHasher::default();
    queue.hash(&mut hasher);
    hasher.finish() as usize % 32
}
```

**Processing Shards (32)**: Sharded by job_id (bitmask for O(1))
```rust
fn processing_shard_index(job_id: u64) -> usize {
    (job_id as usize) & 0x1F  // Fast modulo 32
}
```

This dual-sharding eliminates contention between push (queue shards) and ack/fail (processing shards) operations.

---

## 3. Data Structures

### 3.1 Job Representation

```rust
pub struct Job {
    pub id: u64,                     // Unique identifier (atomic counter)
    pub queue: String,               // Queue name
    pub data: Arc<Value>,            // JSON payload (Arc for cheap cloning)
    pub priority: i32,               // Higher = processed first
    pub created_at: u64,             // Unix timestamp (ms)
    pub run_at: u64,                 // Scheduled execution time
    pub started_at: u64,             // Processing start time
    pub last_heartbeat: u64,         // Stall detection
    pub attempts: u32,               // Retry counter
    pub max_attempts: u32,           // DLQ threshold
    pub backoff: u64,                // Base backoff (ms)
    pub ttl: u64,                    // Time-to-live (ms)
    pub timeout: u64,                // Processing timeout (ms)
    pub stall_timeout: u64,          // Stall detection timeout
    pub unique_key: Option<String>,  // Deduplication key
    pub custom_id: Option<String>,   // User-provided ID (idempotency)
    pub depends_on: Vec<u64>,        // Job dependencies
    pub parent_id: Option<u64>,      // Flow parent
    pub children_ids: Vec<u64>,      // Flow children
    pub group_id: Option<String>,    // FIFO group processing
    pub progress: u8,                // 0-100%
    pub progress_msg: Option<String>,
    pub tags: Vec<String>,           // Metadata tags
    pub lifo: bool,                  // LIFO mode flag
    pub remove_on_complete: bool,    // Skip completed storage
    pub remove_on_fail: bool,        // Skip DLQ storage
    pub keep_completed_age: u64,     // Retention period
    pub keep_completed_count: usize, // Retention count
}
```

**Key Design Decision**: `data` uses `Arc<Value>` for cheap cloning of potentially large payloads (up to 10MB for AI/ML workloads).

### 3.2 IndexedPriorityQueue

The IndexedPriorityQueue combines a BinaryHeap with a HashMap for O(log n) operations with O(1) lookup:

```rust
pub struct IndexedPriorityQueue {
    /// Lightweight heap for priority ordering (28 bytes per entry)
    heap: BinaryHeap<HeapEntry>,
    /// Map from job_id to (Job, generation) - single source of truth
    index: GxHashMap<u64, (Job, u64)>,
    /// Generation counter for lazy removal
    generation: u64,
}

/// Lightweight heap entry (28 bytes)
struct HeapEntry {
    job_id: u64,
    priority: i32,
    run_at: u64,
    lifo: bool,
    generation: u64,  // Handles stale entries after updates
}
```

**Priority Ordering** (max-heap semantics):
```rust
impl Ord for HeapEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        // 1. Higher priority first
        self.priority.cmp(&other.priority)
            // 2. Earlier run_at first (for delayed jobs)
            .then_with(|| other.run_at.cmp(&self.run_at))
            // 3. LIFO: newer first, FIFO: older first
            .then_with(|| {
                if self.lifo || other.lifo {
                    self.id.cmp(&other.id)      // LIFO: higher ID first
                } else {
                    other.id.cmp(&self.id)      // FIFO: lower ID first
                }
            })
    }
}
```

**Generation-Based Lazy Removal**:
- When a job is removed, only the index entry is deleted (O(1))
- Stale heap entries are skipped during pop() by checking generation match
- Amortized O(log n) for pop operations

**Complexity**:
| Operation | Complexity |
|-----------|------------|
| Push | O(log n) |
| Pop | O(log n) amortized |
| Remove | O(1) |
| Update | O(log n) |
| Get | O(1) |
| Contains | O(1) |

### 3.3 Shard Structure

```rust
pub struct Shard {
    /// Priority queues per queue name
    pub queues: GxHashMap<CompactString, IndexedPriorityQueue>,
    /// Dead Letter Queue per queue name
    pub dlq: GxHashMap<CompactString, VecDeque<Job>>,
    /// Unique keys per queue for deduplication
    pub unique_keys: GxHashMap<CompactString, GxHashSet<String>>,
    /// Jobs waiting for dependencies
    pub waiting_deps: GxHashMap<u64, Job>,
    /// Parent jobs waiting for children (Flows)
    pub waiting_children: GxHashMap<u64, Job>,
    /// Queue-specific state (rate limits, concurrency, pause)
    pub queue_state: GxHashMap<CompactString, QueueState>,
    /// Notification channel for waiting workers
    pub notify: Arc<Notify>,
    /// Active groups for FIFO processing within group
    pub active_groups: GxHashMap<CompactString, GxHashSet<String>>,
}
```

### 3.4 Job Location Index

For O(1) job state lookup regardless of location:

```rust
pub enum JobLocation {
    /// Job in queue (waiting/delayed) with queue name for O(1) lookup
    Queue { shard_idx: usize, queue_name: CompactString },
    /// Job being processed
    Processing,
    /// Job in DLQ with queue name
    Dlq { shard_idx: usize, queue_name: CompactString },
    /// Job waiting for dependencies
    WaitingDeps { shard_idx: usize },
    /// Parent waiting for children (Flows)
    WaitingChildren { shard_idx: usize },
    /// Job completed
    Completed,
}

// Lock-free concurrent HashMap using DashMap with GxHash
pub type JobIndexMap = DashMap<u64, JobLocation, BuildHasherDefault<GxHasher>>;
```

---

## 4. Concurrency Model

### 4.1 Lock Hierarchy

```
Level 0 (Lock-Free):   AtomicU64 job_id_counter
                       AtomicU64 coarse_timestamp
                       DashMap job_index
                       GlobalMetrics (atomics)

Level 1 (Per-Shard):   RwLock<Shard>[32]           (queue operations)
                       RwLock<HashMap>[32]         (processing operations)

Level 2 (Global):      RwLock<HashSet> completed_jobs
                       RwLock<HashMap> custom_id_map
                       RwLock<HashMap> cron_jobs
```

**Lock Acquisition Rules**:
1. Never hold multiple shard locks simultaneously
2. Acquire completed_jobs lock BEFORE shard locks (prevents deadlock)
3. Release locks before async operations (awaits)
4. Use `parking_lot::RwLock` (faster than std)

### 4.2 Lock-Free Job ID Generation

```rust
static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

#[inline(always)]
pub fn next_id() -> u64 {
    ID_COUNTER.fetch_add(1, Ordering::Relaxed)
}
```

**Why Relaxed Ordering**: Job IDs need only be unique, not sequentially observable across threads. Relaxed provides maximum performance while maintaining uniqueness.

### 4.3 Coarse Timestamp Optimization

```rust
static COARSE_TIME_MS: AtomicU64 = AtomicU64::new(0);

/// Background task updates every 1ms
pub fn init_coarse_time() {
    COARSE_TIME_MS.store(actual_now_ms(), Ordering::Relaxed);
    tokio::spawn(async {
        let mut interval = tokio::time::interval(Duration::from_millis(1));
        loop {
            interval.tick().await;
            COARSE_TIME_MS.store(actual_now_ms(), Ordering::Relaxed);
        }
    });
}

/// Zero-syscall timestamp (±1ms precision)
#[inline(always)]
pub fn now_ms() -> u64 {
    COARSE_TIME_MS.load(Ordering::Relaxed)
}
```

This eliminates syscall overhead for timestamp operations, which are called on every push/pull/ack.

### 4.4 Read-Write Lock Strategy

| Operation | Lock Type | Scope | Duration |
|-----------|-----------|-------|----------|
| Push | Write | Single queue shard | ~100ns |
| Pull | Write | Single queue shard | ~200ns |
| Ack | Write | Single processing shard | ~50ns |
| GetState | Read | Job index (lock-free) | ~10ns |
| Stats | Read | Atomic counters | ~5ns |

### 4.5 Deadlock Prevention Pattern

```rust
// CORRECT: Check dependencies BEFORE acquiring shard lock
async fn push(&self, queue: String, input: JobInput) -> Result<Job, String> {
    // Phase 1: Check dependencies (read lock on completed_jobs)
    let needs_waiting_deps = if !job.depends_on.is_empty() {
        let completed = self.completed_jobs.read();
        !job.depends_on.iter().all(|dep| completed.contains(dep))
    } else {
        false
    };

    // Phase 2: Acquire shard lock and insert
    {
        let mut shard = self.shards[idx].write();
        // ... insert job
    } // Lock released before any await

    // Phase 3: Async persistence
    self.persist_push(&job, "waiting");
    Ok(job)
}
```

---

## 5. Core Algorithms

### 5.1 Push Operation

```
PUSH(queue, data, options) → Result<Job, String>

1. Validate queue name (alphanumeric, max 256 chars)
2. Validate payload size (max 10MB)
3. Check debounce cache (atomic check+insert under write lock)
4. Generate job_id = atomic_increment()
5. Check custom_id for idempotency (atomic check+insert)
6. Calculate shard_idx = hash(queue) % 32
7. Check dependencies BEFORE shard lock (read completed_jobs)
8. WRITE LOCK shard[shard_idx]
9.   Check unique_key constraint
10.  If has_unresolved_deps → waiting_deps.insert(job)
11.  Else → queues[queue].push(job)
12. UNLOCK shard
13. Update job_index (lock-free DashMap)
14. Async: persist_push(job) to SQLite
15. Notify waiting workers (Notify::notify_waiters)
16. Broadcast event if listeners exist
17. Return job
```

**Time Complexity**: O(log n) where n = jobs in queue
**Space Complexity**: O(1) additional

### 5.2 Pull Operation

```
PULL(queue) → Job

1. Calculate shard_idx = hash(queue) % 32
2. Loop until job available:
3.   WRITE LOCK shard[shard_idx]
4.   Check queue_state (paused, rate_limit, concurrency)
5.   Clone active_groups set (avoid borrow conflict)
6.   Loop through heap:
7.     job = heap.pop()
8.     If job.is_expired() → discard, continue
9.     If job.is_ready() && group not active → found job
10.    If job.is_ready() && group active → skip, re-push later
11.    If job not ready (delayed) → push back, break
12.  If found: mark group as active
13.  UNLOCK shard
14.  If no job → wait on Notify with 100ms timeout
15. Update job_index → Processing (lock-free)
16. Insert into processing_shards[job_id & 0x1F]
17. Update metrics (atomic)
18. Return job
```

**Group FIFO Processing**: Jobs with the same `group_id` are processed one at a time, ensuring FIFO order within a group while allowing parallel processing across groups.

### 5.3 Ack Operation

```
ACK(job_id, result?) → Result<(), String>

1. Remove from processing_shards[job_id & 0x1F]
2. If not found → return Error
3. Calculate shard_idx = hash(job.queue) % 32
4. WRITE LOCK shard[shard_idx]
5.   Release concurrency slot
6.   Release group from active_groups
7.   Remove unique_key
8. UNLOCK shard
9. If remove_on_complete:
10.   Unindex job, clean up logs
11.   persist_delete(job_id)
12. Else:
13.   Store result in job_results
14.   Add to completed_jobs set
15.   Update job_index → Completed
16.   Store in completed_jobs_data (with size limit)
17. Persist to SQLite (sync or async based on config)
18. Update metrics (atomic)
19. Notify event subscribers
20. Notify job_waiters (finished() promise)
21. If has parent → on_child_completed(parent_id)
22. Return Ok
```

### 5.4 Fail Operation with Exponential Backoff

```
FAIL(job_id, error?) → Result<(), String>

1. Remove from processing_shards[job_id & 0x1F]
2. job.attempts += 1
3. If job.attempts >= job.max_attempts:
4.   If remove_on_fail → discard job entirely
5.   Else:
6.     Move to DLQ
7.     Update job_index → Dlq
8.     persist_dlq(job, error)
9.   Notify waiters (prevents memory leak)
10. Else (retry):
11.   backoff = job.backoff * 2^(attempts - 1)  // capped at 2^10
12.   job.run_at = now + backoff
13.   job.started_at = 0
14.   Update job_index → Queue
15.   persist_fail(job_id, new_run_at, attempts)
16.   Re-push to queue
17.   Notify shard
18. Update metrics (atomic)
19. Return Ok
```

**Backoff Formula**:
```
delay = base_backoff × 2^min(attempts, 10)

Example (base = 1000ms, max_attempts = 5):
  Attempt 1: 1000ms
  Attempt 2: 2000ms
  Attempt 3: 4000ms
  Attempt 4: 8000ms
  Attempt 5: 16000ms → DLQ
```

### 5.5 Batch Operations Optimization

Batch operations minimize lock contention by:
1. Acquiring locks once per shard (not per job)
2. Bulk-collecting resources to release
3. Single-pass index updates

```rust
// ack_batch optimization
pub async fn ack_batch(&self, ids: &[u64]) -> usize {
    // Phase 1: Collect all jobs and group by shard
    let mut shard_resources: HashMap<usize, (CompactString, Vec<...>, Vec<...>)>;
    for &id in ids {
        if let Some(job) = self.processing_remove(id) {
            // Collect resources by shard_idx
            shard_resources.entry(idx).or_insert(...);
        }
    }

    // Phase 2: Single lock per shard for all releases
    for (idx, (queue_arc, unique_keys, group_ids)) in shard_resources {
        let mut shard = self.shards[idx].write();
        // Bulk release all resources
    }
    // Result: O(shards) lock acquisitions instead of O(jobs)
}
```

---

## 6. Rate Limiting & Concurrency Control

### 6.1 Token Bucket Algorithm

```rust
pub struct RateLimiter {
    pub limit: u32,        // Max tokens (jobs/second)
    tokens: f64,           // Current tokens
    last_update: u64,      // Last refill timestamp
}

impl RateLimiter {
    #[inline]
    pub fn try_acquire(&mut self) -> bool {
        let now = now_ms();
        let elapsed = (now.saturating_sub(self.last_update)) as f64 / 1000.0;

        // Refill tokens based on elapsed time
        self.tokens = (self.tokens + elapsed * self.limit as f64)
            .min(self.limit as f64);
        self.last_update = now;

        // Try to consume one token
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}
```

### 6.2 Concurrency Limiter

```rust
pub struct ConcurrencyLimiter {
    pub limit: u32,    // Max concurrent jobs
    pub current: u32,  // Currently active
}

impl ConcurrencyLimiter {
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
```

### 6.3 Queue State

```rust
pub struct QueueState {
    pub paused: bool,
    pub rate_limiter: Option<RateLimiter>,
    pub concurrency: Option<ConcurrencyLimiter>,
}
```

---

## 7. Persistence Layer

### 7.1 Hybrid Architecture

```
┌─────────────────────────────────────────────┐
│              IN-MEMORY (Hot Path)           │
│  - All active operations                    │
│  - Sub-millisecond latency                  │
│  - Full feature set                         │
└─────────────────┬───────────────────────────┘
                  │ Async Write (batched)
                  ▼
┌─────────────────────────────────────────────┐
│              SQLITE (Durability)            │
│  - Write-ahead logging (WAL mode)           │
│  - Crash recovery                           │
│  - Async writer with batching               │
└─────────────────┬───────────────────────────┘
                  │ Periodic backup
                  ▼
┌─────────────────────────────────────────────┐
│              S3 BACKUP (Optional)           │
│  - Configurable interval                    │
│  - Disaster recovery                        │
└─────────────────────────────────────────────┘
```

### 7.2 Async Writer

The async writer batches persistence operations for maximum throughput:

```rust
pub struct AsyncWriter {
    tx: mpsc::Sender<WriteOp>,
    batch_interval_ms: AtomicU64,
    max_batch_size: AtomicUsize,
    stats: Arc<AsyncWriterStats>,
}

// Operations are queued and batched
enum WriteOp {
    InsertJob(Job, String),      // job, state
    AckJob(u64, Option<Value>),  // job_id, result
    FailJob(u64, u64, u32),      // job_id, new_run_at, attempts
    DeleteJob(u64),
    // ... batch variants
}
```

### 7.3 Write Strategies

| Operation | Strategy | Latency Impact |
|-----------|----------|----------------|
| Push | Async batched | 0μs (fire-and-forget) |
| Ack | Async batched | 0μs |
| Fail | Async batched | 0μs |
| Sync mode | Direct write | ~1-5ms |

**Sync Persistence Mode**: Enabled via `SYNC_PERSISTENCE=1` for guaranteed durability at the cost of latency.

### 7.4 Recovery Process

```
STARTUP_RECOVERY() → void

1. Connect to SQLite database
2. Get max job_id → set ID counter to max_id + 1
3. Load pending jobs (state IN ('waiting', 'delayed', 'active')):
4.   For each job:
5.     Calculate shard_idx = hash(job.queue) % 32
6.     If state = 'waiting_children' → insert to waiting_deps
7.     Else → insert to queues[queue]
8.     Update job_index
9. Load DLQ jobs → insert to dlq[queue]
10. Load cron jobs → insert to cron_jobs map
11. Load webhooks → insert to webhooks map
12. Log recovery statistics
```

---

## 8. Memory Management

### 8.1 CompactString for Queue Names

Queue names are frequently used as map keys. CompactString inlines strings up to 24 characters:

```rust
use compact_str::CompactString;

/// Zero allocation for names ≤24 chars
#[inline(always)]
pub fn intern(s: &str) -> CompactString {
    CompactString::from(s)
}
```

**Memory Savings**:
- Standard String: 24 bytes + heap allocation
- CompactString (≤24 chars): 24 bytes, zero heap allocation
- For typical queue names like "emails", "notifications": 100% reduction in allocations

### 8.2 Arc<Value> for Job Data

Large JSON payloads use Arc for cheap cloning:

```rust
pub data: Arc<Value>,  // Shared ownership, single allocation
```

When a job is cloned (e.g., for persistence), only the Arc reference count increments—no data copying.

### 8.3 GxHash for Fast Hashing

```rust
use gxhash::GxHasher;

pub type GxHashMap<K, V> = HashMap<K, V, BuildHasherDefault<GxHasher>>;
pub type GxHashSet<T> = HashSet<T, BuildHasherDefault<GxHasher>>;
```

GxHash uses AES-NI instructions for 20-30% faster hashing than FxHash.

### 8.4 Cleanup Strategies

```rust
pub struct CleanupSettings {
    pub max_completed_jobs: usize,      // Default: 5000
    pub max_job_results: usize,         // Default: 5000
    pub cleanup_interval_secs: u64,     // Default: 60
    pub metrics_history_size: usize,    // Default: 1000
}
```

**Bounded Collections**: All caches have configurable maximum sizes to prevent unbounded memory growth.

### 8.5 Memory Allocator

```rust
use mimalloc::MiMalloc;

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;
```

**Benefits**:
- 2-3x faster small allocations
- Better cache locality
- Reduced fragmentation
- Thread-local caching

---

## 9. Network Protocol

### 9.1 Dual Protocol Support

flashQ supports both JSON and MessagePack protocols:

```
Protocol Detection (first byte):
  '{' (0x7B) → JSON text mode
  Other      → MessagePack binary mode

Frame Format:
┌─────────────────────────────────────────────┐
│  LENGTH (4 bytes, big-endian u32)           │
├─────────────────────────────────────────────┤
│  PAYLOAD (LENGTH bytes)                     │
│  - JSON: UTF-8 text                         │
│  - Binary: MessagePack                      │
└─────────────────────────────────────────────┘
```

### 9.2 MessagePack Benefits

| Metric | JSON | MessagePack | Improvement |
|--------|------|-------------|-------------|
| Wire size | 100% | ~60% | 40% smaller |
| Serialization | 1x | 3-5x | 3-5x faster |
| Parsing | 1x | 3-5x | 3-5x faster |

### 9.3 Request Multiplexing

```rust
pub struct Request {
    #[serde(rename = "reqId")]
    pub req_id: Option<String>,  // For response matching
    #[serde(flatten)]
    pub command: Command,
}

pub struct ResponseWithId {
    #[serde(rename = "reqId")]
    pub req_id: Option<String>,  // Echo back for matching
    #[serde(flatten)]
    pub response: Response,
}
```

---

## 10. Background Tasks

### 10.1 Task Schedule

| Task | Interval | Description |
|------|----------|-------------|
| Coarse Timestamp | 1ms | Update cached timestamp |
| Timeout Check | 500ms | Detect timed-out jobs |
| Dependency Check | 500ms | Release jobs with completed deps |
| Metrics Collection | 5s | Update throughput history |
| Cleanup | 60s | Clean completed jobs, results |

### 10.2 Timeout Detection

```rust
pub(crate) async fn check_timed_out_jobs(&self) {
    let now = Self::now_ms();
    let mut timed_out = Vec::new();

    // Collect timed-out jobs from all processing shards
    self.processing_iter(|job| {
        if job.is_timed_out(now) {
            timed_out.push(job.id);
        }
    });

    for job_id in timed_out {
        if let Some(mut job) = self.processing_remove(job_id) {
            job.attempts += 1;
            if job.should_go_to_dlq() {
                // Move to DLQ
            } else {
                // Retry with backoff
            }
        }
    }
}
```

### 10.3 Dependency Resolution

```rust
pub(crate) async fn check_dependencies(&self) {
    // CRITICAL: Read completed_jobs FIRST to avoid deadlock
    let completed: HashSet<u64> = self.completed_jobs.read()
        .iter().copied().collect();

    for (idx, shard) in self.shards.iter().enumerate() {
        let mut shard_w = shard.write();

        let ready_ids: Vec<u64> = shard_w.waiting_deps.iter()
            .filter(|(_, job)| job.depends_on.iter()
                .all(|dep| completed.contains(dep)))
            .map(|(&id, _)| id)
            .collect();

        for job_id in ready_ids {
            if let Some(job) = shard_w.waiting_deps.remove(&job_id) {
                let queue_arc = intern(&job.queue);
                shard_w.queues.entry(queue_arc).or_default().push(job);
            }
        }
    }
}
```

---

## 11. Global Metrics

### 11.1 Atomic Counters

```rust
pub struct GlobalMetrics {
    pub total_pushed: AtomicU64,
    pub total_completed: AtomicU64,
    pub total_failed: AtomicU64,
    pub total_timed_out: AtomicU64,
    pub latency_sum: AtomicU64,
    pub latency_count: AtomicU64,
    // O(1) current state counters
    pub current_queued: AtomicU64,
    pub current_processing: AtomicU64,
    pub current_dlq: AtomicU64,
    // Throughput tracking
    pub throughput_window_count: AtomicU64,
    pub throughput_window_start: AtomicU64,
}
```

### 11.2 O(1) Stats Queries

Instead of iterating all 32 shards to count jobs, atomic counters provide O(1) stats:

```rust
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
```

---

## 12. Security

### 12.1 Input Validation

```rust
/// Maximum job data size (10MB for AI/ML workloads)
pub const MAX_JOB_DATA_SIZE: usize = 10_485_760;
pub const MAX_QUEUE_NAME_LENGTH: usize = 256;
pub const MAX_BATCH_SIZE: usize = 1000;

/// Queue name: alphanumeric, underscore, hyphen, dot only
pub fn validate_queue_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > MAX_QUEUE_NAME_LENGTH {
        return Err("Invalid queue name length");
    }
    if !name.chars().all(|c| c.is_alphanumeric()
        || c == '_' || c == '-' || c == '.') {
        return Err("Invalid characters in queue name");
    }
    Ok(())
}
```

### 12.2 Authentication

```rust
/// Constant-time comparison prevents timing attacks
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() { return false; }
    let mut result = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        result |= x ^ y;
    }
    result == 0
}

pub fn verify_token(&self, token: &str) -> bool {
    let tokens = self.auth_tokens.read();
    if tokens.is_empty() { return true; }  // No auth configured
    let mut found = false;
    for valid_token in tokens.iter() {
        found |= constant_time_eq(token.as_bytes(), valid_token.as_bytes());
    }
    found
}
```

### 12.3 DoS Prevention

| Attack Vector | Mitigation |
|--------------|------------|
| Large payloads | 10MB limit per job |
| Many small jobs | Rate limiting per queue |
| Batch flooding | Max 1000 jobs per batch |
| Queue name injection | Strict alphanumeric validation |
| Memory exhaustion | Bounded collections, cleanup routines |

---

## 13. Performance Analysis

### 13.1 Latency Breakdown

```
PUSH Operation (single job):
┌────────────────────────────────────────┬──────────┐
│ Component                              │ Time     │
├────────────────────────────────────────┼──────────┤
│ Network receive                        │ ~30μs    │
│ JSON parsing                           │ ~20μs    │
│ Validation                             │ ~2μs     │
│ ID generation (atomic)                 │ ~1ns     │
│ Shard lock acquire                     │ ~5μs     │
│ IndexedPriorityQueue push              │ ~100ns   │
│ Shard lock release                     │ ~2μs     │
│ Job index update (lock-free)           │ ~10ns    │
│ Response serialization                 │ ~15μs    │
│ Network send                           │ ~30μs    │
├────────────────────────────────────────┼──────────┤
│ TOTAL                                  │ ~105μs   │
└────────────────────────────────────────┴──────────┘
```

### 13.2 Throughput Scaling

```
Batch Size vs Throughput:

Batch Size │ Throughput (jobs/sec) │ Efficiency
───────────┼───────────────────────┼───────────
    1      │      8,500            │   1.0x
   10      │     75,000            │   8.8x
  100      │    450,000            │  53.0x
 1000      │  1,200,000            │ 141.0x
10000      │  1,900,000            │ 223.5x
```

**Why batching scales**:
- Amortized network overhead
- Single lock acquisition for N operations
- Reduced syscall overhead
- Better cache utilization

### 13.3 Comparison with BullMQ

| Metric | flashQ | BullMQ | Improvement |
|--------|--------|--------|-------------|
| Single Push Latency | 105μs | 645μs | 6.1x |
| Single Pull Latency | 120μs | 612μs | 5.1x |
| Batch Push (10K) | 14ms | 812ms | 58x |
| P99 Latency | 300μs | 2.1ms | 7x |
| Memory per Job | ~200B | ~1KB | 5x |

---

## 14. Fault Tolerance

### 14.1 At-Least-Once Delivery

```
Guarantee: Every job is processed AT LEAST once

Mechanism:
1. Job enters "active" state on PULL
2. Worker must ACK within timeout
3. If no ACK → job returns to queue with backoff
4. If worker crashes → timeout triggers retry

Edge case: Worker processes job, crashes before ACK
Result: Job processed twice (at-least-once, not exactly-once)
Solution: Idempotent job handlers or use custom_id
```

### 14.2 Graceful Shutdown

```rust
async fn graceful_shutdown(queue_manager: &Arc<QueueManager>) {
    queue_manager.shutdown();  // Set shutdown flag

    let start = Instant::now();
    let timeout = Duration::from_secs(30);

    loop {
        let processing = queue_manager.processing_count();
        if processing == 0 {
            info!("All active jobs completed");
            break;
        }
        if start.elapsed() >= timeout {
            warn!("Shutdown timeout, forcing exit");
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}
```

---

## 15. Conclusion

flashQ achieves its performance goals through:

1. **Dual-sharded architecture** - Eliminates contention between push and ack operations
2. **Lock-free job index** - DashMap provides O(1) concurrent lookups
3. **IndexedPriorityQueue** - O(log n) with O(1) removal via generations
4. **Coarse timestamps** - Eliminates syscall overhead (~1000x faster)
5. **CompactString** - Zero allocation for typical queue names
6. **GxHash** - 20-30% faster hashing with AES-NI
7. **Arc<Value>** - Cheap cloning of large payloads
8. **Atomic metrics** - O(1) stats without shard iteration
9. **Batched persistence** - Async writer maximizes SQLite throughput
10. **mimalloc** - 2-3x faster allocations

The result is a job queue system that processes 1.9M+ jobs/second while maintaining sub-millisecond latency and providing enterprise-grade features.

---

## References

1. Rust Programming Language - https://www.rust-lang.org/
2. parking_lot crate - https://docs.rs/parking_lot/
3. DashMap crate - https://docs.rs/dashmap/
4. tokio async runtime - https://tokio.rs/
5. mimalloc allocator - https://github.com/microsoft/mimalloc
6. gxhash crate - https://docs.rs/gxhash/
7. compact_str crate - https://docs.rs/compact_str/
8. SQLite - https://www.sqlite.org/
9. Token Bucket Algorithm - https://en.wikipedia.org/wiki/Token_bucket

---

**Version**: 2.0
**Date**: January 2025
**Authors**: flashQ Development Team
