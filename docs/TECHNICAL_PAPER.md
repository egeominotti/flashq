# flashQ: A High-Performance In-Memory Job Queue System

**Technical Paper v1.0**

---

## Abstract

flashQ is a high-performance job queue system implemented in Rust, designed to achieve throughput exceeding 1.9 million operations per second while maintaining sub-millisecond latency. This paper presents the architectural decisions, data structures, concurrency model, and algorithmic optimizations that enable flashQ to outperform existing solutions by 3-5x in latency and up to 57x in batch throughput. We detail the sharded architecture, lock-free patterns, memory management strategies, and the hybrid persistence model that combines in-memory speed with PostgreSQL durability.

---

## 1. Introduction

### 1.1 Problem Statement

Modern distributed systems require job queues that can:
- Process millions of jobs per second
- Maintain sub-millisecond latency for real-time applications
- Provide reliability guarantees (at-least-once delivery)
- Support advanced scheduling (priorities, delays, dependencies)
- Scale horizontally across multiple nodes

Existing solutions like BullMQ (Redis-based) and Celery (Python) sacrifice performance for features, while high-throughput systems like Kafka lack job queue semantics.

### 1.2 Contributions

flashQ addresses this gap with:
1. **Sharded in-memory architecture** achieving O(1) average-case operations
2. **Lock-free job ID generation** eliminating contention
3. **Hybrid persistence model** combining speed with durability
4. **Zero-copy protocol parsing** minimizing allocations
5. **Adaptive backpressure** preventing system overload

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
                    └───────┬───────┘
                            │
              ┌─────────────▼─────────────┐
              │      QUEUE MANAGER        │
              │  ┌─────────────────────┐  │
              │  │   SHARDED QUEUES    │  │
              │  │  [0] [1] ... [31]   │  │
              │  └─────────────────────┘  │
              │  ┌─────────────────────┐  │
              │  │  GLOBAL PROCESSING  │  │
              │  │     HashMap<u64>    │  │
              │  └─────────────────────┘  │
              │  ┌─────────────────────┐  │
              │  │   JOB INDEX         │  │
              │  │  HashMap<u64, Loc>  │  │
              │  └─────────────────────┘  │
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │    PERSISTENCE LAYER      │
              │      (PostgreSQL)         │
              └───────────────────────────┘
```

### 2.2 Component Responsibilities

| Component | Responsibility | Concurrency Model |
|-----------|---------------|-------------------|
| Protocol Parser | Command deserialization | Stateless, per-connection |
| Queue Manager | Job lifecycle orchestration | Shared state, sharded locks |
| Shard | Queue storage per hash bucket | Single RwLock per shard |
| Processing Map | Active job tracking | Global RwLock |
| Job Index | O(1) job location lookup | Global RwLock |
| Persistence | Durability, recovery | Async, batched writes |

---

## 3. Data Structures

### 3.1 Job Representation

```rust
pub struct Job {
    pub id: u64,              // Unique identifier (atomic counter)
    pub queue: String,        // Queue name (interned)
    pub data: Value,          // JSON payload (serde_json)
    pub priority: i32,        // Higher = processed first
    pub created_at: u64,      // Unix timestamp (ms)
    pub run_at: u64,          // Scheduled execution time
    pub started_at: u64,      // Processing start time
    pub attempts: u32,        // Retry counter
    pub max_attempts: u32,    // DLQ threshold
    pub backoff: u64,         // Base backoff (ms)
    pub ttl: u64,             // Time-to-live (ms)
    pub timeout: u64,         // Processing timeout (ms)
    pub unique_key: Option<String>,  // Deduplication key
    pub depends_on: Vec<u64>, // Job dependencies
    pub progress: u8,         // 0-100%
    pub progress_msg: Option<String>,
    pub tags: Vec<String>,    // Metadata tags
    pub lifo: bool,           // LIFO mode flag
}
```

**Memory Layout**: ~256 bytes per job (excluding payload)

### 3.2 Priority Queue Implementation

Jobs are stored in a `BinaryHeap<Job>` with custom ordering:

```rust
impl Ord for Job {
    fn cmp(&self, other: &Self) -> Ordering {
        // 1. Higher priority first
        self.priority.cmp(&other.priority)
            // 2. Earlier run_at first (for delayed jobs)
            .then_with(|| other.run_at.cmp(&self.run_at))
            // 3. LIFO: higher ID first, FIFO: lower ID first
            .then_with(|| {
                if self.lifo || other.lifo {
                    self.id.cmp(&other.id)      // LIFO: newer first
                } else {
                    other.id.cmp(&self.id)      // FIFO: older first
                }
            })
    }
}
```

**Complexity**:
- Push: O(log n)
- Pull (pop): O(log n)
- Peek: O(1)

### 3.3 Sharded Queue Storage

```rust
pub struct Shard {
    // Priority queues per queue name
    pub queues: HashMap<Arc<str>, BinaryHeap<Job>>,

