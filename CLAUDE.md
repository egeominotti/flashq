# CLAUDE.md

---

## LEAD SOFTWARE ARCHITECT

You are my lead software architect and full-stack engineer.

You are responsible for building and maintaining a production-grade app that adheres to a strict custom architecture defined below. Your goal is to deeply understand and follow the structure, naming conventions, and separation of concerns. Every generated file, function, and feature must be consistent with the architecture and production-ready standards.

Before writing ANY code: read the ARCHITECTURE, understand where the new code fits, and state your reasoning. If something conflicts with the architecture, stop and ask.

---

ARCHITECTURE:
[ARCHITECTURE]

TECH STACK:
[TECH_STACK]

PROJECT & CURRENT TASK:
[PROJECT]

CODING STANDARDS:
[STANDARDS]

---

RESPONSIBILITIES:

1. CODE GENERATION & ORGANIZATION
   • Create files ONLY in correct directories per architecture (e.g., /backend/src/api/ for controllers, /frontend/src/components/ for UI, /common/types/ for shared models)
   • Maintain strict separation between frontend, backend, and shared code
   • Use only technologies defined in the architecture
   • Follow naming conventions: camelCase functions, PascalCase components, kebab-case files
   • Every function must be fully typed — no implicit any

2. CONTEXT-AWARE DEVELOPMENT
   • Before generating code, read and interpret the relevant architecture section
   • Infer dependencies between layers (how frontend/services consume backend/api endpoints)
   • When adding features, describe where they fit in architecture and why
   • Cross-reference existing patterns before creating new ones
   • If request conflicts with architecture, STOP and ask for clarification

3. DOCUMENTATION & SCALABILITY
   • Update ARCHITECTURE when structural changes occur
   • Auto-generate docstrings, type definitions, and comments following existing format
   • Suggest improvements that enhance maintainability without breaking architecture
   • Document technical debt directly in code comments

4. TESTING & QUALITY
   • Generate matching test files in /tests/ for every module
   • Use appropriate frameworks (Jest, Vitest, Pytest) and quality tools (ESLint, Prettier)
   • Maintain strict type coverage and linting standards
   • Include unit tests and integration tests for critical paths

5. SECURITY & RELIABILITY
   • Implement secure auth (JWT, OAuth2) and encryption (TLS, AES-256)
   • Include robust error handling, input validation, and logging
   • NEVER hardcode secrets — use environment variables
   • Sanitize all user inputs, implement rate limiting

6. INFRASTRUCTURE & DEPLOYMENT
   • Generate Dockerfiles, CI/CD configs per /scripts/ and /.github/ conventions
   • Ensure reproducible, documented deployments
   • Include health checks and monitoring hooks

7. ROADMAP INTEGRATION
   • Annotate potential debt and optimizations for future developers
   • Flag breaking changes before implementing

---

RULES:

NEVER:
• Modify code outside the explicit request
• Install packages without explaining why
• Create duplicate code — find existing solutions first
• Skip types or error handling
• Generate code without stating target directory first
• Assume — ask if unclear
• Repeat the same pattern 3+ times — use macros/helpers instead (DRY principle)

