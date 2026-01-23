# flashQ TypeScript SDK

[![npm version](https://img.shields.io/npm/v/flashq)](https://www.npmjs.com/package/flashq)
[![npm downloads](https://img.shields.io/npm/dm/flashq)](https://www.npmjs.com/package/flashq)
[![GitHub stars](https://img.shields.io/github/stars/egeominotti/flashq)](https://github.com/egeominotti/flashq)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **High-performance job queue with BullMQ-compatible API. No Redis required.**

flashQ is a drop-in replacement for BullMQ that runs on a single Rust binary. It's designed for AI/ML workloads with support for 10MB payloads, job dependencies, and 300K+ jobs/sec throughput.

## Features

- **BullMQ-Compatible API** - Migrate with minimal code changes
- **No Redis Required** - Single binary, zero infrastructure
- **10x Faster** - Rust + io_uring + lock-free data structures
- **AI/ML Ready** - 10MB payloads, job dependencies, progress tracking
- **Production Ready** - Typed errors, retry logic, graceful shutdown, observability hooks

## Installation

```bash
npm install flashq
# or
yarn add flashq
# or
bun add flashq
```

## Quick Start

### 1. Start the Server

```bash
docker run -d --name flashq \
  -p 6789:6789 \
  -p 6790:6790 \
  -e HTTP=1 \
  ghcr.io/egeominotti/flashq:latest
```

Dashboard available at http://localhost:6790

### 2. Create a Queue and Worker

```typescript
import { Queue, Worker } from 'flashq';

// Create a queue
const queue = new Queue('emails');

// Add a job
const job = await queue.add('send-welcome', {
  to: 'user@example.com',
  subject: 'Welcome!',
});

// Process jobs
const worker = new Worker('emails', async (job) => {
  console.log(`Sending email to ${job.data.to}`);
  // ... send email
  return { sent: true, timestamp: Date.now() };
});

// Handle events
worker.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed:`, result);
});

worker.on('failed', (job, error) => {
  console.error(`Job ${job.id} failed:`, error.message);
});
```

## API Reference

### Queue

```typescript
import { Queue } from 'flashq';

const queue = new Queue('my-queue', {
  host: 'localhost',
  port: 6789,
});

// Add a single job
const job = await queue.add('job-name', { data: 'value' }, {
  priority: 10,           // Higher = processed first
  delay: 5000,            // Delay in ms
  attempts: 3,            // Max retry attempts
  backoff: 1000,          // Exponential backoff base (ms)
  timeout: 30000,         // Processing timeout (ms)
  jobId: 'unique-id',     // Custom ID for idempotency
  depends_on: [1, 2],     // Wait for these jobs to complete
});

// Add multiple jobs
await queue.addBulk([
  { name: 'task', data: { id: 1 } },
  { name: 'task', data: { id: 2 }, opts: { priority: 10 } },
]);

// Wait for job completion
const result = await queue.finished(job.id, 30000); // timeout in ms

// Queue control
await queue.pause();
await queue.resume();
await queue.drain();       // Remove all waiting jobs
await queue.obliterate();  // Remove ALL queue data

// Cleanup
await queue.close();
```

### Worker

```typescript
import { Worker } from 'flashq';

const worker = new Worker('my-queue', async (job) => {
  // Process job
  console.log('Processing:', job.id, job.data);

  // Update progress
  await worker.updateProgress(job.id, 50, 'Halfway done');

  // Return result (auto-acknowledged)
  return { processed: true };
}, {
  concurrency: 10,        // Parallel job processing
  autostart: true,        // Start automatically (default: true)
  closeTimeout: 30000,    // Graceful shutdown timeout (ms)
});

// Events
worker.on('ready', () => console.log('Worker ready'));
worker.on('active', (job) => console.log('Job started:', job.id));
worker.on('completed', (job, result) => console.log('Job done:', result));
worker.on('failed', (job, error) => console.log('Job failed:', error));
worker.on('stopping', () => console.log('Worker stopping...'));
worker.on('stopped', () => console.log('Worker stopped'));

// Graceful shutdown
await worker.close();        // Wait for current jobs
await worker.close(true);    // Force close immediately
```

### Low-Level Client

For advanced use cases, use the `FlashQ` client directly:

```typescript
import { FlashQ } from 'flashq';

const client = new FlashQ({
  host: 'localhost',
  port: 6789,
  timeout: 5000,
});

await client.connect();

// Push/Pull operations
const job = await client.push('queue', { data: 'value' });
const pulled = await client.pull('queue', 5000);
await client.ack(pulled.id, { result: 'done' });

// Job management
const state = await client.getState(job.id);
const counts = await client.getJobCounts('queue');
await client.cancel(job.id);

// Cron jobs
await client.addCron('daily-cleanup', {
  queue: 'maintenance',
  schedule: '0 0 * * *',
  data: { task: 'cleanup' },
});

await client.close();
```

## Error Handling

flashQ provides typed error classes for precise error handling:

```typescript
import {
  FlashQError,
  ConnectionError,
  TimeoutError,
  ValidationError,
  ServerError,
  AuthenticationError,
} from 'flashq';

try {
  await client.push('queue', data);
} catch (error) {
  if (error instanceof ConnectionError) {
    console.log('Connection failed, retrying...');
  } else if (error instanceof TimeoutError) {
    console.log(`Timeout after ${error.timeout}ms`);
  } else if (error instanceof ValidationError) {
    console.log(`Invalid ${error.field}: ${error.message}`);
  } else if (error instanceof ServerError) {
    console.log(`Server error: ${error.serverCode}`);
  }

  // Check if error is retryable
  if (error instanceof FlashQError && error.retryable) {
    // Safe to retry
  }
}
```

## Retry Logic

Built-in retry utilities with exponential backoff:

```typescript
import { withRetry, retryable, RetryPresets } from 'flashq';

// Wrap a single operation
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

// Create a retryable function
const retryablePush = retryable(
  (queue: string, data: unknown) => client.push(queue, data),
  RetryPresets.standard
);

await retryablePush('emails', { to: 'user@example.com' });

// Available presets
RetryPresets.fast       // 2 retries, 50ms initial, 500ms max
RetryPresets.standard   // 3 retries, 100ms initial, 5s max
RetryPresets.aggressive // 5 retries, 200ms initial, 30s max
RetryPresets.none       // No retries
```

## Observability Hooks

Integrate with OpenTelemetry, DataDog, or any observability platform:

```typescript
import { FlashQ, ClientHooks } from 'flashq';

const hooks: ClientHooks = {
  onPush: (ctx) => {
    console.log(`Pushing to ${ctx.queue}`, ctx.data);
  },
  onPushComplete: (ctx) => {
    console.log(`Pushed job ${ctx.job?.id} in ${ctx.duration}ms`);
  },
  onPushError: (ctx, error) => {
    console.error(`Push failed: ${error.message}`);
  },
  onConnect: (ctx) => {
    console.log('Connected to flashQ');
  },
  onDisconnect: (ctx) => {
    console.log(`Disconnected: ${ctx.reason}`);
  },
};

const client = new FlashQ({ hooks });
```

Worker hooks for job processing:

```typescript
import { Worker, WorkerHooks } from 'flashq';

const workerHooks: WorkerHooks = {
  onProcess: (ctx) => {
    console.log(`Processing job ${ctx.job.id}`);
  },
  onProcessComplete: (ctx) => {
    console.log(`Job ${ctx.job.id} completed in ${ctx.duration}ms`);
  },
  onProcessError: (ctx, error) => {
    console.error(`Job ${ctx.job.id} failed: ${error.message}`);
  },
};

const worker = new Worker('queue', processor, { workerHooks });
```

## Logging

Configurable logging with request ID tracking:

```typescript
import { FlashQ, Logger, createLogger } from 'flashq';

// Use built-in logger
const client = new FlashQ({
  logLevel: 'debug', // trace | debug | info | warn | error | silent
});

// Custom logger
const logger = createLogger({
  level: 'info',
  prefix: 'my-app',
  timestamps: true,
  handler: (entry) => {
    // Send to your logging service
    myLoggingService.log(entry);
  },
});

// Request ID tracking for distributed tracing
logger.setRequestId('req-12345');
logger.info('Processing request', { userId: 123 });
// Output: [2024-01-15T10:30:00.000Z] [INFO] [my-app] [req-12345] Processing request {"userId":123}
```

## Performance

flashQ is **3-10x faster** than BullMQ in real-world benchmarks:

| Metric | flashQ | BullMQ | Speedup |
|--------|-------:|-------:|--------:|
| Push Rate | 307,692/s | 43,649/s | **7.0x** |
| Process Rate | 292,398/s | 27,405/s | **10.7x** |
| CPU-Bound Processing | 62,814/s | 23,923/s | **2.6x** |

### Why flashQ is Faster

| Optimization | Description |
|--------------|-------------|
| **Rust + tokio** | Zero-cost abstractions, no GC pauses |
| **io_uring** | Linux kernel async I/O |
| **32 Shards** | Lock-free concurrent access |
| **MessagePack** | 40% smaller payloads |
| **No Redis** | Direct TCP protocol |

## AI/ML Workloads

flashQ is designed for AI pipelines with large payloads and complex workflows:

```typescript
// AI Agent with job dependencies
const agent = new Queue('ai-agent');

// Step 1: Parse user intent
const parse = await agent.add('parse', { prompt: userInput });

// Step 2: Retrieve context (waits for step 1)
const retrieve = await agent.add('retrieve', { query }, {
  depends_on: [parse.id],
});

// Step 3: Generate response (waits for step 2)
const generate = await agent.add('generate', { context }, {
  depends_on: [retrieve.id],
  priority: 10,
});

// Wait for the final result
const result = await agent.finished(generate.id, 60000);
```

## Configuration

### Client Options

```typescript
interface ClientOptions {
  host?: string;              // Default: 'localhost'
  port?: number;              // Default: 6789
  httpPort?: number;          // Default: 6790
  token?: string;             // Auth token
  timeout?: number;           // Connection timeout (ms)
  useHttp?: boolean;          // Use HTTP instead of TCP
  useBinary?: boolean;        // Use MessagePack (40% smaller)
  logLevel?: LogLevel;        // Logging level
  compression?: boolean;      // Enable gzip compression
  compressionThreshold?: number; // Min size to compress (bytes)
  hooks?: ClientHooks;        // Observability hooks
}
```

### Worker Options

```typescript
interface WorkerOptions {
  concurrency?: number;       // Parallel jobs (default: 1)
  autostart?: boolean;        // Auto-start (default: true)
  closeTimeout?: number;      // Graceful shutdown timeout (ms)
  workerHooks?: WorkerHooks;  // Processing hooks
}
```

## Examples

Run examples with:

```bash
bun run examples/01-basic.ts
```

| Example | Description |
|---------|-------------|
| `01-basic.ts` | Queue and Worker basics |
| `02-job-options.ts` | Priority, delay, retry |
| `03-bulk-jobs.ts` | Batch operations |
| `04-events.ts` | Worker events |
| `05-queue-control.ts` | Pause, resume, drain |
| `06-delayed.ts` | Scheduled jobs |
| `07-retry.ts` | Retry with backoff |
| `08-priority.ts` | Priority ordering |
| `09-concurrency.ts` | Parallel processing |
| `ai-workflow.ts` | AI agent with dependencies |

## Migration from BullMQ

flashQ provides a BullMQ-compatible API. Most code works with minimal changes:

```typescript
// Before (BullMQ)
import { Queue, Worker } from 'bullmq';
const queue = new Queue('my-queue', { connection: { host: 'redis' } });

// After (flashQ)
import { Queue, Worker } from 'flashq';
const queue = new Queue('my-queue', { host: 'flashq-server' });
```

Key differences:
- No Redis connection required
- `connection` option replaced with `host`/`port`
- Some advanced BullMQ features may have different behavior

## License

MIT
