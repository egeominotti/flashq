# flashQ TypeScript SDK - Complete Documentation

> **Version 0.3.x** | [Website](https://flashq.dev) | [Quick Start](https://flashq.dev/docs/)

This document provides comprehensive documentation for the flashQ TypeScript SDK, including all APIs, types, configurations, and usage patterns.

---

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Architecture](#architecture)
4. [FlashQ Client](#flashq-client)
   - [Connection Options](#connection-options)
   - [Core Methods](#core-methods)
   - [Job Management Methods](#job-management-methods)
   - [Queue Management Methods](#queue-management-methods)
   - [Cron Jobs](#cron-jobs)
   - [Metrics and Monitoring](#metrics-and-monitoring)
5. [Queue Class](#queue-class)
6. [Worker Class](#worker-class)
7. [Error Handling](#error-handling)
8. [Retry Logic](#retry-logic)
9. [Observability Hooks](#observability-hooks)
10. [Logger](#logger)
11. [Types Reference](#types-reference)
12. [Best Practices](#best-practices)

---

## Overview

flashQ is a high-performance job queue built with Rust, designed as a drop-in replacement for BullMQ without requiring Redis. The TypeScript SDK provides:

- **BullMQ-compatible API** for easy migration
- **Direct TCP protocol** with optional HTTP fallback
- **MessagePack binary protocol** for 40% smaller payloads
- **Typed error handling** with retryable error detection
- **Observability hooks** for OpenTelemetry/DataDog integration
- **Graceful shutdown** with configurable timeouts

### Key Features

| Feature | Description |
|---------|-------------|
| **10MB Payloads** | Support for large AI/ML workloads |
| **Job Dependencies** | Chain jobs with `depends_on` |
| **Priority Queues** | Higher priority = processed first |
| **Rate Limiting** | Token bucket algorithm per queue |
| **Concurrency Control** | Limit parallel processing |
| **Dead Letter Queue** | Automatic DLQ after max retries |
| **Cron Jobs** | 6-field cron expressions |
| **Progress Tracking** | Real-time progress updates |

---

## Installation

```bash
npm install flashq
# or
yarn add flashq
# or
bun add flashq
```

### Requirements

- Node.js >= 18.0.0 or Bun
- flashQ server running (Docker recommended)

```bash
docker run -d --name flashq \
  -p 6789:6789 \
  -p 6790:6790 \
  -e HTTP=1 \
  ghcr.io/egeominotti/flashq:latest
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Application                         │
├─────────────────────────────────────────────────────────────┤
│  Queue (BullMQ API)  │  Worker (BullMQ API)  │  FlashQ Client│
├─────────────────────────────────────────────────────────────┤
│                    Connection Layer                          │
│         TCP (Binary/JSON)  │  HTTP (REST API)               │
├─────────────────────────────────────────────────────────────┤
│                    flashQ Server (Rust)                      │
│     32 Shards  │  DashMap  │  io_uring  │  PostgreSQL       │
└─────────────────────────────────────────────────────────────┘
```

### Protocol Options

| Protocol | Use Case | Performance |
|----------|----------|-------------|
| **TCP + JSON** | Default, debugging | Good |
| **TCP + MessagePack** | Production, high throughput | Best (40% smaller) |
| **HTTP + JSON** | Firewalls, load balancers | Good |

---

## FlashQ Client

The `FlashQ` class provides direct access to all server operations.

```typescript
import { FlashQ } from 'flashq';

const client = new FlashQ({
  host: 'localhost',
  port: 6789,
});

await client.connect();
// ... use client
await client.close();
```

### Connection Options

```typescript
interface ClientOptions {
  /** Server host (default: 'localhost') */
  host?: string;

  /** TCP port (default: 6789) */
  port?: number;

  /** HTTP port (default: 6790) */
  httpPort?: number;

  /** Unix socket path (alternative to TCP) */
  socketPath?: string;

  /** Auth token for protected servers */
  token?: string;

  /** Connection timeout in ms (default: 5000) */
  timeout?: number;

  /** Use HTTP instead of TCP (default: false) */
  useHttp?: boolean;

  /** Use MessagePack binary protocol (default: false) */
  useBinary?: boolean;

  /** Enable auto-reconnect on connection loss (default: true) */
  autoReconnect?: boolean;

  /** Max reconnect attempts (default: 10, 0 = infinite) */
  maxReconnectAttempts?: number;

  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;

  /** Max reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;

  /** Log level (default: 'silent') */
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

  /** Automatic retry configuration */
  retry?: boolean | RetryConfig;

  /** Queue requests during reconnection (default: false) */
  queueOnDisconnect?: boolean;

  /** Max queued requests during disconnect (default: 100) */
  maxQueuedRequests?: number;

  /** Enable request ID tracking (default: false) */
  trackRequestIds?: boolean;

  /** Enable gzip compression for large payloads (default: false) */
  compression?: boolean;

  /** Minimum payload size to compress in bytes (default: 1024) */
  compressionThreshold?: number;

  /** Observability hooks */
  hooks?: ClientHooks;
}
```

### Core Methods

#### `connect(): Promise<void>`

Establish connection to the flashQ server.

```typescript
const client = new FlashQ({ host: 'localhost', port: 6789 });
await client.connect();
```

#### `close(): Promise<void>`

Close the connection gracefully.

```typescript
await client.close();
```

#### `push<T>(queue: string, data: T, options?: PushOptions): Promise<Job>`

Push a job to a queue.

```typescript
const job = await client.push('emails', {
  to: 'user@example.com',
  subject: 'Welcome!'
}, {
  priority: 10,
  delay: 5000,
  max_attempts: 3,
});
```

**PushOptions:**

| Option | Type | Description |
|--------|------|-------------|
| `priority` | `number` | Higher = processed first (default: 0) |
| `delay` | `number` | Delay in ms before job is available |
| `max_attempts` | `number` | Max retry attempts (default: 0) |
| `backoff` | `number` | Backoff base in ms (exponential) |
| `timeout` | `number` | Job timeout in ms |
| `ttl` | `number` | Time-to-live in ms |
| `unique_key` | `string` | Unique key for deduplication |
| `jobId` | `string` | Custom ID for idempotency |
| `depends_on` | `number[]` | Job IDs that must complete first |
| `tags` | `string[]` | Tags for filtering |
| `lifo` | `boolean` | LIFO mode (stack) |
| `remove_on_complete` | `boolean` | Remove from completed set |
| `remove_on_fail` | `boolean` | Remove from DLQ |
| `stall_timeout` | `number` | Stall detection timeout in ms |
| `debounce_id` | `string` | Debounce ID for grouping |
| `debounce_ttl` | `number` | Debounce window in ms |
| `keepCompletedAge` | `number` | Keep result for this duration (ms) |
| `keepCompletedCount` | `number` | Keep in last N completed |
| `group_id` | `string` | Group ID for FIFO within group |

#### `pushBatch<T>(queue: string, jobs: Array<{data: T} & PushOptions>): Promise<number[]>`

Push multiple jobs in a single batch.

```typescript
const ids = await client.pushBatch('emails', [
  { data: { to: 'user1@example.com' } },
  { data: { to: 'user2@example.com' }, priority: 10 },
]);
```

#### `pushBatchSafe<T>(queue: string, jobs: Array<{data: T} & PushOptions>): Promise<BatchPushResult>`

Push multiple jobs with partial failure handling.

```typescript
const result = await client.pushBatchSafe('emails', jobs);
console.log(`Created: ${result.ids.length}, Failed: ${result.failed.length}`);

if (!result.allSucceeded) {
  for (const f of result.failed) {
    console.error(`Job ${f.index} failed: ${f.error}`);
  }
}
```

#### `pull<T>(queue: string, timeout?: number): Promise<Job<T> | null>`

Pull a job from a queue (blocking with timeout).

```typescript
const job = await client.pull<EmailData>('emails', 5000);
if (job) {
  console.log('Processing:', job.data);
  await client.ack(job.id);
}
```

#### `pullBatch<T>(queue: string, count: number, timeout?: number): Promise<Job<T>[]>`

Pull multiple jobs from a queue.

```typescript
const jobs = await client.pullBatch('emails', 10, 5000);
for (const job of jobs) {
  await processJob(job);
  await client.ack(job.id);
}
```

#### `ack(jobId: number, result?: unknown): Promise<void>`

Acknowledge a job as completed.

```typescript
await client.ack(job.id, { sent: true, timestamp: Date.now() });
```

#### `ackBatch(jobIds: number[]): Promise<number>`

Acknowledge multiple jobs at once.

```typescript
const count = await client.ackBatch([1, 2, 3, 4, 5]);
```

#### `fail(jobId: number, error?: string): Promise<void>`

Fail a job (will retry or move to DLQ).

```typescript
await client.fail(job.id, 'SMTP connection timeout');
```

### Job Management Methods

#### `getJob(jobId: number): Promise<JobWithState | null>`

Get a job with its current state.

```typescript
const result = await client.getJob(123);
if (result) {
  console.log(`Job ${result.job.id} is ${result.state}`);
}
```

#### `getState(jobId: number): Promise<JobState | null>`

Get job state only.

```typescript
const state = await client.getState(123);
// Returns: 'waiting' | 'delayed' | 'active' | 'completed' | 'failed' | null
```

#### `getResult(jobId: number): Promise<unknown | null>`

Get job result after completion.

```typescript
const result = await client.getResult(123);
```

#### `getJobByCustomId(customId: string): Promise<JobWithState | null>`

Lookup job by custom ID (for idempotency).

```typescript
const result = await client.getJobByCustomId('order-12345');
```

#### `getJobs(queue: string, state?: JobState, limit?: number, offset?: number): Promise<Job[]>`

List jobs with filtering and pagination.

```typescript
const failedJobs = await client.getJobs('emails', 'failed', 100, 0);
```

#### `getJobCounts(queue: string): Promise<Record<JobState, number>>`

Get job counts grouped by state.

```typescript
const counts = await client.getJobCounts('emails');
// { waiting: 10, delayed: 5, active: 2, completed: 100, failed: 3 }
```

#### `cancel(jobId: number): Promise<boolean>`

Cancel a pending job.

```typescript
const cancelled = await client.cancel(123);
```

#### `progress(jobId: number, progress: number, message?: string): Promise<void>`

Update job progress (0-100).

```typescript
await client.progress(job.id, 50, 'Processing items...');
await client.progress(job.id, 100, 'Complete');
```

#### `getProgress(jobId: number): Promise<{progress: number, message?: string}>`

Get job progress.

```typescript
const { progress, message } = await client.getProgress(123);
```

#### `finished(jobId: number, timeout?: number): Promise<unknown>`

Wait for job completion and return result.

```typescript
const job = await client.push('processing', data);
const result = await client.finished(job.id, 30000); // 30s timeout
```

#### `update(jobId: number, data: unknown): Promise<void>`

Update job data while waiting/processing.

```typescript
await client.update(job.id, { ...job.data, status: 'updated' });
```

#### `changePriority(jobId: number, priority: number): Promise<void>`

Change job priority at runtime.

```typescript
await client.changePriority(job.id, 100); // Boost priority
```

#### `moveToDelayed(jobId: number, delay: number): Promise<void>`

Move active job back to delayed.

```typescript
await client.moveToDelayed(job.id, 60000); // Delay 1 minute
```

#### `promote(jobId: number): Promise<void>`

Move delayed job to waiting immediately.

```typescript
await client.promote(delayedJobId);
```

#### `discard(jobId: number): Promise<void>`

Move job directly to DLQ.

```typescript
await client.discard(job.id);
```

#### `heartbeat(jobId: number): Promise<void>`

Send heartbeat for long-running jobs.

```typescript
// In a long-running job
const interval = setInterval(() => {
  client.heartbeat(job.id);
}, 10000);
```

#### `log(jobId: number, message: string, level?: 'info' | 'warn' | 'error'): Promise<void>`

Add log entry to job.

```typescript
await client.log(job.id, 'Starting processing', 'info');
await client.log(job.id, 'Warning: rate limit approaching', 'warn');
```

#### `getLogs(jobId: number): Promise<JobLogEntry[]>`

Get job log entries.

```typescript
const logs = await client.getLogs(job.id);
for (const entry of logs) {
  console.log(`[${entry.level}] ${entry.message}`);
}
```

#### `getChildren(jobId: number): Promise<Job[]>`

Get child jobs (for flows).

```typescript
const children = await client.getChildren(parentJobId);
```

### Queue Management Methods

#### `pause(queue: string): Promise<void>`

Pause a queue (stops processing).

```typescript
await client.pause('emails');
```

#### `resume(queue: string): Promise<void>`

Resume a paused queue.

```typescript
await client.resume('emails');
```

#### `isPaused(queue: string): Promise<boolean>`

Check if queue is paused.

```typescript
const paused = await client.isPaused('emails');
```

#### `drain(queue: string): Promise<number>`

Remove all waiting jobs from queue.

```typescript
const removed = await client.drain('emails');
console.log(`Removed ${removed} jobs`);
```

#### `obliterate(queue: string): Promise<void>`

Remove ALL queue data (jobs, DLQ, cron, state).

```typescript
await client.obliterate('test-queue'); // Dangerous!
```

#### `clean(queue: string, grace: number, state: JobState, limit?: number): Promise<number>`

Cleanup jobs by age and state.

```typescript
// Remove completed jobs older than 1 hour
const cleaned = await client.clean('emails', 3600000, 'completed', 1000);
```

#### `listQueues(): Promise<QueueInfo[]>`

List all queues with stats.

```typescript
const queues = await client.listQueues();
for (const q of queues) {
  console.log(`${q.name}: ${q.pending} pending, ${q.processing} active`);
}
```

#### `count(queue: string): Promise<number>`

Count waiting + delayed jobs.

```typescript
const total = await client.count('emails');
```

### Dead Letter Queue

#### `getDlq(queue: string, count?: number): Promise<Job[]>`

Get jobs from dead letter queue.

```typescript
const dlqJobs = await client.getDlq('emails', 100);
```

#### `retryDlq(queue: string, jobId?: number): Promise<number>`

Retry DLQ jobs. If jobId is provided, retries only that job.

```typescript
// Retry all DLQ jobs
const retried = await client.retryDlq('emails');

// Retry specific job
await client.retryDlq('emails', 123);
```

#### `purgeDlq(queue: string): Promise<number>`

Remove all jobs from DLQ.

```typescript
const purged = await client.purgeDlq('emails');
```

### Rate and Concurrency Control

#### `setRateLimit(queue: string, limit: number): Promise<void>`

Set queue rate limit (jobs per second).

```typescript
await client.setRateLimit('api-calls', 100); // 100 jobs/sec
```

#### `clearRateLimit(queue: string): Promise<void>`

Clear rate limit.

```typescript
await client.clearRateLimit('api-calls');
```

#### `setConcurrency(queue: string, limit: number): Promise<void>`

Set concurrency limit for queue.

```typescript
await client.setConcurrency('heavy-processing', 5);
```

#### `clearConcurrency(queue: string): Promise<void>`

Clear concurrency limit.

```typescript
await client.clearConcurrency('heavy-processing');
```

### Cron Jobs

#### `addCron(name: string, options: CronOptions): Promise<void>`

Add a cron job.

```typescript
// Using cron expression (sec min hour day month weekday)
await client.addCron('daily-report', {
  queue: 'reports',
  data: { type: 'daily' },
  schedule: '0 0 9 * * *', // Every day at 9:00 AM
  priority: 10,
});

// Using repeat interval
await client.addCron('health-check', {
  queue: 'monitoring',
  data: { check: 'health' },
  repeat_every: 60000, // Every minute
  limit: 1000, // Max 1000 executions
});
```

**CronOptions:**

| Option | Type | Description |
|--------|------|-------------|
| `queue` | `string` | Target queue |
| `data` | `unknown` | Job data |
| `schedule` | `string` | Cron expression (6 fields) |
| `repeat_every` | `number` | Repeat interval in ms |
| `priority` | `number` | Job priority |
| `limit` | `number` | Max executions |

#### `deleteCron(name: string): Promise<boolean>`

Delete a cron job.

```typescript
const deleted = await client.deleteCron('daily-report');
```

#### `listCrons(): Promise<CronJob[]>`

List all cron jobs.

```typescript
const crons = await client.listCrons();
for (const cron of crons) {
  console.log(`${cron.name}: next run at ${new Date(cron.next_run)}`);
}
```

### Flows (Job Dependencies)

#### `pushFlow(queue: string, options): Promise<FlowResult>`

Create a workflow with parent and children.

```typescript
const flow = await client.pushFlow('processing', {
  parent_data: { type: 'aggregate' },
  children: [
    { queue: 'step1', data: { task: 'fetch' } },
    { queue: 'step2', data: { task: 'transform' } },
    { queue: 'step3', data: { task: 'load' } },
  ],
  priority: 10,
});

// Wait for parent (completes when all children complete)
const result = await client.finished(flow.parent_id);
```

### Metrics and Monitoring

#### `stats(): Promise<QueueStats>`

Get queue statistics.

```typescript
const stats = await client.stats();
console.log(`Queued: ${stats.queued}, Processing: ${stats.processing}`);
```

#### `metrics(): Promise<Metrics>`

Get detailed metrics.

```typescript
const metrics = await client.metrics();
console.log(`Throughput: ${metrics.jobs_per_second} jobs/sec`);
console.log(`Avg Latency: ${metrics.avg_latency_ms}ms`);
```

---

## Queue Class

The `Queue` class provides a BullMQ-compatible API for job management.

```typescript
import { Queue } from 'flashq';

const queue = new Queue('emails', {
  host: 'localhost',
  port: 6789,
});
```

### Methods

#### `add(name: string, data: T, opts?: JobOptions): Promise<Job<T>>`

Add a job to the queue.

```typescript
const job = await queue.add('send-email', {
  to: 'user@example.com',
  subject: 'Hello',
}, {
  priority: 10,
  delay: 5000,
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
});
```

#### `addBulk(jobs: BulkJobOptions[]): Promise<Job[]>`

Add multiple jobs.

```typescript
const jobs = await queue.addBulk([
  { name: 'send', data: { to: 'a@test.com' } },
  { name: 'send', data: { to: 'b@test.com' }, opts: { priority: 10 } },
]);
```

#### `finished(jobId: number, timeout?: number): Promise<unknown>`

Wait for job completion.

```typescript
const job = await queue.add('process', data);
const result = await queue.finished(job.id, 30000);
```

#### `pause(): Promise<void>`

Pause the queue.

#### `resume(): Promise<void>`

Resume the queue.

#### `drain(): Promise<void>`

Remove all waiting jobs.

#### `obliterate(): Promise<void>`

Remove all queue data.

#### `close(): Promise<void>`

Close the queue connection.

---

## Worker Class

The `Worker` class processes jobs from queues.

```typescript
import { Worker } from 'flashq';

const worker = new Worker('emails', async (job) => {
  // Process job
  console.log('Processing:', job.data);
  return { sent: true };
}, {
  concurrency: 10,
  autostart: true,
});
```

### Options

```typescript
interface BullMQWorkerOptions {
  /** Server host */
  host?: string;

  /** Server port */
  port?: number;

  /** Parallel job processing (default: 1) */
  concurrency?: number;

  /** Auto-start on creation (default: true) */
  autostart?: boolean;

  /** Graceful shutdown timeout in ms (default: 30000) */
  closeTimeout?: number;

  /** Worker hooks for observability */
  workerHooks?: WorkerHooks;
}
```

### Methods

#### `start(): Promise<void>`

Start the worker (if not autostarted).

```typescript
const worker = new Worker('queue', processor, { autostart: false });
await worker.start();
```

#### `stop(): Promise<void>`

Stop the worker gracefully (waits for current jobs).

```typescript
await worker.stop();
```

#### `close(force?: boolean): Promise<void>`

Close the worker.

```typescript
await worker.close();       // Graceful (waits for jobs)
await worker.close(true);   // Force close immediately
```

#### `waitForJobs(timeout?: number): Promise<boolean>`

Wait for all current jobs to complete.

```typescript
const completed = await worker.waitForJobs(30000);
```

#### `updateProgress(jobId: number, progress: number, message?: string): Promise<void>`

Update job progress during processing.

```typescript
const worker = new Worker('queue', async (job) => {
  await worker.updateProgress(job.id, 0, 'Starting...');
  // ... process
  await worker.updateProgress(job.id, 50, 'Halfway done');
  // ... more processing
  await worker.updateProgress(job.id, 100, 'Complete');
  return result;
});
```

#### `isRunning(): boolean`

Check if worker is running.

#### `getProcessingCount(): number`

Get number of jobs currently being processed.

#### `getJobsProcessed(): number`

Get total jobs processed since start.

### Events

```typescript
worker.on('ready', () => {
  console.log('Worker ready');
});

worker.on('active', (job, workerId) => {
  console.log(`Job ${job.id} started by worker ${workerId}`);
});

worker.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed:`, result);
});

worker.on('failed', (job, error) => {
  console.log(`Job ${job.id} failed:`, error.message);
});

worker.on('progress', (job, progress, message) => {
  console.log(`Job ${job.id}: ${progress}% - ${message}`);
});

worker.on('stopping', () => {
  console.log('Worker is stopping...');
});

worker.on('stopped', () => {
  console.log('Worker stopped');
});

worker.on('error', (error) => {
  console.error('Worker error:', error);
});
```

---

## Error Handling

flashQ provides typed error classes for precise error handling.

### Error Classes

| Class | Code | Retryable | Description |
|-------|------|-----------|-------------|
| `FlashQError` | Various | Varies | Base error class |
| `ConnectionError` | `CONNECTION_*` | Yes | Connection failures |
| `TimeoutError` | `REQUEST_TIMEOUT` | Yes | Request timeouts |
| `AuthenticationError` | `AUTH_FAILED` | No | Auth failures |
| `ValidationError` | `VALIDATION_ERROR` | No | Invalid input |
| `ServerError` | `SERVER_ERROR` | Varies | Server-side errors |
| `JobNotFoundError` | `JOB_NOT_FOUND` | No | Job doesn't exist |
| `QueueNotFoundError` | `QUEUE_NOT_FOUND` | No | Queue doesn't exist |
| `DuplicateJobError` | `DUPLICATE_JOB` | No | Job already exists |
| `QueuePausedError` | `QUEUE_PAUSED` | Yes | Queue is paused |
| `RateLimitError` | `RATE_LIMITED` | Yes | Rate limit exceeded |
| `ConcurrencyLimitError` | `CONCURRENCY_LIMITED` | Yes | Concurrency limit |
| `BatchError` | `BATCH_PARTIAL_FAILURE` | No | Partial batch failure |

### Usage

```typescript
import {
  FlashQError,
  ConnectionError,
  TimeoutError,
  ValidationError,
  ServerError,
  JobNotFoundError,
  RateLimitError,
} from 'flashq';

try {
  await client.push('queue', data);
} catch (error) {
  if (error instanceof ConnectionError) {
    console.log('Connection failed:', error.message);
    // Safe to retry
  } else if (error instanceof TimeoutError) {
    console.log(`Timeout after ${error.timeoutMs}ms`);
    // Safe to retry
  } else if (error instanceof ValidationError) {
    console.log(`Invalid ${error.field}: ${error.message}`);
    // Fix input and retry
  } else if (error instanceof RateLimitError) {
    console.log(`Rate limited, retry after ${error.retryAfterMs}ms`);
    // Wait and retry
  } else if (error instanceof JobNotFoundError) {
    console.log(`Job ${error.jobId} not found`);
    // Don't retry
  } else if (error instanceof FlashQError) {
    console.log(`Error (${error.code}): ${error.message}`);
    if (error.retryable) {
      // Safe to retry
    }
  }
}
```

### BatchError

For batch operations with partial failures:

```typescript
import { BatchError } from 'flashq';

try {
  await client.pushBatch('queue', jobs);
} catch (error) {
  if (error instanceof BatchError) {
    console.log(`Succeeded: ${error.successCount}`);
    console.log(`Failed: ${error.failureCount}`);

    for (const { index, item, error: itemError } of error.failed) {
      console.log(`Item ${index} failed: ${itemError.message}`);
    }
  }
}
```

---

## Retry Logic

Built-in retry utilities with exponential backoff.

### `withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>`

Wrap a single operation with retry logic.

```typescript
import { withRetry } from 'flashq';

const result = await withRetry(
  () => client.push('queue', data),
  {
    maxRetries: 3,
    initialDelay: 100,
    maxDelay: 5000,
    backoffMultiplier: 2,
    jitter: true,
    onRetry: (error, attempt, delay) => {
      console.log(`Retry ${attempt} after ${delay}ms: ${error.message}`);
    },
  }
);
```

### `retryable<TArgs, TResult>(fn: (...args: TArgs) => Promise<TResult>, options?: RetryOptions)`

Create a retryable version of a function.

```typescript
import { retryable } from 'flashq';

const retryablePush = retryable(
  (queue: string, data: unknown) => client.push(queue, data),
  { maxRetries: 3 }
);

await retryablePush('emails', { to: 'user@example.com' });
```

### RetryOptions

```typescript
interface RetryOptions {
  /** Max retry attempts (default: 3) */
  maxRetries?: number;

  /** Initial delay in ms (default: 100) */
  initialDelay?: number;

  /** Max delay in ms (default: 5000) */
  maxDelay?: number;

  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier?: number;

  /** Add jitter to delays (default: true) */
  jitter?: boolean;

  /** Only retry these error codes */
  retryOn?: string[];

  /** Custom retry condition */
  shouldRetry?: (error: Error, attempt: number) => boolean;

  /** Callback on each retry */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}
```

### RetryPresets

```typescript
import { RetryPresets } from 'flashq';

// Quick retries for interactive operations
RetryPresets.fast       // 2 retries, 50ms initial, 500ms max

// Standard retries for most operations
RetryPresets.standard   // 3 retries, 100ms initial, 5s max

// Aggressive retries for critical operations
RetryPresets.aggressive // 5 retries, 200ms initial, 30s max

// No retries
RetryPresets.none       // 0 retries
```

### `isRetryable(error: Error): boolean`

Check if an error is retryable.

```typescript
import { isRetryable } from 'flashq';

if (isRetryable(error)) {
  // Safe to retry
}
```

---

## Observability Hooks

Hooks allow integration with observability platforms like OpenTelemetry, DataDog, or custom metrics.

### Client Hooks

```typescript
import { FlashQ, ClientHooks } from 'flashq';

const hooks: ClientHooks = {
  // Push hooks
  onPush: (ctx) => {
    console.log(`Pushing to ${ctx.queue}`);
  },
  onPushComplete: (ctx) => {
    console.log(`Pushed job ${ctx.job?.id} in ${Date.now() - ctx.startTime}ms`);
  },
  onPushError: (ctx, error) => {
    console.error(`Push failed: ${error.message}`);
  },

  // Pull hooks
  onPull: (ctx) => {
    console.log(`Pulling from ${ctx.queue}`);
  },
  onPullComplete: (ctx) => {
    console.log(`Pulled job ${ctx.job?.id}`);
  },
  onPullError: (ctx, error) => {
    console.error(`Pull failed: ${error.message}`);
  },

  // Ack hooks
  onAck: (ctx) => { /* ... */ },
  onAckComplete: (ctx) => { /* ... */ },
  onAckError: (ctx, error) => { /* ... */ },

  // Fail hooks
  onFail: (ctx) => { /* ... */ },
  onFailComplete: (ctx) => { /* ... */ },
  onFailError: (ctx, error) => { /* ... */ },

  // Batch hooks
  onBatchPush: (ctx) => { /* ... */ },
  onBatchPushComplete: (ctx) => { /* ... */ },
  onBatchPushError: (ctx, error) => { /* ... */ },
  onBatchPull: (ctx) => { /* ... */ },
  onBatchPullComplete: (ctx) => { /* ... */ },
  onBatchPullError: (ctx, error) => { /* ... */ },

  // Connection hooks
  onConnection: (ctx) => {
    console.log(`Connection event: ${ctx.event}`);
  },
};

const client = new FlashQ({ hooks });
```

### Worker Hooks

```typescript
import { Worker, WorkerHooks } from 'flashq';

const workerHooks: WorkerHooks = {
  onProcess: (ctx) => {
    console.log(`Processing job ${ctx.job.id}`);
  },
  onProcessComplete: (ctx) => {
    console.log(`Job ${ctx.job.id} completed in ${Date.now() - ctx.startTime}ms`);
  },
  onProcessError: (ctx, error) => {
    console.error(`Job ${ctx.job.id} failed: ${error.message}`);
  },
};

const worker = new Worker('queue', processor, { workerHooks });
```

### OpenTelemetry Integration

```typescript
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { FlashQ, ClientHooks } from 'flashq';

const tracer = trace.getTracer('flashq');

const hooks: ClientHooks = {
  onPush: (ctx) => {
    ctx.span = tracer.startSpan('flashq.push', {
      attributes: {
        'flashq.queue': ctx.queue,
        'flashq.priority': ctx.options?.priority,
      },
    });
  },
  onPushComplete: (ctx) => {
    ctx.span?.setAttribute('flashq.job_id', ctx.job?.id);
    ctx.span?.end();
  },
  onPushError: (ctx, error) => {
    ctx.span?.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    ctx.span?.recordException(error);
    ctx.span?.end();
  },
};

const client = new FlashQ({ hooks });
```

### Hook Context Types

All hook contexts extend `HookContext`:

```typescript
interface HookContext {
  startTime: number;      // Operation start timestamp
  requestId?: string;     // Request ID for correlation
  [key: string]: unknown; // Custom data (e.g., spans)
}
```

Specific contexts:

| Context | Fields |
|---------|--------|
| `PushHookContext` | `queue`, `data`, `options`, `job` |
| `PullHookContext` | `queue`, `timeout`, `job` |
| `AckHookContext` | `jobId`, `result` |
| `FailHookContext` | `jobId`, `error` |
| `ProcessHookContext` | `job`, `workerId`, `result`, `error` |
| `BatchPushHookContext` | `queue`, `count`, `ids`, `failedCount` |
| `BatchPullHookContext` | `queue`, `count`, `timeout`, `jobs` |
| `ConnectionHookContext` | `host`, `port`, `event`, `error`, `attempt` |

---

## Logger

Configurable logging with request ID tracking.

### Usage

```typescript
import { Logger, createLogger, getLogger, setGlobalLogger } from 'flashq';

// Create a logger
const logger = createLogger({
  level: 'info',
  prefix: 'my-app',
  timestamps: true,
});

// Log messages
logger.trace('Trace message', { data: 'value' });
logger.debug('Debug message');
logger.info('Info message');
logger.warn('Warning message');
logger.error('Error message', new Error('Something went wrong'));

// Request ID tracking
logger.setRequestId('req-12345');
logger.info('Processing request', { userId: 123 });
// Output: 2024-01-15T10:30:00.000Z [my-app] [req-12345] INFO Processing request { userId: 123 }

// Child loggers
const childLogger = logger.child('db');
childLogger.info('Query executed');
// Output: 2024-01-15T10:30:00.000Z [my-app:db] INFO Query executed

// Check level
if (logger.isLevelEnabled('debug')) {
  logger.debug('Expensive debug operation');
}

// Global logger
setGlobalLogger(logger);
const globalLogger = getLogger();
```

### LoggerOptions

```typescript
interface LoggerOptions {
  /** Minimum log level (default: 'silent') */
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

  /** Prefix for all log messages */
  prefix?: string;

  /** Include timestamps (default: true) */
  timestamps?: boolean;

  /** Custom log handler */
  handler?: (entry: LogEntry) => void;
}
```

### Custom Handler

```typescript
const logger = createLogger({
  level: 'info',
  handler: (entry) => {
    // Send to logging service
    myLoggingService.log({
      level: entry.level,
      message: entry.message,
      data: entry.data,
      timestamp: entry.timestamp,
      requestId: entry.requestId,
    });
  },
});
```

---

## Types Reference

### Job

```typescript
interface Job<T = unknown> {
  id: number;
  queue: string;
  data: T;
  priority: number;
  attempts: number;
  created_at: number;
  run_at: number;
  started_at: number;
  max_attempts: number;
  backoff: number;
  ttl: number;
  timeout: number;
  progress: number;
  unique_key?: string;
  custom_id?: string;
  tags: string[];
  depends_on: number[];
  parent_id?: number;
  children_ids: number[];
  children_completed: number;
  lifo: boolean;
  remove_on_complete: boolean;
  remove_on_fail: boolean;
  last_heartbeat: number;
  stall_timeout: number;
  stall_count: number;
  keep_completed_age: number;
  keep_completed_count: number;
  completed_at: number;
  group_id?: string;
}
```

### JobState

```typescript
type JobState = 'waiting' | 'delayed' | 'active' | 'completed' | 'failed';
```

### QueueInfo

```typescript
interface QueueInfo {
  name: string;
  pending: number;
  processing: number;
  dlq: number;
  paused: boolean;
}
```

### Metrics

```typescript
interface Metrics {
  total_pushed: number;
  total_completed: number;
  total_failed: number;
  jobs_per_second: number;
  avg_latency_ms: number;
  queues: QueueMetrics[];
}
```

### CronJob

```typescript
interface CronJob {
  name: string;
  queue: string;
  data: unknown;
  schedule?: string;
  repeat_every?: number;
  priority: number;
  next_run: number;
  executions: number;
  limit?: number;
}
```

---

## Best Practices

### 1. Use Binary Protocol in Production

```typescript
const client = new FlashQ({
  useBinary: true, // 40% smaller payloads
});
```

### 2. Enable Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  await worker.close(); // Waits for current jobs
  await client.close();
  process.exit(0);
});
```

### 3. Use Batch Operations

```typescript
// Instead of many single pushes
for (const data of items) {
  await client.push('queue', data); // Slow
}

// Use batch
await client.pushBatch('queue', items.map(data => ({ data }))); // Fast
```

### 4. Handle Errors Properly

```typescript
try {
  await client.push('queue', data);
} catch (error) {
  if (error instanceof FlashQError && error.retryable) {
    // Retry with backoff
    await withRetry(() => client.push('queue', data));
  } else {
    // Log and handle non-retryable errors
    logger.error('Failed to push job', error);
  }
}
```

### 5. Use Job Dependencies for Workflows

```typescript
const step1 = await client.push('step1', data1);
const step2 = await client.push('step2', data2, {
  depends_on: [step1.id],
});
const step3 = await client.push('step3', data3, {
  depends_on: [step2.id],
});

// Wait for final step
const result = await client.finished(step3.id);
```

### 6. Monitor with Hooks

```typescript
const client = new FlashQ({
  hooks: {
    onPushComplete: (ctx) => {
      metrics.pushLatency.observe(Date.now() - ctx.startTime);
      metrics.pushCounter.inc({ queue: ctx.queue });
    },
    onPushError: (ctx, error) => {
      metrics.errorCounter.inc({ queue: ctx.queue, code: error.code });
    },
  },
});
```

### 7. Set Appropriate Concurrency

```typescript
// For I/O-bound work (API calls, DB)
const worker = new Worker('api-queue', processor, { concurrency: 50 });

// For CPU-bound work
const worker = new Worker('cpu-queue', processor, { concurrency: os.cpus().length });
```

### 8. Use Rate Limiting for External APIs

```typescript
await client.setRateLimit('openai-calls', 50); // 50 req/sec

const worker = new Worker('openai-calls', async (job) => {
  // Rate limiting is enforced server-side
  return await openai.chat.completions.create(job.data);
});
```

---

## Resources

- **Website:** [flashq.dev](https://flashq.dev)
- **Documentation:** [flashq.dev/docs](https://flashq.dev/docs/)
- **GitHub:** [github.com/egeominotti/flashq](https://github.com/egeominotti/flashq)
- **npm:** [npmjs.com/package/flashq](https://www.npmjs.com/package/flashq)

---

**License:** MIT
