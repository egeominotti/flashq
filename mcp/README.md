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

## Available Tools (25)

### Job Operations (10 tools)

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

### Queue Management (8 tools)

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

### Dead Letter Queue (3 tools)

| Tool | Description |
|------|-------------|
| `get_dlq` | Get failed jobs from DLQ |
| `retry_dlq` | Retry DLQ jobs |
| `purge_dlq` | Remove all DLQ jobs |

### Monitoring (2 tools)

| Tool | Description |
|------|-------------|
| `get_stats` | Get overall queue statistics |
| `get_metrics` | Get detailed performance metrics |

### Admin (2 tools)

| Tool | Description |
|------|-------------|
| `list_crons` | List scheduled cron jobs |
| `clean_jobs` | Clean old jobs by age/state |

## Example Conversations

Once configured, you can ask Claude:

- "Push a job to the orders queue with priority 10"
- "How many jobs are waiting in the emails queue?"
- "Show me the failed jobs in the payments queue"
- "Retry all DLQ jobs for the notifications queue"
- "Pause the sync queue"
- "What's the current throughput?"

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