ALWAYS:
• Read architecture before writing code
• State filepath and reasoning BEFORE creating files
• Show dependencies and consumers
• Include comprehensive types and comments
• Suggest relevant tests after implementation
• Prefer composition over inheritance
• Keep functions small and single-purpose
• **DRY (Don't Repeat Yourself)**: Extract repeated patterns into macros, helpers, or shared functions. If you see the same logic 3+ times, refactor it.

---

OUTPUT FORMAT:

When creating files:

📁 [filepath]
Purpose: [one line]
Depends on: [imports]
Used by: [consumers]

```[language]
[fully typed, documented code]
```

Tests: [what to test]

When architecture changes needed:

⚠️ ARCHITECTURE UPDATE
What: [change]
Why: [reason]
Impact: [consequences]

---

Now read the architecture and help me build. If anything is unclear, ask before coding.

This file provides guidance to Claude Code (claude.ai/code) when working with this codebase.

## Project Overview

flashQ is a high-performance job queue server built with Rust.

## Key Commands

### Server (Rust)

```bash
cd engine

# Development
cargo run

# Production (optimized)
cargo run --release

# With HTTP API & Dashboard
HTTP=1 cargo run --release

# With gRPC API
GRPC=1 cargo run --release

# With Unix socket
UNIX_SOCKET=1 cargo run --release

# With custom NATS URL
NATS_URL=nats://localhost:4222 cargo run --release

# Run tests
cargo test
```

### TypeScript SDK (Bun)

```bash
cd sdk/typescript

# Run unit tests
bun test

# Run benchmarks
bun run examples/benchmark-full.ts
```

### Docker Compose (Recommended)

```bash
# Start NATS + flashQ
docker-compose up -d

# View logs
docker-compose logs -f flashq
```

### Docker (Standalone)

```bash
# Build and run
docker build -t flashq .
docker run -p 6789:6789 flashq
```

## Architecture

### Server Structure (< 350 lines per file)

```
engine/src/
├── main.rs           # TCP/Unix socket server, command routing
├── http.rs           # HTTP REST API + WebSocket (axum)
├── grpc.rs           # gRPC API (tonic)
├── dashboard.rs      # Web dashboard
├── protocol.rs       # Command/Response types, Job struct, MessagePack serialization
└── queue/
    ├── mod.rs        # Module exports
    ├── types.rs      # IndexedPriorityQueue, RateLimiter, Shard, GlobalMetrics, JobLocation
    ├── manager.rs    # QueueManager struct, DashMap job_index, sharded processing
    ├── storage.rs    # Storage trait abstraction for NATS backend
    ├── nats/         # NATS JetStream distributed storage
    │   ├── mod.rs    # Module exports
    │   ├── config.rs # NATS configuration
    │   ├── connection.rs # Client management
    │   ├── streams.rs # Stream/subject setup
    │   ├── kv.rs     # KV store wrapper
    │   ├── push.rs   # Push operations
    │   ├── pull.rs   # Pull with priority
    │   ├── ack.rs    # Ack/fail operations
    │   ├── scheduler.rs # Delayed job promotion
    │   ├── leader.rs # Leader election
    │   └── storage.rs # NatsStorage implementation
    ├── core.rs       # Core ops: push, pull, ack, fail
    ├── features.rs   # Advanced: cancel, progress, DLQ, cron, metrics, BullMQ-like ops
    ├── background.rs # Background tasks: cleanup, cron runner
    └── tests/        # Unit tests
```

### Key Design Decisions

1. **32 Shards**: Queues are sharded by queue name for parallel access
2. **32 Sharded Processing**: Jobs in processing are distributed across 32 shards (-97% contention on ack/fail)
3. **IndexedPriorityQueue**: O(log n) for cancel/update/promote operations (vs O(n) with BinaryHeap)
4. **DashMap for job_index**: Lock-free concurrent HashMap for O(1) job location lookup
5. **CompactString**: Inline strings up to 24 chars for queue names (zero heap allocation)
6. **parking_lot Locks**: Faster than std::sync
7. **Binary Protocol**: MessagePack support for 40% smaller payloads, 3-5x faster serialization
8. **Implicit Job State**: State is determined by job location (queues, processing, dlq, etc.)

### Performance Optimizations (Tier 1 & 2)

| Optimization | Benefit |
|--------------|---------|
| DashMap job_index | Lock-free O(1) lookups, 40% faster |
| Sharded processing | -97% contention on ack/fail |
| CompactString | Zero heap alloc for short queue names |
| IndexedPriorityQueue | O(log n) cancel/update/promote (vs O(n)) |
| MessagePack protocol | 40% smaller wire size, 3-5x faster serialization |

## Protocol Commands

### Core Operations

| Command | Description                                               |
| ------- | --------------------------------------------------------- |
| PUSH    | Push job with options (priority, delay, ttl, jobId, etc.) |
| PUSHB   | Batch push                                                |
| PULL    | Pull single job (blocking)                                |
| PULLB   | Batch pull                                                |
| ACK     | Acknowledge job completion                                |
| ACKB    | Batch acknowledge                                         |
| FAIL    | Fail job (retry or DLQ)                                   |

### Job Query

| Command          | Description                               |
| ---------------- | ----------------------------------------- |
| GETJOB           | Get job with its current state            |
| GETSTATE         | Get job state only                        |
| GETRESULT        | Get job result                            |
| GETJOBBYCUSTOMID | Get job by custom ID (idempotency lookup) |
| GETJOBS          | List jobs with filtering and pagination   |
| GETJOBCOUNTS     | Get job counts grouped by state           |
| COUNT            | Count waiting + delayed jobs in queue     |

### Job Management

| Command        | Description                                  |
| -------------- | -------------------------------------------- |
| CANCEL         | Cancel pending job                           |
| PROGRESS       | Update job progress                          |
| GETPROGRESS    | Get job progress                             |
| WAITJOB        | Wait for job completion (finished() promise) |
| UPDATE         | Update job data while waiting/processing     |
| CHANGEPRIORITY | Change job priority at runtime               |
| MOVETODELAYED  | Move active job back to delayed              |
| PROMOTE        | Move delayed job to waiting immediately      |
| DISCARD        | Move job directly to DLQ                     |

### Queue Management

| Command    | Description                                    |
| ---------- | ---------------------------------------------- |
| PAUSE      | Pause queue                                    |
| RESUME     | Resume queue                                   |
| ISPAUSED   | Check if queue is paused                       |
| DRAIN      | Remove all waiting jobs from queue             |
| OBLITERATE | Remove ALL queue data (jobs, DLQ, cron, state) |
| CLEAN      | Cleanup jobs by age and state                  |
| LISTQUEUES | List all queues                                |

### DLQ & Retry

| Command  | Description                |
| -------- | -------------------------- |
| DLQ      | Get dead letter queue jobs |
| RETRYDLQ | Retry DLQ jobs             |

### Rate & Concurrency Control

| Command          | Description             |
| ---------------- | ----------------------- |
| RATELIMIT        | Set queue rate limit    |
| RATELIMITCLEAR   | Clear rate limit        |
| SETCONCURRENCY   | Set concurrency limit   |
| CLEARCONCURRENCY | Clear concurrency limit |

### Cron & Scheduling

| Command    | Description     |
| ---------- | --------------- |
| CRON       | Add cron job    |
| CRONDELETE | Delete cron job |
| CRONLIST   | List cron jobs  |

### Monitoring

| Command | Description          |
| ------- | -------------------- |
| STATS   | Get queue stats      |
| METRICS | Get detailed metrics |

## Job States

| State            | Location               | Description              |
| ---------------- | ---------------------- | ------------------------ |
| waiting          | queues (BinaryHeap)    | Ready to be processed    |
| delayed          | queues (run_at > now)  | Scheduled for future     |
| active           | processing (HashMap)   | Being processed          |
| completed        | completed_jobs (Set)   | Successfully done        |
| failed           | dlq (VecDeque)         | In dead letter queue     |
| waiting-children | waiting_deps (HashMap) | Waiting for dependencies |

## Job Lifecycle Flow

```
PUSH --> [WAITING/DELAYED/WAITING_CHILDREN]
              |
              v (time/deps ready)
           [WAITING]
              |
              v (PULL)
           [ACTIVE]
              |
     +--------+--------+
     |                 |
   ACK               FAIL
     |                 |
     v                 v
[COMPLETED]    attempts < max?
                  |        |
                 YES       NO
                  |        |
                  v        v
              [RETRY]   [DLQ]
                  |
                  v
              [WAITING]
```

## Background Task Intervals

| Task    | Interval | Description                          |
| ------- | -------- | ------------------------------------ |
| Wakeup  | 100ms    | Notify workers, check dependencies   |
| Timeout | 500ms    | Check and fail timed-out jobs        |
| Cron    | 1s       | Execute scheduled cron jobs          |
| Metrics | 5s       | Collect metrics history              |
| Cleanup | 60s      | Clean completed jobs, results, index |

## Features

### Core

- Batch operations (PUSH/PULL/ACK)
- Job priorities (BinaryHeap)
- Delayed jobs (run_at timestamp)
- Job state tracking (GETJOB/GETSTATE)
- NATS JetStream persistence - distributed, horizontally scalable

### Advanced

- **Dead Letter Queue**: max_attempts → DLQ
- **Exponential Backoff**: backoff \* 2^attempts
- **Job TTL**: Automatic expiration
- **Unique Jobs**: Deduplication by key
- **Job Dependencies**: depends_on array
- **Rate Limiting**: Token bucket per queue
- **Concurrency Control**: Limit parallel processing
- **Progress Tracking**: 0-100% with message
- **Cron Jobs**: Full 6-field cron expressions (sec min hour day month weekday)
- **Pause/Resume**: Dynamic queue control
- **WebSocket**: Real-time events with token auth
- **SSE**: Server-Sent Events for job lifecycle
- **Webhooks**: HTTP callbacks on job events
- **Prometheus Metrics**: `/metrics/prometheus` endpoint
- **Clustering/HA**: Multi-node support with automatic leader election

### BullMQ-like Features (NEW)

- **Custom Job ID**: Idempotent job creation with `jobId` option
- **getJobByCustomId**: Lookup jobs by user-provided ID
- **finished()**: Wait for job completion (synchronous workflows)
- **Retention Policies**: `keepCompletedAge`, `keepCompletedCount`
- **drain()**: Remove all waiting jobs from queue
- **obliterate()**: Remove ALL queue data
- **clean()**: Cleanup jobs by age and state
- **changePriority()**: Change job priority at runtime
- **moveToDelayed()**: Move active job back to delayed
- **promote()**: Move delayed job to waiting immediately
- **update()**: Update job data while waiting/processing
- **discard()**: Move job directly to DLQ
- **getJobs()**: List jobs with filtering and pagination
- **getJobCounts()**: Get job counts grouped by state
- **count()**: Count waiting + delayed jobs
- **isPaused()**: Check if queue is paused

## Clustering (High Availability)

flashQ supports clustering for high availability using NATS JetStream as the coordination and persistence layer.

### Environment Variables

| Variable              | Description                                        |
| --------------------- | -------------------------------------------------- |
| `NATS_URL`            | NATS server URL (default: nats://localhost:4222)   |
| `NODE_ID=node-1`      | Unique node identifier (auto-generated if not set) |
| `NODE_HOST=localhost` | Host address for node registration                 |
| `NATS_STREAM_REPLICAS`| Stream replicas for HA (default: 1, use 3 for prod)|
| `NATS_KV_REPLICAS`    | KV store replicas (default: 1, use 3 for prod)     |

### Architecture

```
┌──────────┐    ┌──────────┐    ┌──────────┐
│  Node 1  │    │  Node 2  │    │  Node 3  │
│ (Leader) │    │(Follower)│    │(Follower)│
└────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │
     └───────────────┼───────────────┘
                     │
         ┌───────────▼───────────┐
         │  NATS JetStream       │
         │  (Distributed)        │
         └───────────────────────┘
```

### Leader Election

- Uses NATS JetStream KV store for distributed leader election
- Only the leader runs background tasks (cron, cleanup, timeout checks)
- All nodes handle client requests (push/pull/ack)
- Automatic failover when leader crashes (within 5 seconds)
- Stale nodes cleaned up after 30 seconds of no heartbeat

### HTTP Endpoints

| Endpoint             | Description                             |
| -------------------- | --------------------------------------- |
| `GET /health`        | Node health with leader/follower status |
| `GET /cluster/nodes` | List all nodes in cluster               |

### Example: Multi-Node Setup

```bash
# Start NATS with JetStream
docker run -d --name nats -p 4222:4222 nats:latest -js

# Start Node 1 (becomes leader)
NODE_ID=node-1 NATS_URL=nats://localhost:4222 HTTP=1 HTTP_PORT=6790 PORT=6789 ./flashq-server

# Start Node 2 (becomes follower)
NODE_ID=node-2 NATS_URL=nats://localhost:4222 HTTP=1 HTTP_PORT=6792 PORT=6793 ./flashq-server

# Check cluster status
curl http://localhost:6790/cluster/nodes
```

## NATS JetStream Persistence

flashQ uses NATS JetStream as the distributed persistence backend, enabling horizontal scaling and high availability.

### Environment Variables

| Variable              | Description                                        |
| --------------------- | -------------------------------------------------- |
| `NATS_URL`            | NATS server URL (default: nats://localhost:4222)   |
| `NATS_STREAM_REPLICAS`| Stream replicas for HA (default: 1, use 3 for prod)|
| `NATS_KV_REPLICAS`    | KV store replicas (default: 1, use 3 for prod)     |

### Running with NATS

```bash
# Start NATS with JetStream
docker run -d --name nats -p 4222:4222 nats:latest -js

# Run flashQ
NATS_URL=nats://localhost:4222 cargo run --release

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    NATS JetStream Cluster                   │
├─────────────────────────────────────────────────────────────┤
│  STREAMS (per queue):                                       │
│  - flashq.{queue}.priority.high/normal/low                  │
│  - flashq.{queue}.delayed                                   │
│  - flashq.{queue}.dlq                                       │
│                                                             │
│  KV STORES:                                                 │
│  - flashq-jobs (job metadata)                               │
│  - flashq-results (job results)                             │
│  - flashq-state (queue state, limits)                       │
│  - flashq-custom-ids (idempotency)                          │
│  - flashq-progress (job progress)                           │
│  - flashq-crons (cron job definitions)                      │
│  - flashq-webhooks (webhook configurations)                 │
└─────────────────────────────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
   ┌───────────┐      ┌───────────┐      ┌───────────┐
   │ flashQ #1 │      │ flashQ #2 │      │ flashQ #N │
   │(stateless)│      │(stateless)│      │(stateless)│
   └───────────┘      └───────────┘      └───────────┘
```

### Recovery on Restart

NATS persistence includes full recovery of all data types:

| Data Type        | Recovery Method                                    |
| ---------------- | -------------------------------------------------- |
| Waiting jobs     | Loaded from KV, placed in memory queues            |
| Delayed jobs     | Loaded from KV, placed in queues (run_at > now)    |
| Jobs with deps   | Loaded from KV, placed in waiting_deps             |
| DLQ jobs         | Identified by attempts >= max_attempts             |
| Cron jobs        | Loaded from flashq-crons KV store                  |
| Webhooks         | Loaded from flashq-webhooks KV store               |
| Job ID counter   | Synced from max job ID in KV                       |

### Leader Election

- Uses NATS KV for distributed leader election
- Only the leader runs background tasks (cron, delayed job promotion)
- All nodes handle client requests
- Automatic failover when leader disconnects

### Quick Start with Docker

```bash
# Start NATS with JetStream
docker run -d --name nats -p 4222:4222 nats:latest -js

# Start flashQ with NATS
FLASHQ_STORAGE=nats NATS_URL=nats://localhost:4222 cargo run --release --bin flashq-server --features nats
```

## Common Tasks

### Adding a new command

1. Add variant to `Command` enum in `protocol.rs`
2. Add response type if needed
3. Handle in `process_command()` in `main.rs`
4. Implement in appropriate `queue/*.rs` file

### Adding tests

Add to `engine/src/queue/tests.rs`:

```rust
#[tokio::test]
async fn test_feature_name() {
    let qm = setup();
    // Test logic
    assert!(result.is_ok());
}
```

## CI/CD Pipeline

GitHub Actions runs on every push to `main` and on PRs.

### Pipeline Jobs

| Job                   | Description                      |
| --------------------- | -------------------------------- |
| `test-server`         | Format check, clippy, unit tests |
| `build-server`        | Build release binary             |
| `test-sdk-typescript` | Test SDK against running server  |
| `build-docker`        | Build Docker image               |

### Pre-Push Checklist

⚠️ **MANDATORY: Run these commands before EVERY push:**

```bash
cd engine

# 1. Format code (auto-fix)
cargo fmt

# 2. Check formatting passes
cargo fmt --check

# 3. Run clippy (warnings = errors) - MUST PASS
cargo clippy -- -D warnings

# 4. Run tests - MUST PASS
cargo test
```

**CI will fail if any of these checks fail.** Always verify locally first.

### CI Requirements

- `protobuf-compiler` is required for gRPC build
- Clippy treats all warnings as errors (`-D warnings`)
- Code must pass `cargo fmt --check`

## Performance

| Metric                | Throughput    |
| --------------------- | ------------- |
| Push (batch)          | 1.9M jobs/sec |
| Processing (no-op)    | 280k jobs/sec |
| Processing (CPU work) | 196k jobs/sec |

### Optimizations

- mimalloc allocator
- parking_lot locks
- Atomic u64 IDs
- 32 shards
- LTO build
- Coarse timestamps (cached)
- String interning

## Security

### Input Validation

- **Queue names**: Only alphanumeric, underscore, hyphen, dot allowed (max 256 chars)
- **Job data size**: Max 10MB per job (supports AI/ML workloads like embeddings)
- **Batch limits**: Max 1000 jobs per batch request (gRPC/HTTP)
- **Cron schedules**: Max 256 chars, validated before saving

### Memory Management

- **Completed jobs**: Cleanup when exceeding 50K entries (removes oldest 25K)
- **Job results**: Cleanup when exceeding 5K entries (removes oldest 2.5K)
- **Job index**: Stale entries cleaned when exceeding 100K
- **Interned strings**: Limited to 10K unique queue names

### Authentication

- Token-based auth via `AUTH_TOKENS` env variable
- WebSocket connections require `?token=xxx` parameter
- HMAC-SHA256 webhook signatures using `hmac` and `sha2` crates

### Prometheus Metrics

- Queue names in labels are escaped to prevent injection attacks

### gRPC Streaming

- Stream connections use timeout-based polling to detect client disconnects
- Prevents resource leaks from abandoned streams

## Stress Test Results

The system has been validated with 33 stress tests:

| Test                                 | Result                            |
| ------------------------------------ | --------------------------------- |
| Concurrent Push (10 connections)     | 59,000 ops/sec                    |
| Batch Operations (10K jobs)          | Push: 14ms, Pull+Ack: 29ms        |
| Large Payloads (500KB)               | Integrity preserved               |
| Many Queues (50 simultaneous)        | All processed                     |
| Rate Limiting                        | Enforced correctly                |
| Concurrency Limit (5)                | Max concurrent respected          |
| DLQ Flood (100 jobs)                 | 100% to DLQ, 100% retry           |
| Rapid Cancel (100 concurrent)        | 100% cancelled                    |
| Invalid Input (7 attacks)            | 100% rejected                     |
| Connection Churn (50 cycles)         | 100% success                      |
| Unique Key Collision (50 concurrent) | Deduplication works               |
| Sustained Load (30s)                 | 22K push/s, 11K pull/s, 0% errors |

## SDK Structure

```
sdk/typescript/
├── src/
│   ├── index.ts    # Main exports
│   ├── client.ts   # flashQ client (TCP/HTTP/Binary)
│   ├── worker.ts   # Worker class for job processing
│   ├── queue.ts    # Queue class (BullMQ-compatible)
│   ├── sandbox.ts  # Sandboxed processors (isolated workers)
│   └── types.ts    # TypeScript type definitions
├── tests/
│   ├── client.test.ts      # Client unit tests (980 lines)
│   ├── worker.test.ts      # Worker tests (565 lines)
│   ├── events.test.ts      # Event emitter tests (594 lines)
│   ├── integration.test.ts # E2E workflow tests (392 lines)
│   ├── queue.test.ts       # Queue class tests (187 lines)
│   └── types.test.ts       # Type definition tests (141 lines)
└── examples/
    ├── 01-basic.ts ... 15-unique.ts  # Usage examples
    └── *-benchmark.ts                 # Performance benchmarks
```

### SDK Client Options

```typescript
const client = new FlashQ({
  host: 'localhost',        // Server host (default: localhost)
  port: 6789,               // TCP port (default: 6789)
  httpPort: 6790,           // HTTP port (default: 6790)
  token: 'secret',          // Auth token (optional)
  timeout: 5000,            // Connection timeout (default: 5000ms)
  useHttp: false,           // Use HTTP instead of TCP (default: false)
  useBinary: false,         // Use MessagePack binary protocol (default: false)
});
```

**Binary Protocol (MessagePack)**: Enable `useBinary: true` for 40% smaller payloads and 3-5x faster serialization. Recommended for high-throughput scenarios.

### SDK Client Methods

#### Core Operations

| Method                        | Description                                   |
| ----------------------------- | --------------------------------------------- |
| `connect()`                   | Connect to server                             |
| `close()`                     | Close connection                              |
| `auth(token)`                 | Late authentication                           |
| `push(queue, data, options?)` | Push a job (supports `jobId` for idempotency) |
| `pushBatch(queue, jobs)`      | Push multiple jobs                            |
| `pushFlow(queue, flow)`       | Push workflow with dependencies               |
| `pull(queue)`                 | Pull a job (blocking)                         |
| `pullBatch(queue, count)`     | Pull multiple jobs                            |
| `ack(jobId, result?)`         | Acknowledge job                               |
| `ackBatch(jobIds)`            | Acknowledge multiple jobs                     |
| `fail(jobId, error?)`         | Fail a job                                    |

#### Job Query

| Method                                    | Description                  |
| ----------------------------------------- | ---------------------------- |
| `getJob(jobId)`                           | Get job with state           |
| `getState(jobId)`                         | Get job state only           |
| `getResult(jobId)`                        | Get job result               |
| `getJobByCustomId(customId)`              | Lookup job by custom ID      |
| `getJobs(queue, state?, limit?, offset?)` | List jobs with filtering     |
| `getJobCounts(queue)`                     | Get counts by state          |
| `count(queue)`                            | Count waiting + delayed jobs |

#### Job Management

| Method                                | Description                          |
| ------------------------------------- | ------------------------------------ |
| `cancel(jobId)`                       | Cancel a pending job                 |
| `progress(jobId, progress, message?)` | Update progress                      |
| `getProgress(jobId)`                  | Get job progress                     |
| `finished(jobId, timeout?)`           | Wait for job completion              |
| `update(jobId, data)`                 | Update job data                      |
| `changePriority(jobId, priority)`     | Change job priority                  |
| `moveToDelayed(jobId, delay)`         | Move to delayed                      |
| `promote(jobId)`                      | Move delayed to waiting              |
| `discard(jobId)`                      | Move to DLQ                          |
| `heartbeat(jobId)`                    | Send heartbeat for long-running jobs |
| `log(jobId, message, level?)`         | Add log entry to job                 |
| `getLogs(jobId)`                      | Get job log entries                  |
| `getChildren(jobId)`                  | Get child jobs (for flows)           |

#### Queue Management

| Method                               | Description             |
| ------------------------------------ | ----------------------- |
| `pause(queue)`                       | Pause a queue           |
| `resume(queue)`                      | Resume a queue          |
| `isPaused(queue)`                    | Check if paused         |
| `drain(queue)`                       | Remove all waiting jobs |
| `obliterate(queue)`                  | Remove ALL queue data   |
| `clean(queue, grace, state, limit?)` | Cleanup by age/state    |
| `listQueues()`                       | List all queues         |

#### DLQ & Rate Limiting

| Method                         | Description             |
| ------------------------------ | ----------------------- |
| `getDlq(queue, count?)`        | Get DLQ jobs            |
| `retryDlq(queue, jobId?)`      | Retry DLQ jobs          |
| `setRateLimit(queue, limit)`   | Set rate limit          |
| `clearRateLimit(queue)`        | Clear rate limit        |
| `setConcurrency(queue, limit)` | Set concurrency limit   |
| `clearConcurrency(queue)`      | Clear concurrency limit |

#### Cron & Monitoring

| Method                   | Description          |
| ------------------------ | -------------------- |
| `addCron(name, options)` | Add cron job         |
| `deleteCron(name)`       | Delete cron job      |
| `listCrons()`            | List cron jobs       |
| `stats()`                | Get queue statistics |
| `metrics()`              | Get detailed metrics |

### Push Options

```typescript
await client.push("queue", data, {
  priority: 10, // Higher = processed first
  delay: 5000, // Delay in ms
  ttl: 60000, // Time-to-live in ms
  timeout: 30000, // Processing timeout
  max_attempts: 3, // Retry attempts
  backoff: 1000, // Exponential backoff base
  unique_key: "key", // Deduplication key
  depends_on: [1, 2], // Job dependencies
  tags: ["tag1"], // Job tags
  lifo: false, // LIFO mode
  stall_timeout: 30000, // Stall detection
  debounce_id: "event", // Debounce ID
  debounce_ttl: 5000, // Debounce window
  // NEW: Idempotency & Retention
  jobId: "order-123", // Custom job ID for idempotency
  keepCompletedAge: 86400000, // Keep result for 24h
  keepCompletedCount: 100, // Keep in last 100 completed
});
```

---

## Engine Security Audit (2026-01-22)

### Audit Summary

The flashQ engine codebase has been thoroughly analyzed for critical errors, race conditions, memory leaks, and security vulnerabilities. **The engine is production-ready and well-designed.**

### Verified Safe Patterns

The following patterns were analyzed and confirmed to be correctly implemented:

| Pattern | Location | Why It's Safe |
|---------|----------|---------------|
| **Multiple `get_state()` calls** | `pull.rs:32,105` | Same write lock scope, Rust ownership rules apply |
| **job_waiters cleanup** | `query.rs:147-161,167-173` | Explicit cleanup on timeout AND completion |
| **custom_id_map rollback** | `push.rs:101-104,144-146,165-166` | Full transactional rollback on persistence failure |
| **Debounce cache cleanup** | `logs.rs:70-81`, `background.rs:54` | Called every 10s, removes expired entries |
| **Stale index cleanup** | `background.rs:260-314` | Job movement creates new index BEFORE cleanup runs |

### Security Features Implemented

| Feature | Location | Description |
|---------|----------|-------------|
| **Constant-time token comparison** | `manager.rs:34-43` | Prevents timing attacks on auth |
| **Input validation** | `validation.rs` | Queue names, job data size, batch limits |
| **HMAC-SHA256 webhooks** | `admin.rs` | Signed webhook payloads |
| **Sharded processing** | `manager.rs:452-454` | -97% lock contention |
| **Lock-free job_index** | `manager.rs:57` | DashMap for O(1) concurrent lookups |

### Concurrency Model

```
┌─────────────────────────────────────────────────────────────┐
│                    QueueManager                              │
├─────────────────────────────────────────────────────────────┤
│  shards[32]              │  processing_shards[32]           │
│  ├── RwLock<Shard>       │  ├── RwLock<HashMap<u64,Job>>   │
│  │   ├── queues          │  │                               │
│  │   ├── dlq             │  Sharded by: job_id & 0x1F      │
│  │   ├── waiting_deps    │                                  │
│  │   └── queue_state     │                                  │
│  Sharded by: hash(queue) │                                  │
├─────────────────────────────────────────────────────────────┤
│  job_index: DashMap<u64, JobLocation>  (lock-free)          │
│  completed_jobs: RwLock<HashSet<u64>>                       │
│  custom_id_map: RwLock<HashMap<String, u64>>                │
└─────────────────────────────────────────────────────────────┘
```

### Background Tasks Safety

| Task | Interval | Safety Mechanism |
|------|----------|------------------|
| `cleanup_completed_jobs` | 10s | Threshold-based (>50K triggers cleanup) |
| `cleanup_job_results` | 10s | Threshold-based (>10K triggers cleanup) |
| `cleanup_stale_index_entries` | 10s | Only runs when index >100K entries |
| `cleanup_debounce_cache` | 10s | Timestamp-based expiry check |
| `check_timed_out_jobs` | 500ms | Atomic job state transitions |
| `check_dependencies` | 500ms | Read lock on completed_jobs |

### Minor Improvements (Optional)

| Issue | Severity | Location | Recommendation |
|-------|----------|----------|----------------|
| Auth empty check timing | LOW | `manager.rs:292-294` | Early return reveals auth is disabled |
| No rate limit on AUTH | MEDIUM | TCP handler | Add per-connection rate limiting |

### Code Quality Metrics

- **Lock granularity**: Fine-grained (32 shards + 32 processing shards)
- **Async safety**: All persistence operations have sync/async modes
- **Error handling**: Result types throughout, proper rollback on failure
- **Memory bounds**: All caches have configurable thresholds
- **Test coverage**: 456 unit tests in `queue/tests/`

### False Positives Debunked

These issues were initially flagged but are NOT bugs:

1. **"Race condition in pull operations"** - FALSE
   - `get_state()` returns mutable reference within same lock scope
   - Rust's borrow checker ensures safety at compile time

2. **"Memory leak in job_waiters"** - FALSE
   - Timeout handler (lines 147-161) cleans up closed channels
   - Completion handler (line 168) removes entire entry

3. **"Custom ID desynchronization"** - FALSE
   - Rollback code at lines 101-104, 144-146, 165-166
   - Atomic check+insert pattern prevents race

4. **"Unbounded debounce cache"** - FALSE
   - `cleanup_debounce_cache()` exists and runs every 10 seconds
   - Uses timestamp-based expiry

5. **"Stale index cleanup race"** - MINOR (not critical)
   - New job location is indexed BEFORE cleanup runs
   - Worst case: old entry persists one cleanup cycle

### Audit Conclusion

**The flashQ engine is production-ready.** The codebase demonstrates:
- Proper use of Rust's ownership and borrowing
- Correct concurrent data structure usage
- Transactional rollback on failures
- Bounded memory growth with automatic cleanup
- Defense against timing attacks on authentication
