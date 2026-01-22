<div align="center">

# flashQ

**High-performance job queue server built with Rust. No Redis required.**

[![CI](https://img.shields.io/github/actions/workflow/status/egeominotti/flashq/ci.yml?branch=main&label=CI)](https://github.com/egeominotti/flashq/actions)
[![npm](https://img.shields.io/npm/v/flashq)](https://www.npmjs.com/package/flashq)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

[Website](https://flashq.dev) • [Docs](https://flashq.dev/docs/) • [Blog](https://flashq.dev/blog/)

</div>

---

## Features

- **1.9M jobs/sec** push throughput, **280K jobs/sec** processing
- **BullMQ-compatible API** - easy migration from Redis-based queues
- **SQLite persistence** - embedded WAL mode, zero external dependencies
- **S3 backup** - AWS S3, Cloudflare R2, MinIO, Backblaze B2 compatible
- **Real-time dashboard** - WebSocket-powered monitoring UI
- **Advanced scheduling** - priorities, delays, cron jobs, rate limiting
- **Dead letter queues** - automatic retry with exponential backoff
- **Job dependencies** - workflow orchestration with parent/child jobs

## Quick Start

```bash
# Start server
docker run -d -p 6789:6789 -p 6790:6790 -e HTTP=1 ghcr.io/egeominotti/flashq:latest

# Install SDK
npm install flashq  # or: bun add flashq
```

```typescript
import { Queue, Worker } from 'flashq';

// Create queue and add jobs
const queue = new Queue('emails');
await queue.add('send', { to: 'user@example.com', subject: 'Welcome!' });

// Process jobs
const worker = new Worker('emails', async (job) => {
  await sendEmail(job.data);
  return { sent: true };
});

worker.on('completed', (job) => console.log(`Job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`Job ${job.id} failed: ${err}`));
```

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
│   Client    │────▶│  flashQ Server  │────▶│    SQLite    │
│  (SDK/API)  │     │   (Rust/Axum)   │     │  (embedded)  │
└─────────────┘     └─────────────────┘     └──────────────┘
      TCP/HTTP              │                      │
      Binary/JSON           ▼                      ▼
                    ┌───────────────┐      ┌──────────────┐
                    │   Dashboard   │      │  S3 Backup   │
                    │  (WebSocket)  │      │  (optional)  │
                    └───────────────┘      └──────────────┘
```

## Links

- **Documentation**: [flashq.dev/docs](https://flashq.dev/docs/)
- **Examples**: [sdk/typescript/examples/](sdk/typescript/examples/)
- **Technical Paper**: [docs/TECHNICAL_PAPER.md](docs/TECHNICAL_PAPER.md)
- **Releases**: [GitHub Releases](https://github.com/egeominotti/flashq/releases)

## License

MIT
