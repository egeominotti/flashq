<div align="center">

# ⚡ flashQ

**The fastest open-source job queue.**

Built with Rust. BullMQ-compatible. 600K+ jobs/sec.

[![CI](https://img.shields.io/github/actions/workflow/status/egeominotti/flashq/ci.yml?branch=main&label=CI)](https://github.com/egeominotti/flashq/actions)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

[Quick Start](#quick-start) • [SDK](#sdk) • [Features](#features) • [Docs](#documentation)

</div>

---

## Performance

| Metric | flashQ | BullMQ | Speedup |
|--------|--------|--------|---------|
| Batch Push | 600K/sec | 42K/sec | **14x** |
| Processing | 310K/sec | 15K/sec | **21x** |
| Latency P99 | 0.1ms | 0.6ms | **6x** |

## Quick Start

```bash
# Docker
docker run -p 6789:6789 -p 6790:6790 -e HTTP=1 flashq/flashq

# Docker Compose
git clone https://github.com/egeominotti/flashq.git && cd flashq
docker-compose up -d
```

Dashboard: http://localhost:6790

## SDK

```bash
bun add flashq
```

```typescript
import { Queue, Worker } from 'flashq';

// Create queue
const queue = new Queue('emails');

// Add job (BullMQ-style)
await queue.add('send', { to: 'user@example.com' }, {
  priority: 10,
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 }
});

// Process jobs (auto-starts like BullMQ)
const worker = new Worker('emails', async (job) => {
  await sendEmail(job.data);
  return { sent: true };
});

worker.on('completed', (job, result) => {
  console.log('Done:', job.id);
});
```

## Features

| Feature | Description |
|---------|-------------|
| **BullMQ-compatible** | Same API: Queue, Worker, events |
| **Priority Queues** | Higher priority = processed first |
| **Delayed Jobs** | Schedule for future execution |
| **Retry & Backoff** | Automatic retries with exponential backoff |
| **Batch Operations** | Push/pull thousands at once |
| **Rate Limiting** | Control throughput per queue |
| **Concurrency** | Limit parallel processing |
| **Persistence** | Optional PostgreSQL storage |
| **Dashboard** | Built-in monitoring UI |

## Documentation

### Job Options

```typescript
await queue.add('name', data, {
  priority: 10,       // higher = first
  delay: 5000,        // delay in ms
  attempts: 3,        // retry count
  backoff: { type: 'exponential', delay: 1000 },
  timeout: 30000,     // processing timeout
  jobId: 'custom-id', // for deduplication
});
```

### Worker Options

```typescript
const worker = new Worker('queue', handler, {
  concurrency: 10,    // parallel jobs
  autorun: true,      // auto-start (default)
});

worker.on('completed', (job, result) => {});
worker.on('failed', (job, error) => {});
```

### Queue Control

```typescript
await queue.pause();
await queue.resume();
await queue.drain();       // remove waiting
await queue.obliterate();  // remove all
await queue.getJobCounts();
```

### Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | TCP port | 6789 |
| `HTTP` | Enable HTTP/Dashboard | disabled |
| `HTTP_PORT` | HTTP port | 6790 |
| `DATABASE_URL` | PostgreSQL URL | in-memory |

## Examples

See [sdk/typescript/examples/](sdk/typescript/examples/):

- **01-basic** - Queue + Worker
- **02-job-options** - Priority, delay, retry
- **03-bulk-jobs** - Batch operations
- **04-events** - Worker events
- **05-queue-control** - Pause, resume
- **06-delayed** - Scheduled jobs
- **07-retry** - Retry with backoff
- **08-priority** - Priority ordering
- **09-concurrency** - Parallel processing
- **10-benchmark** - Performance test

## License

MIT