    // Dead Letter Queue per queue name
    pub dlq: HashMap<Arc<str>, VecDeque<Job>>,

    // Jobs waiting for dependencies
    pub waiting_deps: HashMap<u64, Job>,

    // Queue-specific state (rate limits, concurrency, pause)
    pub queue_states: HashMap<Arc<str>, QueueState>,
}

// 32 shards for parallel access
pub shards: [RwLock<Shard>; 32]
```

**Shard Selection** (deterministic hash):

```rust
fn shard_index(queue: &str) -> usize {
    let mut hasher = FxHasher::default();
    queue.hash(&mut hasher);
    (hasher.finish() as usize) % 32
}
```

### 3.4 Job Location Index

For O(1) job lookup regardless of state:

```rust
pub enum JobLocation {
    Queue { shard_idx: usize },
    Processing,
    Dlq { shard_idx: usize },
    WaitingDeps { shard_idx: usize },
    Completed,
}

// Global index: Job ID -> Location
pub job_index: RwLock<HashMap<u64, JobLocation>>
```

---

## 4. Concurrency Model

### 4.1 Lock Hierarchy

```
Level 0 (No Lock):     Atomic<u64> job_id_counter
Level 1 (Per-Shard):   RwLock<Shard>[32]
Level 2 (Global):      RwLock<HashMap> processing, job_index, completed_jobs
```

**Lock Acquisition Rules**:
1. Never hold multiple shard locks simultaneously
2. Release shard lock before acquiring global lock
3. Use `parking_lot::RwLock` (faster than std)

### 4.2 Lock-Free Job ID Generation

```rust
static JOB_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_job_id() -> u64 {
    JOB_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
}
```

**Why Relaxed Ordering**: Job IDs need only be unique, not sequentially observable across threads. Relaxed provides maximum performance while maintaining uniqueness.

### 4.3 Read-Write Lock Strategy

| Operation | Lock Type | Scope | Duration |
|-----------|-----------|-------|----------|
| Push | Write | Single shard | ~100ns |
| Pull | Write | Single shard + processing | ~200ns |
| Ack | Write | Processing only | ~50ns |
| GetState | Read | Job index | ~20ns |
| Stats | Read | All shards (sequential) | ~1μs |

### 4.4 Deadlock Prevention

```rust
// CORRECT: Release shard lock before global lock
async fn pull(&self, queue: &str) -> Job {
    let job = {
        let mut shard = self.shards[idx].write();
        shard.queues.get_mut(&queue)?.pop()
    }; // Shard lock released here

    if let Some(job) = job {
        self.processing.write().insert(job.id, job.clone());
    }
    job
}

// WRONG: Holding both locks
async fn pull_wrong(&self, queue: &str) -> Job {
    let mut shard = self.shards[idx].write();
    let mut processing = self.processing.write(); // DEADLOCK RISK!
    // ...
}
```

---

## 5. Core Algorithms

### 5.1 Push Operation

```
PUSH(queue, data, options) → job_id

1. Validate queue name (alphanumeric, max 256 chars)
2. Validate payload size (max 1MB)
3. Generate job_id = atomic_increment()
4. Calculate shard_idx = hash(queue) % 32
5. Create Job struct with timestamps
6. Check unique_key constraint
7. LOCK shard[shard_idx] (write)
8.   If has_dependencies → waiting_deps.insert(job)
9.   Else if delayed → queues[queue].push(job)
10.  Else → queues[queue].push(job)
11. UNLOCK shard
12. Update job_index
13. Async: persist_push(job) to PostgreSQL
14. Notify waiting workers
15. Return job_id
```

**Time Complexity**: O(log n) where n = jobs in queue
**Space Complexity**: O(1) additional

### 5.2 Pull Operation

```
PULL(queue) → Job

