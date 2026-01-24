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

## Quick Start

```bash
# Start server
docker run -d -p 6789:6789 -p 6790:6790 -e HTTP=1 ghcr.io/egeominotti/flashq:latest
```

## SDKs

### TypeScript / JavaScript

```bash
npm install flashq  # or: bun add flashq
```

```typescript
import { Queue, Worker } from 'flashq';

// Push jobs
const queue = new Queue('emails');
await queue.add('send', { to: 'user@example.com', subject: 'Welcome!' });
await queue.addBulk([
  { name: 'send', data: { to: 'a@test.com' } },
  { name: 'send', data: { to: 'b@test.com' } },
]);

// Process jobs
const worker = new Worker('emails', async (job) => {
  await sendEmail(job.data);
  return { sent: true };
});

worker.on('completed', (job, result) => console.log(`✅ Job ${job.id} done`));
worker.on('failed', (job, err) => console.error(`❌ Job ${job.id}: ${err.message}`));
```

### Python

```bash
pip install flashq
```

```python
from flashq import FlashQ, Worker

client = FlashQ()
client.connect()

# Push jobs
client.push("emails", {"to": "user@example.com"})
client.push_batch("emails", [
    {"data": {"to": "a@test.com"}},
    {"data": {"to": "b@test.com"}},
])

# Process jobs
def process(job):
    send_email(job.data)
    return {"sent": True}

worker = Worker(["emails"], process)
worker.on("completed", lambda job, res: print(f"✅ Job {job.id} done"))
worker.on("failed", lambda job, err: print(f"❌ Job {job.id}: {err}"))
worker.start()
```

### Go

```bash
go get github.com/flashq/flashq-go
```

```go
package main

import (
    "context"
    "fmt"
    "github.com/flashq/flashq-go/flashq"
)

func main() {
    client := flashq.New()
    client.Connect(context.Background())
    defer client.Close()

    // Push jobs
    client.Push("emails", map[string]any{"to": "user@example.com"}, nil)
    client.PushBatch("emails", []map[string]any{
        {"data": map[string]any{"to": "a@test.com"}},
        {"data": map[string]any{"to": "b@test.com"}},
    })

    // Process jobs with events
    worker := flashq.NewWorkerSingle("emails", func(job *flashq.Job) (any, error) {
        return map[string]any{"sent": true}, nil
    }, nil, nil)

    worker.On("completed", func(job *flashq.Job, result any) {
        fmt.Printf("✅ Job %d done\n", job.ID)
    })
    worker.On("failed", func(job *flashq.Job, err error) {
        fmt.Printf("❌ Job %d: %v\n", job.ID, err)
    })

    worker.Start(context.Background())
}
```

## Links

- **Documentation**: [flashq.dev/docs](https://flashq.dev/docs/)
- **Examples**:
  - TypeScript: [sdk/typescript/examples/](sdk/typescript/examples/) (15 examples)
  - Python: [sdk/python/examples/](sdk/python/examples/) (10 examples)
  - Go: [sdk/go/examples/](sdk/go/examples/) (23 examples)
- **Technical Paper**: [docs/TECHNICAL_PAPER.md](docs/TECHNICAL_PAPER.md)
- **Releases**: [GitHub Releases](https://github.com/egeominotti/flashq/releases)

## License

MIT
