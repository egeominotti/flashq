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

## MCP Server (AI Integration)

Enable Claude and other AI assistants to manage your job queues through the [Model Context Protocol](https://modelcontextprotocol.io/). Claude can even **act as a worker** to process jobs.

```bash
npm install -g flashq-mcp
```

### Claude Desktop Setup

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flashq": {
      "command": "npx",
      "args": ["flashq-mcp"],
      "env": {
        "FLASHQ_HOST": "localhost",
        "FLASHQ_HTTP_PORT": "6790"
      }
    }
  }
}
```

### Example Conversations

Once configured, you can ask Claude:

- *"Push a job to the orders queue with priority 10"*
- *"Pull a job from the tasks queue and process it"*
- *"How many jobs are waiting in the emails queue?"*
- *"Set rate limit of 10 jobs/sec on the api queue"*
- *"Add a cron job that runs every 5 minutes"*
- *"Show me the health status and throughput"*

### Available Tools (43)

| Category | Count | Tools |
|----------|-------|-------|
| **Jobs** | 15 | `push_job`, `push_batch_jobs`, `get_job`, `get_job_state`, `get_job_result`, `get_job_by_custom_id`, `list_jobs`, `get_job_counts`, `cancel_job`, `get_job_progress`, `get_job_logs`, `change_priority`, `move_to_delayed`, `promote_job`, `discard_job` |
| **Worker** | 6 | `pull_job`, `ack_job`, `fail_job`, `update_progress`, `add_job_log`, `heartbeat` |
| **Queues** | 11 | `list_queues`, `pause_queue`, `resume_queue`, `is_queue_paused`, `drain_queue`, `count_jobs`, `set_rate_limit`, `clear_rate_limit`, `set_concurrency`, `clear_concurrency`, `obliterate_queue` |
| **DLQ** | 3 | `get_dlq`, `retry_dlq`, `purge_dlq` |
| **Monitoring** | 4 | `get_stats`, `get_metrics`, `get_metrics_history`, `health_check` |
| **Admin** | 4 | `list_crons`, `add_cron`, `delete_cron`, `clean_jobs` |

See [mcp/README.md](mcp/README.md) for full documentation.

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