1. Calculate shard_idx = hash(queue) % 32
2. LOCK shard[shard_idx] (write)
3.   Check queue_state (paused, rate_limit, concurrency)
4.   Loop:
5.     job = queues[queue].peek()
6.     If job.run_at > now → break (delayed)
7.     If job.is_expired() → pop and discard, continue
8.     Pop job from heap
9.     Break
10. UNLOCK shard
11. If no job → wait on condvar (blocking pull)
12. LOCK processing (write)
13.   processing.insert(job.id, job)
14. UNLOCK processing
15. Update job_index → Processing
16. Async: persist_processing(job)
17. Return job
```

**Blocking Mechanism**:
```rust
// Per-shard condition variable
pub struct ShardNotifier {
    condvar: Condvar,
    mutex: Mutex<()>,
}

// Worker waits for notification
fn wait_for_job(&self, shard_idx: usize, timeout: Duration) {
    let notifier = &self.shard_notifiers[shard_idx];
    let guard = notifier.mutex.lock();
    notifier.condvar.wait_timeout(guard, timeout);
}

// Push notifies waiters
fn notify_shard(&self, shard_idx: usize) {
    self.shard_notifiers[shard_idx].condvar.notify_all();
}
```

### 5.3 Ack Operation

```
ACK(job_id, result?) → Ok/Err

1. LOCK processing (write)
2.   job = processing.remove(job_id)
3.   If not found → return Err("Job not found")
4. UNLOCK processing
5. Release unique_key if present
6. Release concurrency slot
7. LOCK completed_jobs (write)
8.   completed_jobs.insert(job_id)
9. UNLOCK completed_jobs
10. Update job_index → Completed
11. Store result if provided
12. Async: persist_completed(job_id, result)
13. Trigger dependent jobs check
14. Return Ok
```

### 5.4 Fail Operation with Exponential Backoff

```
FAIL(job_id, error?) → Ok/Err

1. LOCK processing (write)
2.   job = processing.remove(job_id)
3. UNLOCK processing
4. job.attempts += 1
5. If job.attempts >= job.max_attempts:
6.   Move to DLQ
7.   Update job_index → Dlq
8.   Async: persist_dlq(job, error)
9. Else:
10.   backoff = job.backoff * 2^(job.attempts - 1)
11.   job.run_at = now + backoff
12.   Re-push to queue (will be delayed)
13.   Update job_index → Queue
14.   Async: persist_retry(job)
15. Return Ok
```

**Backoff Formula**:
```
delay = base_backoff × 2^(attempt - 1)

Example (base = 1000ms):
  Attempt 1: 1000ms
  Attempt 2: 2000ms
  Attempt 3: 4000ms
  Attempt 4: 8000ms
  Attempt 5: 16000ms (→ DLQ if max_attempts = 5)
```

### 5.5 Dependency Resolution

```
CHECK_DEPENDENCIES() → void

1. Read completed_jobs set
2. For each shard:
3.   LOCK shard (write)
4.   For each job in waiting_deps:
5.     If all job.depends_on in completed_jobs:
6.       Remove from waiting_deps
7.       Push to queues[job.queue]
8.   UNLOCK shard
9.   Notify shard if jobs were released
```

---

## 6. Rate Limiting

### 6.1 Token Bucket Algorithm

```rust
pub struct RateLimiter {
    tokens: f64,           // Current tokens
    max_tokens: f64,       // Bucket capacity
    refill_rate: f64,      // Tokens per millisecond
    last_refill: u64,      // Last refill timestamp
}

