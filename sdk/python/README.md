# flashQ Python SDK

High-performance Python client for [flashQ](https://github.com/egeominotti/flashq) job queue.

## Features

- **Async/await** - Built on asyncio for high concurrency
- **Type hints** - Full type annotations (Python 3.10+)
- **BullMQ-compatible** - Familiar API for easy migration
- **Worker class** - Concurrent job processing with graceful shutdown
- **Binary protocol** - MessagePack support for faster serialization
- **Retry logic** - Exponential backoff with jitter
- **All flashQ features** - Priorities, delays, cron, DLQ, rate limiting, etc.

## Installation

```bash
pip install flashq
```

Or with development dependencies:

```bash
pip install flashq[dev]
```

## Quick Start

### Basic Usage

```python
import asyncio
from flashq import FlashQ

async def main():
    async with FlashQ() as client:
        # Push a job
        job_id = await client.push("emails", {
            "to": "user@example.com",
            "subject": "Hello!",
        })

        # Pull and process
        job = await client.pull("emails")
        if job:
            print(f"Processing: {job.data}")
            await client.ack(job.id, {"sent": True})

asyncio.run(main())
```

### Worker

```python
from flashq import Worker, Job

async def process_email(job: Job[dict]) -> dict:
    print(f"Sending to {job.data['to']}")
    return {"sent": True}

worker = Worker("emails", process_email, worker_options={
    "concurrency": 5,
    "batch_size": 100,
})

# Events
worker.on("completed", lambda job, result: print(f"Done: {job.id}"))
worker.on("failed", lambda job, err: print(f"Error: {err}"))

await worker.start()
# Worker processes jobs until stopped
await worker.stop()
```

### Queue (BullMQ-compatible)

```python
from flashq import Queue

async with Queue("orders") as queue:
    # BullMQ-style API
    job = await queue.add("process", {"orderId": 123})

    # Bulk add
    jobs = await queue.add_bulk([
        {"name": "process", "data": {"orderId": 124}},
        {"name": "process", "data": {"orderId": 125}},
    ])

    # Queue management
    await queue.pause()
    await queue.resume()
    await queue.drain()
```

## API Reference

### FlashQ Client

```python
from flashq import FlashQ, ClientOptions

client = FlashQ(ClientOptions(
    host="localhost",
    port=6789,
    token="secret",        # Optional auth
    use_binary=True,       # MessagePack protocol
    auto_reconnect=True,
))

await client.connect()

# Core operations
job_id = await client.push(queue, data, options)
job = await client.pull(queue, timeout=30000)
await client.ack(job_id, result)
await client.fail(job_id, error)

# Batch operations
result = await client.push_batch(queue, jobs)
jobs = await client.pull_batch(queue, count=100)
await client.ack_batch(job_ids)

# Job management
await client.cancel(job_id)
await client.progress(job_id, 50, "Halfway done")
result = await client.finished(job_id, timeout=30000)

# Queue management
await client.pause(queue)
await client.resume(queue)
await client.drain(queue)

# Rate limiting
await client.set_rate_limit(queue, 100)  # 100 jobs/sec
await client.set_concurrency(queue, 10)  # 10 concurrent

# Cron jobs
await client.add_cron("daily", queue, "0 0 * * *", data)
await client.delete_cron("daily")

# Monitoring
stats = await client.stats()
metrics = await client.metrics()

await client.close()
```

### Push Options

```python
from flashq import PushOptions

options = PushOptions(
    priority=10,           # Higher = processed first
    delay=5000,            # Delay in ms
    ttl=60000,             # Time-to-live
    timeout=30000,         # Processing timeout
    max_attempts=3,        # Retry attempts
    backoff=1000,          # Backoff base (exponential)
    unique_key="key",      # Deduplication
    depends_on=[1, 2],     # Job dependencies
    tags=["tag1"],         # Job tags
    job_id="custom-id",    # Custom ID for idempotency
)
```

### Worker Options

```python
from flashq import WorkerOptions

options = WorkerOptions(
    concurrency=5,         # Parallel workers
    batch_size=100,        # Jobs per pull
    auto_start=True,       # Start immediately
    close_timeout=30000,   # Shutdown timeout
)
```

## Examples

See the [examples](./examples) directory for more:

- `01_basic.py` - Basic push/pull/ack
- `02_worker.py` - Worker with events
- `03_priority.py` - Job priorities
- `04_delayed.py` - Delayed jobs
- `05_batch.py` - Batch operations
- `06_retry.py` - Retry and DLQ
- `07_progress.py` - Progress tracking
- `08_cron.py` - Cron jobs
- `09_rate_limit.py` - Rate limiting
- `10_queue_api.py` - BullMQ-compatible Queue
- `11_unique.py` - Unique/deduplicated jobs
- `12_finished.py` - Wait for completion

## Error Handling

```python
from flashq import (
    FlashQError,
    ConnectionError,
    TimeoutError,
    ValidationError,
    JobNotFoundError,
    DuplicateJobError,
    RateLimitError,
)

try:
    await client.push("queue", data)
except ConnectionError:
    print("Not connected")
except TimeoutError:
    print("Request timed out")
except ValidationError as e:
    print(f"Invalid input: {e}")
except DuplicateJobError:
    print("Job already exists")
except RateLimitError:
    print("Rate limited, try later")
except FlashQError as e:
    print(f"flashQ error: {e}")
```

## Requirements

- Python 3.10+
- flashQ server running

## License

MIT
