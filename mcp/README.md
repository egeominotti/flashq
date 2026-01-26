# flashQ MCP Server

[![npm version](https://badge.fury.io/js/flashq-mcp.svg)](https://www.npmjs.com/package/flashq-mcp)

MCP (Model Context Protocol) server that enables AI assistants like Claude to manage flashQ job queues.

## Installation

```bash
npm install -g flashq-mcp
```

Or use directly with npx:

```bash
npx flashq-mcp
```

## Quick Start

1. **Start flashQ server** with HTTP API enabled:

```bash
cd engine
HTTP=1 cargo run --release
```

2. **Configure Claude Desktop** (`~/.config/claude/claude_desktop_config.json`):

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

3. **Restart Claude Desktop** and start managing queues!

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `FLASHQ_HOST` | localhost | flashQ server host |
| `FLASHQ_HTTP_PORT` | 6790 | HTTP API port |
| `FLASHQ_TOKEN` | - | Auth token (optional) |
| `FLASHQ_TIMEOUT` | 30000 | Request timeout (ms) |

## Available Tools (55)

### Job Operations (15 tools)

| Tool | Description |
|------|-------------|
| `push_job` | Create a new job with priority, delay, retry options |
| `push_batch_jobs` | Create multiple jobs at once (max 1000) |
| `get_job` | Get job details with current state |
| `get_job_state` | Get only the job state |
| `get_job_result` | Get completed job result |
| `get_job_by_custom_id` | Find job by custom ID |
| `list_jobs` | List jobs with filtering and pagination |
| `get_job_counts` | Get job counts by state for a queue |
| `cancel_job` | Cancel a pending job |
| `get_job_progress` | Get progress for active job |
| `get_job_logs` | Get log entries for a job |
| `change_priority` | Change priority of a waiting job |
| `move_to_delayed` | Move active job back to delayed state |
| `promote_job` | Promote delayed job to waiting immediately |
| `discard_job` | Move job directly to DLQ |

### Worker Operations (6 tools)

| Tool | Description |
|------|-------------|
| `pull_job` | Pull a job from queue for processing |
| `ack_job` | Acknowledge successful job completion |
| `fail_job` | Mark job as failed (retry or DLQ) |
| `update_progress` | Update job progress (0-100%) |
| `add_job_log` | Add log entry during processing |
| `heartbeat` | Send heartbeat for long-running jobs |

### Queue Management (11 tools)

| Tool | Description |
|------|-------------|
| `list_queues` | List all queues with status |
| `pause_queue` | Pause queue processing |
| `resume_queue` | Resume paused queue |
| `is_queue_paused` | Check if queue is paused |
| `drain_queue` | Remove all waiting jobs |
| `count_jobs` | Count waiting + delayed jobs |
| `set_rate_limit` | Set jobs/sec limit |
| `clear_rate_limit` | Remove rate limit |
| `set_concurrency` | Set max concurrent jobs |
| `clear_concurrency` | Remove concurrency limit |
| `obliterate_queue` | DESTRUCTIVE: Delete queue and all data |

### Dead Letter Queue (3 tools)

| Tool | Description |
|------|-------------|
| `get_dlq` | Get failed jobs from DLQ |
| `retry_dlq` | Retry DLQ jobs |
| `purge_dlq` | Remove all DLQ jobs |

### Monitoring (7 tools)

| Tool | Description |
|------|-------------|
| `get_stats` | Get overall queue statistics |
| `get_metrics` | Get detailed performance metrics |
| `get_metrics_history` | Get historical metrics for trends |
| `health_check` | Check server health and uptime |
| `list_workers` | List active workers connected to server |
| `get_prometheus_metrics` | Get metrics in Prometheus format |
| `get_system_metrics` | Get CPU/memory system metrics |

### Admin (4 tools)

| Tool | Description |
|------|-------------|
| `list_crons` | List scheduled cron jobs |
| `add_cron` | Add a new cron job |
| `delete_cron` | Delete a cron job |
| `clean_jobs` | Clean old jobs by age/state |

### Webhooks (3 tools)

| Tool | Description |
|------|-------------|
| `list_webhooks` | List registered webhooks |
| `create_webhook` | Create webhook for job events |
| `delete_webhook` | Delete a webhook |

### Advanced (6 tools)

| Tool | Description |
|------|-------------|
| `wait_job` | Wait for job completion (sync workflows) |
| `update_job` | Update job data while waiting |
| `push_flow` | Push workflow with parent/children |
| `get_children` | Get child jobs for a flow |
| `ack_batch` | Batch acknowledge multiple jobs |
| `send_partial` | Send partial/streaming result |

## Example Conversations

Once configured, you can ask Claude:

**Job Management:**
- "Push a job to the orders queue with priority 10"
- "How many jobs are waiting in the emails queue?"
- "Show me the failed jobs in the payments queue"
- "Change the priority of job 123 to 100"

**Worker Mode (Claude processes jobs!):**
- "Pull a job from the tasks queue and process it"
- "Acknowledge job 456 with result success"
- "Update progress on job 789 to 50%"

**Queue Control:**
- "Pause the sync queue"
- "Set rate limit of 10 jobs/sec on the api queue"
- "Limit concurrency to 5 on the heavy-tasks queue"

**Monitoring:**
- "What's the current throughput?"
- "Show me the health status"
- "Retry all DLQ jobs for the notifications queue"

**Scheduling:**
- "Add a cron job that runs every 5 minutes on cleanup queue"
- "List all scheduled cron jobs"

## Architecture

```
┌─────────────┐     MCP (stdio)     ┌─────────────────┐     HTTP     ┌─────────────┐
│   Claude    │ ◄─────────────────► │  flashQ MCP     │ ◄──────────► │  flashQ     │
│             │                     │  Server (TS)    │   :6790      │  Engine     │
└─────────────┘                     └─────────────────┘              └─────────────┘
```

## Development

```bash
# Clone and install
git clone https://github.com/flashq/flashq.git
cd flashq/mcp
bun install

# Development
bun run dev

# Type check
bun run typecheck

# Lint
bun run lint

# Format
bun run format

# Build
bun run build

# Test
bun run test
```

## License

MIT