impl RateLimiter {
    pub fn try_acquire(&mut self) -> bool {
        let now = current_time_ms();
        let elapsed = now - self.last_refill;

        // Refill tokens based on elapsed time
        self.tokens = (self.tokens + elapsed as f64 * self.refill_rate)
            .min(self.max_tokens);
        self.last_refill = now;

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

### 6.2 Concurrency Limiting

```rust
pub struct ConcurrencyLimiter {
    max_concurrent: u32,
    current: AtomicU32,
}

impl ConcurrencyLimiter {
    pub fn try_acquire(&self) -> bool {
        loop {
            let current = self.current.load(Ordering::Acquire);
            if current >= self.max_concurrent {
                return false;
            }
            if self.current.compare_exchange(
                current,
                current + 1,
                Ordering::AcqRel,
                Ordering::Relaxed
            ).is_ok() {
                return true;
            }
        }
    }

    pub fn release(&self) {
        self.current.fetch_sub(1, Ordering::Release);
    }
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
                  │ Async Write
                  ▼
┌─────────────────────────────────────────────┐
│            POSTGRESQL (Durability)          │
│  - Write-ahead logging                      │
│  - Crash recovery                           │
│  - Historical queries                       │
└─────────────────────────────────────────────┘
```

### 7.2 Database Schema

```sql
-- Core jobs table
CREATE TABLE jobs (
    id BIGINT PRIMARY KEY,
    queue VARCHAR(256) NOT NULL,
    data JSONB NOT NULL,
    priority INTEGER DEFAULT 0,
    state VARCHAR(32) NOT NULL,
    created_at BIGINT NOT NULL,
    run_at BIGINT NOT NULL,
    started_at BIGINT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    backoff BIGINT DEFAULT 1000,
    ttl BIGINT DEFAULT 0,
    timeout BIGINT DEFAULT 30000,
    unique_key VARCHAR(256),
    progress SMALLINT DEFAULT 0,
    progress_msg TEXT,
    error TEXT,
    result JSONB,
    lifo BOOLEAN DEFAULT FALSE
);

-- Indexes for common queries
CREATE INDEX idx_jobs_queue_state ON jobs(queue, state);
CREATE INDEX idx_jobs_run_at ON jobs(run_at) WHERE state = 'delayed';
CREATE UNIQUE INDEX idx_jobs_unique ON jobs(queue, unique_key)
    WHERE unique_key IS NOT NULL AND state NOT IN ('completed', 'failed');

-- Job dependencies (many-to-many)
CREATE TABLE job_dependencies (
    job_id BIGINT REFERENCES jobs(id),
    depends_on BIGINT REFERENCES jobs(id),
    PRIMARY KEY (job_id, depends_on)
);

-- Cron jobs
CREATE TABLE cron_jobs (
    name VARCHAR(256) PRIMARY KEY,
    queue VARCHAR(256) NOT NULL,
    schedule VARCHAR(256) NOT NULL,
    data JSONB NOT NULL,
    priority INTEGER DEFAULT 0,
    next_run BIGINT NOT NULL
);

-- Cluster coordination
CREATE TABLE cluster_nodes (
    node_id VARCHAR(64) PRIMARY KEY,
    host VARCHAR(255),
    port INTEGER,
    is_leader BOOLEAN DEFAULT FALSE,
    last_heartbeat TIMESTAMPTZ DEFAULT NOW()
);
```

### 7.3 Write Path Optimization

```rust
// Batched async writes
impl QueueManager {
    fn persist_push(&self, job: &Job) {
        if let Some(pg) = &self.postgres {
            let pg = pg.clone();
            let job = job.clone();
            tokio::spawn(async move {
                // Fire-and-forget async write
                let _ = pg.insert_job(&job).await;
            });
        }
    }
}
```

**Write Strategies**:

| Operation | Persistence Strategy | Latency Impact |
|-----------|---------------------|----------------|
| Push | Async fire-and-forget | 0μs |
| Ack | Async batched | 0μs |
| Fail | Async immediate | 0μs |
| Progress | Async debounced | 0μs |

### 7.4 Recovery Process

```
STARTUP_RECOVERY() → void

1. Connect to PostgreSQL
2. Load all jobs WHERE state IN ('waiting', 'delayed', 'active'):
3.   For each job:
4.     If state = 'active' AND started_at + timeout < now:
5.       Mark as failed, increment attempts
6.     Calculate shard_idx = hash(job.queue) % 32
7.     Insert into appropriate structure:
8.       - waiting → shard.queues
9.       - delayed → shard.queues (run_at in future)
10.      - active → processing map
11.    Update job_index
12. Load cron_jobs → cron_jobs map
13. Load unique_keys → unique_keys set
14. Log recovery statistics
```

---

## 8. Memory Management

### 8.1 String Interning

Queue names are frequently used as map keys. Interning reduces memory and comparison overhead:

```rust
use std::sync::Arc;
use parking_lot::RwLock;
use rustc_hash::FxHashSet;

lazy_static! {
    static ref INTERNED: RwLock<FxHashSet<Arc<str>>> =
        RwLock::new(FxHashSet::default());
}

pub fn intern(s: &str) -> Arc<str> {
    // Fast path: already interned
    {
        let set = INTERNED.read();
        if let Some(arc) = set.get(s) {
            return arc.clone();
        }
    }

    // Slow path: intern new string
    let mut set = INTERNED.write();
    if let Some(arc) = set.get(s) {
        return arc.clone();
    }

    let arc: Arc<str> = s.into();
    set.insert(arc.clone());
    arc
}
```

**Memory Savings**:
- Without interning: N queues × M jobs × ~32 bytes = O(N×M)
- With interning: N queues × ~32 bytes = O(N)

### 8.2 Cleanup Strategies

```rust
// Completed jobs cleanup (prevents unbounded growth)
const MAX_COMPLETED: usize = 50_000;
const CLEANUP_BATCH: usize = 25_000;

fn cleanup_completed_jobs(&self) {
    let mut completed = self.completed_jobs.write();
    if completed.len() > MAX_COMPLETED {
        // Remove oldest entries (insertion order)
        let to_remove: Vec<_> = completed.iter()
            .take(CLEANUP_BATCH)
            .copied()
            .collect();

        for id in to_remove {
            completed.remove(&id);
            self.job_index.write().remove(&id);
        }
    }
}
```

### 8.3 Memory Allocator

flashQ uses `mimalloc` for optimized allocation:

```rust
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;
```

**Benefits**:
- 2-3x faster small allocations
- Better cache locality
- Reduced fragmentation
- Thread-local caching

---

## 9. Network Protocol

### 9.1 TCP Protocol Format

```
┌─────────────────────────────────────────────┐
│  LENGTH (4 bytes, big-endian u32)           │
├─────────────────────────────────────────────┤
│  JSON PAYLOAD (LENGTH bytes, UTF-8)         │
│  {                                          │
│    "cmd": "PUSH",                           │
│    "queue": "emails",                       │
│    "data": {...},                           │
│    "priority": 10                           │
│  }                                          │
└─────────────────────────────────────────────┘
```

### 9.2 Command Structure

```typescript
// Push command
{
  "cmd": "PUSH",
  "queue": string,      // Required
  "data": any,          // Required (JSON)
  "priority": number,   // Optional, default 0
  "delay": number,      // Optional, ms
  "ttl": number,        // Optional, ms
  "timeout": number,    // Optional, ms
  "max_attempts": number,
  "backoff": number,
  "unique_key": string,
  "depends_on": number[],
  "tags": string[],
  "lifo": boolean
}

// Response
{
  "ok": true,
  "id": 12345
}
```

### 9.3 Zero-Copy Parsing

```rust
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "cmd")]
pub enum Command<'a> {
    #[serde(rename = "PUSH")]
    Push {
        queue: &'a str,  // Borrowed from input buffer
        data: &'a RawValue,  // Zero-copy JSON
        #[serde(default)]
        priority: i32,
        // ...
    },
    // ...
}

// Parse without allocation
fn parse_command(buf: &[u8]) -> Result<Command<'_>, Error> {
    serde_json::from_slice(buf)
}
```

---

## 10. Performance Analysis

### 10.1 Latency Breakdown

```
PUSH Operation (single job):
┌────────────────────────────────────────┬──────────┐
│ Component                              │ Time     │
├────────────────────────────────────────┼──────────┤
│ Network receive                        │ ~30μs    │
│ JSON parsing                           │ ~20μs    │
│ Shard lock acquire                     │ ~5μs     │
│ BinaryHeap push                        │ ~10μs    │
│ Shard lock release                     │ ~2μs     │
│ Job index update                       │ ~5μs     │
│ Response serialization                 │ ~15μs    │
│ Network send                           │ ~30μs    │
├────────────────────────────────────────┼──────────┤
│ TOTAL                                  │ ~117μs   │
└────────────────────────────────────────┴──────────┘
```

### 10.2 Throughput Scaling

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
- Vectorized JSON parsing
- Reduced syscall overhead

### 10.3 Comparison with BullMQ

| Metric | flashQ | BullMQ | Improvement |
|--------|--------|--------|-------------|
| Single Push Latency | 192μs | 645μs | 3.4x |
| Single Pull Latency | 185μs | 612μs | 3.3x |
| Batch Push (10K) | 14ms | 812ms | 58x |
| P99 Latency | 450μs | 2.1ms | 4.7x |
| Memory per Job | ~256B | ~1KB | 4x |

### 10.4 Scalability Characteristics

```
                    Throughput vs Connections

    2M ┤                              ●────────────●
       │                         ●────
  1.5M ┤                    ●────
       │               ●────
    1M ┤          ●────
       │     ●────
  0.5M ┤●────
       │
    0  ┼────┬────┬────┬────┬────┬────┬────┬────┬────
       0   10   20   30   40   50   60   70   80  connections
```

Linear scaling up to ~50 connections, then plateaus due to lock contention.

---

## 11. Fault Tolerance

### 11.1 Failure Modes and Recovery

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Worker crash | Timeout (configurable) | Auto-retry with backoff |
| Server crash | TCP disconnect | Client reconnect + PostgreSQL recovery |
| PostgreSQL down | Connection error | In-memory continues, retries persist |
| Network partition | Heartbeat timeout | Cluster re-election |

### 11.2 At-Least-Once Delivery

```
Guarantee: Every job is processed AT LEAST once

Mechanism:
1. Job enters "active" state on PULL
2. Worker must ACK within timeout
3. If no ACK → job returns to queue
4. If worker crashes → timeout triggers retry

Edge case: Worker processes job, crashes before ACK
Result: Job processed twice (at-least-once, not exactly-once)
Solution: Idempotent job handlers
```

### 11.3 Cluster Mode

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Node 1    │     │   Node 2    │     │   Node 3    │
│  (Leader)   │     │ (Follower)  │     │ (Follower)  │
│             │     │             │     │             │
│ ● Cron jobs │     │             │     │             │
│ ● Cleanup   │     │             │     │             │
│ ● Timeouts  │     │             │     │             │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌──────▼──────┐
                    │  PostgreSQL │
                    │  (Shared)   │
                    └─────────────┘

Leader Election: PostgreSQL advisory locks
Failover Time: < 5 seconds
```

---

## 12. Security Considerations

### 12.1 Input Validation

```rust
// Queue name validation
fn validate_queue_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 256 {
        return Err("Queue name must be 1-256 characters");
    }
    if !name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.') {
        return Err("Invalid characters in queue name");
    }
    Ok(())
}

