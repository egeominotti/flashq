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
```

## SDKs

### TypeScript / JavaScript

```bash
npm install flashq  # or: bun add flashq
```

```typescript
import { Queue, Worker } from 'flashq';

const queue = new Queue('emails');
await queue.add('send', { to: 'user@example.com', subject: 'Welcome!' });

const worker = new Worker('emails', async (job) => {
  await sendEmail(job.data);
  return { sent: true };
});
```

### Python

```bash
pip install flashq
```

```python
from flashq import FlashQ, Worker

client = FlashQ()
client.connect()

# Push job
job_id = client.push("emails", {"to": "user@example.com", "subject": "Welcome!"})

# Process jobs
def process(job):
    send_email(job.data)
    return {"sent": True}

worker = Worker(["emails"], process)
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
    "github.com/flashq/flashq-go/flashq"
)

func main() {
    client := flashq.New()
    client.Connect(context.Background())
    defer client.Close()

    // Push job
    jobID, _ := client.Push("emails", map[string]interface{}{
        "to": "user@example.com", "subject": "Welcome!",
    }, nil)

    // Process jobs
    worker := flashq.NewWorkerSingle("emails", func(job *flashq.Job) (interface{}, error) {
        // process job.Data
        return map[string]interface{}{"sent": true}, nil
    }, nil, nil)
    worker.Start(context.Background())
}
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
- **Examples**:
  - TypeScript: [sdk/typescript/examples/](sdk/typescript/examples/) (15 examples)
  - Python: [sdk/python/examples/](sdk/python/examples/) (10 examples)
  - Go: [sdk/go/examples/](sdk/go/examples/) (23 examples)
- **Technical Paper**: [docs/TECHNICAL_PAPER.md](docs/TECHNICAL_PAPER.md)
- **Releases**: [GitHub Releases](https://github.com/egeominotti/flashq/releases)

## License

MIT
