# flashQ TypeScript SDK

High-performance job queue client for [flashQ](https://github.com/egeominotti/flashq).

## Installation

```bash
bun add flashq
# or
npm install flashq
```

## Quick Start

```typescript
import { FlashQ, Worker } from 'flashq';

// Create client
const client = new FlashQ();

// Add a job
await client.add('emails', { to: 'user@example.com' });

// Process jobs
const worker = new Worker('emails', async (job) => {
  console.log('Sending email to:', job.data.to);
  return { sent: true };
});

await worker.start();
```

## API

### FlashQ Client

```typescript
const client = new FlashQ({
  host: 'localhost',  // default
  port: 6789,         // default
  token: 'secret',    // optional auth
});
```

#### Add Jobs

```typescript
// Simple
await client.add('queue', { data: 'here' });

// With options
await client.add('queue', data, {
  priority: 10,      // higher = first
  delay: 5000,       // run in 5s
  max_attempts: 3,   // retry on failure
  backoff: 1000,     // exponential backoff
  timeout: 30000,    // processing timeout
  unique_key: 'id',  // deduplication
});

// Batch (up to 1000)
await client.addBulk('queue', [
  { data: { id: 1 } },
  { data: { id: 2 }, priority: 10 },
]);
```

#### Query Jobs

```typescript
const job = await client.getJob(jobId);
const state = await client.getState(jobId);
const result = await client.getResult(jobId);
```

#### Queue Control

```typescript
await client.pause('queue');
await client.resume('queue');
await client.drain('queue');      // remove waiting jobs
await client.obliterate('queue'); // remove everything
```

### Worker

```typescript
const worker = new Worker('queue', async (job) => {
  // Process job
  return { result: 'data' };
}, {
  concurrency: 10,  // parallel jobs
});

await worker.start();
await worker.stop();
```

#### Worker Events

```typescript
worker.on('completed', (job, result) => {});
worker.on('failed', (job, error) => {});
worker.on('error', (error) => {});
```

## Examples

See [`examples/`](./examples/) for complete examples:

| File | Description |
|------|-------------|
| 01-basic.ts | Push, pull, ack |
| 02-worker.ts | Automatic processing |
| 03-delayed.ts | Scheduled jobs |
| 04-priority.ts | Job priority |
| 05-batch.ts | Batch operations |
| 06-retry.ts | Retry & DLQ |
| 07-progress.ts | Progress tracking |
| 08-cron.ts | Cron jobs |
| 09-stats.ts | Metrics |
| 10-benchmark.ts | Performance test |
| 11-flow.ts | Job dependencies |
| 12-unique.ts | Deduplication |
| 13-rate-limit.ts | Rate limiting |
| 14-concurrency.ts | Concurrency control |
| 15-pause-resume.ts | Queue control |
| 16-cancel.ts | Job cancellation |
| 17-idempotency.ts | Custom job IDs |
| 18-events.ts | Lifecycle events |

Run examples:

```bash
bun run examples/01-basic.ts
```

## Performance

- **Push**: 600,000+ jobs/sec
- **Process**: 200,000+ jobs/sec
- **Latency**: < 1ms

## License

MIT