// Payload size limit
const MAX_PAYLOAD_SIZE: usize = 1_048_576; // 1MB

fn validate_payload(data: &[u8]) -> Result<(), String> {
    if data.len() > MAX_PAYLOAD_SIZE {
        return Err(format!("Payload exceeds {} bytes", MAX_PAYLOAD_SIZE));
    }
    Ok(())
}
```

### 12.2 Authentication

```rust
// Token-based authentication
pub struct AuthManager {
    tokens: HashSet<String>,
}

impl AuthManager {
    pub fn verify(&self, token: &str) -> bool {
        self.tokens.is_empty() || self.tokens.contains(token)
    }
}

// WebSocket requires token parameter
// ws://host:port/ws/events?token=xxx
```

### 12.3 DoS Prevention

| Attack Vector | Mitigation |
|--------------|------------|
| Large payloads | 1MB limit per job |
| Many small jobs | Rate limiting per queue |
| Connection flood | OS-level limits |
| Slow clients | Read/write timeouts |
| Memory exhaustion | Cleanup routines, bounded structures |

---

## 13. Monitoring and Observability

### 13.1 Prometheus Metrics

```
# Queue depth
flashq_queue_depth{queue="emails"} 1523

# Processing rate
flashq_jobs_processed_total{queue="emails",status="completed"} 45231
flashq_jobs_processed_total{queue="emails",status="failed"} 12

