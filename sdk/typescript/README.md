# flashQ TypeScript SDK

BullMQ-compatible API for [flashQ](https://github.com/egeominotti/flashq).

## Installation

```bash
bun add flashq
```

## Quick Start

```typescript
import { Queue, Worker } from 'flashq';

// Create queue
const queue = new Queue('emails');

// Add job
await queue.add('send', { to: 'user@example.com' });

// Process jobs (auto-starts)
const worker = new Worker('emails', async (job) => {
  console.log('Processing:', job.data);
  return { sent: true };
});
```

## Queue

```typescript
const queue = new Queue('emails', {
  host: 'localhost',
  port: 6789,
});

// Add single job
await queue.add('send', data, {
  priority: 10,
  delay: 5000,
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
});

// Add bulk
await queue.addBulk([
  { name: 'send', data: { to: 'a@test.com' } },
  { name: 'send', data: { to: 'b@test.com' }, opts: { priority: 10 } },
]);

// Control
await queue.pause();
await queue.resume();
await queue.drain();      // remove waiting
await queue.obliterate(); // remove all
```

## Worker

```typescript
// Auto-starts by default (like BullMQ)
const worker = new Worker('emails', async (job) => {
  return { done: true };
}, {
  concurrency: 10,
});

// Events
worker.on('completed', (job, result) => {});
worker.on('failed', (job, error) => {});

// Shutdown
await worker.close();
```

## Job Options

| Option | Type | Description |
|--------|------|-------------|
| `priority` | number | Higher = first (default: 0) |
| `delay` | number | Delay in ms |
| `attempts` | number | Retry count |
| `backoff` | number \| object | Backoff config |
| `timeout` | number | Processing timeout |
| `jobId` | string | Custom ID |

## Key-Value Storage

Redis-like KV store with TTL support and batch operations.

```typescript
import { FlashQ } from 'flashq';

const client = new FlashQ();

// Basic operations
await client.kvSet('user:123', { name: 'John', email: 'john@example.com' });
const user = await client.kvGet('user:123');
await client.kvDel('user:123');

// With TTL (milliseconds)
await client.kvSet('session:abc', { token: 'xyz' }, { ttl: 3600000 }); // 1 hour

// TTL operations
await client.kvExpire('user:123', 60000);  // Set TTL
const ttl = await client.kvTtl('user:123'); // Get remaining TTL

// Batch operations (10-100x faster!)
await client.kvMset([
  { key: 'user:1', value: { name: 'Alice' } },
  { key: 'user:2', value: { name: 'Bob' } },
  { key: 'user:3', value: { name: 'Charlie' }, ttl: 60000 },
]);

const users = await client.kvMget(['user:1', 'user:2', 'user:3']);

// Pattern matching
const userKeys = await client.kvKeys('user:*');
const sessionKeys = await client.kvKeys('session:???');

// Atomic counters
await client.kvIncr('page:views');           // +1
await client.kvIncr('user:123:score', 10);   // +10
await client.kvDecr('stock:item:456');       // -1
```

### KV Performance

| Operation | Throughput |
|-----------|------------|
| Sequential SET/GET | ~30K ops/sec |
| **Batch MSET** | **640K ops/sec** |
| **Batch MGET** | **1.2M ops/sec** |

> Use batch operations (MSET/MGET) for best performance!

## Examples

```bash
bun run examples/01-basic.ts
```

| File | Description |
|------|-------------|
| 01-basic.ts | Queue + Worker basics |
| 02-job-options.ts | Priority, delay, retry |
| 03-bulk-jobs.ts | Add multiple jobs |
| 04-events.ts | Worker events |
| 05-queue-control.ts | Pause, resume, drain |
| 06-delayed.ts | Scheduled jobs |
| 07-retry.ts | Retry with backoff |
| 08-priority.ts | Priority ordering |
| 09-concurrency.ts | Parallel processing |
| 10-benchmark.ts | Performance test |
| kv-benchmark.ts | KV store benchmark |

## Performance

- **Push**: 600K+ jobs/sec
- **Process**: 200K+ jobs/sec

## License

MIT
