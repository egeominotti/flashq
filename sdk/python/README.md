# flashQ Python SDK

[![PyPI version](https://img.shields.io/pypi/v/flashq)](https://pypi.org/project/flashq/)
[![PyPI downloads](https://img.shields.io/pypi/dm/flashq)](https://pypi.org/project/flashq/)
[![GitHub stars](https://img.shields.io/github/stars/egeominotti/flashq)](https://github.com/egeominotti/flashq)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**[Website](https://flashq.dev)** · **[Documentation](https://flashq.dev/docs/)** · **[GitHub](https://github.com/egeominotti/flashq)**

> **High-performance async job queue for Python. No Redis required.**

flashQ Python SDK provides an async-first client for the flashQ job queue server. Built for modern Python with full type hints, connection pooling, and BullMQ-compatible API.

## Features

- **Async/Await** - Native asyncio support with connection pooling
- **BullMQ-Compatible** - Queue and Worker classes for easy migration
- **Type-Safe** - Full type hints and mypy strict mode compatible
- **AI/ML Ready** - 10MB payloads, job dependencies, progress tracking
- **Production Ready** - Typed errors, retry logic, graceful shutdown

## Installation

```bash
pip install flashq
# or
uv add flashq
# or
poetry add flashq
```

**Requirements:** Python 3.10+

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

```python
import asyncio
from flashq import Queue, Worker, Job

# Create a queue
queue = Queue("emails")

async def main():
    await queue.connect()

    # Add a job
    job = await queue.add("send-welcome", {
        "to": "user@example.com",
        "subject": "Welcome!",
    })

    # Process jobs
    async def process(job: Job) -> dict:
        print(f"Sending email to {job.data['to']}")
        return {"sent": True, "timestamp": time.time()}

    worker = Worker("emails", process, concurrency=10)

    # Handle events
    @worker.on("completed")
    async def on_completed(job: Job, result: dict):
        print(f"Job {job.id} completed: {result}")

    @worker.on("failed")
    async def on_failed(job: Job, error: Exception):
        print(f"Job {job.id} failed: {error}")

    await worker.start()
    await worker.wait()

asyncio.run(main())
```

## API Reference

### Queue

```python
from flashq import Queue

queue = Queue("my-queue", host="localhost", port=6789)

async with queue:
    # Add a single job
    job = await queue.add("job-name", {"data": "value"}, {
        "priority": 10,           # Higher = processed first
        "delay": 5000,            # Delay in ms
        "attempts": 3,            # Max retry attempts
        "backoff": 1000,          # Exponential backoff base (ms)
        "timeout": 30000,         # Processing timeout (ms)
        "jobId": "unique-id",     # Custom ID for idempotency
        "depends_on": [1, 2],     # Wait for these jobs to complete
    })

    # Add multiple jobs
    await queue.add_bulk([
        {"name": "task", "data": {"id": 1}},
        {"name": "task", "data": {"id": 2}, "opts": {"priority": 10}},
    ])

    # Queue control
    await queue.pause()
    await queue.resume()
    await queue.drain()       # Remove all waiting jobs
    await queue.obliterate()  # Remove ALL queue data
```

### Worker

```python
from flashq import Worker, Job

worker = Worker("my-queue", process_fn, concurrency=10)

async def process_fn(job: Job) -> dict:
    # Process job
    print(f"Processing: {job.id} - {job.data}")

    # Return result (auto-acknowledged)
    return {"processed": True}

# Events (decorator style)
@worker.on("ready")
async def on_ready():
    print("Worker ready")

@worker.on("active")
async def on_active(job: Job):
    print(f"Job started: {job.id}")

@worker.on("completed")
async def on_completed(job: Job, result):
    print(f"Job done: {result}")

@worker.on("failed")
async def on_failed(job: Job, error: Exception):
    print(f"Job failed: {error}")

@worker.on("stopping")
async def on_stopping():
    print("Worker stopping...")

@worker.on("stopped")
async def on_stopped():
    print("Worker stopped")

# Graceful shutdown
await worker.stop()           # Wait for current jobs
await worker.stop(force=True) # Force close immediately
```

### Low-Level Client

For advanced use cases, use the `FlashQ` client directly:

```python
from flashq import FlashQ, ClientOptions

client = FlashQ(ClientOptions(
    host="localhost",
    port=6789,
    timeout=5.0,
    pool_size=4,
))

async with client:
    # Push/Pull operations
    job_id = await client.push("queue", {"data": "value"})
    job = await client.pull("queue", timeout=5000)
    await client.ack(job.id, {"result": "done"})

    # Job management
    state = await client.get_state(job_id)
    counts = await client.get_job_counts("queue")
    await client.cancel(job_id)

    # Cron jobs
    await client.add_cron("daily-cleanup",
        queue="maintenance",
        schedule="0 0 * * *",
        data={"task": "cleanup"},
    )
```

## Error Handling

flashQ provides typed error classes for precise error handling:

```python
from flashq import (
    FlashQError,
    ConnectionError,
    TimeoutError,
    ValidationError,
    ServerError,
    AuthenticationError,
    JobNotFoundError,
    DuplicateJobError,
    RateLimitError,
)

try:
    await client.push("queue", data)
except ConnectionError:
    print("Connection failed, retrying...")
except TimeoutError as e:
    print(f"Timeout after {e.timeout}ms")
except ValidationError as e:
    print(f"Invalid input: {e}")
except ServerError as e:
    print(f"Server error: {e.code}")
except FlashQError as e:
    # Check if error is retryable
    if e.retryable:
        # Safe to retry
        pass
```

## Retry Logic

Built-in retry utilities with exponential backoff:

```python
from flashq import retry, RetryPresets

# Wrap a single operation
result = await retry(
    lambda: client.push("queue", data),
    max_retries=3,
    initial_delay=0.1,
    max_delay=5.0,
    backoff_multiplier=2,
    jitter=True,
)

# Use presets
result = await retry(
    lambda: client.push("queue", data),
    **RetryPresets.standard,
)

# Available presets
RetryPresets.fast        # 2 retries, 50ms initial, 500ms max
RetryPresets.standard    # 3 retries, 100ms initial, 5s max
RetryPresets.aggressive  # 5 retries, 200ms initial, 30s max
```

## Push Options

```python
from flashq import PushOptions

options = PushOptions(
    priority=10,              # Higher = processed first
    delay=5000,               # Delay in ms
    ttl=60000,                # Time-to-live in ms
    timeout=30000,            # Processing timeout
    max_attempts=3,           # Retry attempts
    backoff=1000,             # Exponential backoff base (ms)
    unique_key="user:123",    # Deduplication key
    depends_on=[1, 2],        # Job dependencies
    tags=["urgent"],          # Job tags
    lifo=False,               # Last-In-First-Out mode
    stall_timeout=30000,      # Stall detection
    debounce_id="event",      # Debounce ID
    debounce_ttl=5000,        # Debounce window
    # BullMQ-like options
    job_id="order-123",       # Custom job ID for idempotency
    keep_completed_age=86400000,  # Keep result for 24h
    keep_completed_count=100,     # Keep in last 100 completed
)
```

## Performance

flashQ is **3-10x faster** than Redis-based queues:

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
| **Connection Pool** | 4 connections by default |

## AI/ML Workloads

flashQ is designed for AI pipelines with large payloads and complex workflows:

```python
from flashq import FlashQ

async with FlashQ() as client:
    # AI Agent with job dependencies

    # Step 1: Parse user intent
    parse_id = await client.push("ai-agent", {"step": "parse", "prompt": user_input})

    # Step 2: Retrieve context (waits for step 1)
    retrieve_id = await client.push("ai-agent",
        {"step": "retrieve", "query": query},
        depends_on=[parse_id],
    )

    # Step 3: Generate response (waits for step 2)
    generate_id = await client.push("ai-agent",
        {"step": "generate", "context": context},
        depends_on=[retrieve_id],
        priority=10,
    )

    # Wait for the final result
    result = await client.finished(generate_id, timeout=60000)
```

## Configuration

### Client Options

```python
@dataclass
class ClientOptions:
    host: str = "localhost"
    port: int = 6789
    http_port: int = 6790
    token: str | None = None          # Auth token
    timeout: float = 5.0              # Connection timeout (seconds)
    use_http: bool = False            # Use HTTP instead of TCP
    use_binary: bool = False          # Use MessagePack (40% smaller)
    auto_reconnect: bool = True
    reconnect_delay: float = 1.0
    max_reconnect_delay: float = 30.0
    max_reconnect_attempts: int = 10
    log_level: LogLevel = LogLevel.INFO
    pool_size: int = 4                # Connection pool size
```

### Worker Options

```python
@dataclass
class WorkerOptions:
    concurrency: int = 1              # Parallel jobs
    batch_size: int = 100             # Jobs per batch pull
    auto_start: bool = True           # Auto-start
    close_timeout: float = 30.0       # Graceful shutdown timeout (seconds)
    stall_timeout: float = 30.0       # Stall detection
```

## Examples

Run examples with:

```bash
python examples/01_basic.py
```

| Example | Description |
|---------|-------------|
| `01_basic.py` | Push, Pull, Ack basics |
| `02_worker.py` | Concurrent processing |
| `03_priority.py` | Priority ordering |
| `04_delayed.py` | Scheduled jobs |
| `05_batch.py` | High-throughput batching |
| `06_retry.py` | Error handling, DLQ |
| `07_progress.py` | Progress tracking |
| `08_cron.py` | Scheduled recurring jobs |
| `09_rate_limit.py` | Rate limiting |
| `10_queue_api.py` | BullMQ-compatible API |
| `11_unique.py` | Job deduplication |
| `12_finished.py` | Wait for completion |
| `17_benchmark.py` | Performance testing |
| `18_flow.py` | Parent/child workflows |
| `19_ai_workflow.py` | AI agent pipeline |
| `21_rag_pipeline.py` | RAG implementation |

## Type Hints

The SDK is fully typed and compatible with mypy strict mode:

```python
from flashq import FlashQ, Job, JobState, PushOptions

async def process(job: Job[dict]) -> dict:
    data: dict = job.data
    return {"processed": True}
```

## Resources

- **Website:** [flashq.dev](https://flashq.dev)
- **Documentation:** [flashq.dev/docs](https://flashq.dev/docs/)
- **GitHub:** [github.com/egeominotti/flashq](https://github.com/egeominotti/flashq)
- **PyPI:** [pypi.org/project/flashq](https://pypi.org/project/flashq/)

## License

MIT