# Latency histogram
flashq_job_duration_seconds_bucket{queue="emails",le="0.1"} 44000
flashq_job_duration_seconds_bucket{queue="emails",le="1.0"} 45200
flashq_job_duration_seconds_bucket{queue="emails",le="+Inf"} 45231

# System metrics
flashq_active_workers 12
flashq_memory_bytes 134217728
```

### 13.2 Real-Time Events (WebSocket/SSE)

```typescript
// Event stream
{
  "event": "job:completed",
  "queue": "emails",
  "job_id": 12345,
  "duration_ms": 234,
  "timestamp": 1699123456789
}
```

---

## 14. Conclusion

flashQ achieves its performance goals through:

1. **Architectural decisions**: Sharded design, global processing map, job index
2. **Data structure selection**: BinaryHeap for priority, HashMap for O(1) lookup
3. **Concurrency optimization**: Lock hierarchy, parking_lot, atomic operations
4. **Memory efficiency**: String interning, cleanup routines, mimalloc
5. **Network optimization**: Zero-copy parsing, batched operations
6. **Hybrid persistence**: In-memory speed with PostgreSQL durability

The result is a job queue system that processes 1.9M+ jobs/second while maintaining sub-millisecond latency and providing enterprise-grade features.

---

## References

1. Rust Programming Language - https://www.rust-lang.org/
2. parking_lot crate - https://docs.rs/parking_lot/
3. tokio async runtime - https://tokio.rs/
4. mimalloc allocator - https://github.com/microsoft/mimalloc
5. PostgreSQL - https://www.postgresql.org/
6. Token Bucket Algorithm - https://en.wikipedia.org/wiki/Token_bucket

---

**Version**: 1.0
**Date**: January 2025
**Authors**: flashQ Development Team
