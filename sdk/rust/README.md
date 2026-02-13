# flashQ Rust SDK

High-performance Rust client for [flashQ](https://github.com/egeominotti/flashq) job queue server.

## Features

- **Async/await** - Built on Tokio for native async support
- **Connection pooling** - Round-robin pool with auto-reconnect
- **Dual protocol** - JSON (text) and MessagePack (binary, 40% smaller, 3-5x faster)
- **BullMQ-compatible** - Queue and Worker classes with familiar API
- **Full feature set** - 60+ methods covering all flashQ operations

## Installation

```bash
cargo add flashq
```

Or add to `Cargo.toml`:

```toml
[dependencies]
flashq = "0.4"
tokio = { version = "1", features = ["full"] }
```

## Quick Start

### Start the Server

```bash
docker run -p 6789:6789 flashq
```

### Push and Process Jobs

```rust
use flashq::{FlashQ, Worker, WorkerOptions};
use flashq::types::WorkerEvent;

#[tokio::main]
async fn main() -> flashq::Result<()> {
    // Push a job
    let client = FlashQ::new();
    client.connect().await?;

    let job_id = client.push("emails", serde_json::json!({
        "to": "user@example.com",
        "subject": "Welcome!",
    }), None).await?;
    println!("Pushed job: {job_id}");
    client.close().await?;

    // Process jobs with a worker
    let worker = Worker::new(
        vec!["emails".to_string()],
        |job| async move {
            println!("Sending email to: {}", job.data["to"]);
            Ok(serde_json::json!({"sent": true}))
        },
        Some(WorkerOptions {
            concurrency: 5,
            ..Default::default()
        }),
    );

    worker.start().await?;
    Ok(())
}
```

## API Reference

### Queue (BullMQ-compatible)

```rust
use flashq::Queue;

let queue = Queue::new("emails");
queue.connect().await?;

// Add jobs
let id = queue.add("send-welcome", data, None).await?;
let ids = queue.add_bulk(jobs).await?;

// Query
let job = queue.get_job(id).await?;
let counts = queue.get_job_counts().await?;
let total = queue.count().await?;

// Control
queue.pause().await?;
queue.resume().await?;
queue.drain().await?;
queue.obliterate().await?;
queue.close().await?;
```

### Worker

```rust
use flashq::{Worker, WorkerOptions, WorkerEventData};
use flashq::types::WorkerEvent;

let worker = Worker::new(
    vec!["tasks".to_string()],
    |job| async move {
        println!("Processing: {:?}", job.data);
        Ok(serde_json::json!({"done": true}))
    },
    Some(WorkerOptions {
        concurrency: 10,
        ..Default::default()
    }),
);

worker.on(WorkerEvent::Completed, |event| {
    if let WorkerEventData::Completed { job_id, .. } = event {
        println!("Job {job_id} done!");
    }
});

worker.start().await?;
```

### Low-Level Client

```rust
use flashq::{FlashQ, ClientOptions, PushOptions};
use std::time::Duration;

let client = FlashQ::with_options(ClientOptions {
    host: "localhost".into(),
    port: 6789,
    use_binary: true, // MessagePack protocol
    pool_size: 4,
    ..Default::default()
});
client.connect().await?;

// Core operations
let id = client.push("queue", data, Some(PushOptions {
    priority: Some(10),
    delay: Some(5000),
    max_attempts: Some(3),
    ..Default::default()
})).await?;

let job = client.pull("queue", Some(Duration::from_secs(30))).await?;
client.ack(job_id, Some(result)).await?;
client.fail(job_id, Some("error message")).await?;

// Job queries
let job = client.get_job(id).await?;
let state = client.get_state(id).await?;
let result = client.finished(id, Some(Duration::from_secs(30))).await?;

// Queue management
client.pause("queue").await?;
client.resume("queue").await?;
client.set_rate_limit("queue", 100).await?;
client.set_concurrency("queue", 5).await?;

// Cron jobs
client.add_cron("daily-cleanup", CronOptions {
    queue: "maintenance".into(),
    data: serde_json::json!({"action": "cleanup"}),
    schedule: Some("0 0 * * * *".into()),
    ..Default::default()
}).await?;

// Flows (parent-child dependencies)
let flow = client.push_flow("parent-queue", parent_data, vec![
    FlowChild { queue: "child-q".into(), data: child_data, .. },
], None).await?;

client.close().await?;
```

### Error Handling

```rust
use flashq::{FlashQ, FlashQError};

match client.push("queue", data, None).await {
    Ok(id) => println!("Job {id}"),
    Err(FlashQError::Connection(msg)) => eprintln!("Connection lost: {msg}"),
    Err(FlashQError::Timeout(msg)) => eprintln!("Timed out: {msg}"),
    Err(FlashQError::DuplicateJob(msg)) => eprintln!("Duplicate: {msg}"),
    Err(FlashQError::RateLimit(msg)) => eprintln!("Rate limited: {msg}"),
    Err(FlashQError::Validation(msg)) => eprintln!("Invalid: {msg}"),
    Err(e) => eprintln!("Error: {e}"),
}

// Check if retryable
if e.is_retryable() {
    // Safe to retry
}
```

### Push Options

| Option | Type | Description |
|--------|------|-------------|
| `priority` | `i32` | Higher = processed first |
| `delay` | `u64` | Delay in ms before becoming ready |
| `ttl` | `u64` | Time-to-live in ms |
| `timeout` | `u64` | Processing timeout in ms |
| `max_attempts` | `u32` | Max retries before DLQ |
| `backoff` | `u64` | Exponential backoff base in ms |
| `unique_key` | `String` | Deduplication key |
| `depends_on` | `Vec<u64>` | Job IDs to wait for |
| `tags` | `Vec<String>` | Job tags for filtering |
| `lifo` | `bool` | Last-in-first-out mode |
| `job_id` | `String` | Custom job ID (idempotency) |
| `stall_timeout` | `u64` | Stall detection timeout in ms |
| `group_id` | `String` | FIFO processing within group |
| `keep_completed_age` | `u64` | Retention: keep for N ms |
| `keep_completed_count` | `u64` | Retention: keep last N |

## Configuration

### ClientOptions

| Option | Default | Description |
|--------|---------|-------------|
| `host` | `"localhost"` | Server host |
| `port` | `6789` | TCP port |
| `token` | `None` | Auth token |
| `timeout` | `5s` | Request timeout |
| `use_binary` | `false` | Use MessagePack protocol |
| `auto_reconnect` | `true` | Auto-reconnect on disconnect |
| `pool_size` | `4` | Connection pool size |
| `reconnect_delay` | `1s` | Initial reconnect delay |
| `max_reconnect_delay` | `30s` | Max reconnect delay |
| `max_reconnect_attempts` | `10` | Max reconnect attempts |

### WorkerOptions

| Option | Default | Description |
|--------|---------|-------------|
| `concurrency` | `1` | Parallel job processing |
| `batch_size` | `100` | Jobs per pull batch |
| `auto_start` | `true` | Start on creation |
| `close_timeout` | `30s` | Graceful shutdown timeout |
| `stall_timeout` | `30s` | Stall detection timeout |

## Examples

| # | Example | Description |
|---|---------|-------------|
| 01 | [basic](examples/01_basic.rs) | Push, Pull, Ack |
| 02 | [worker](examples/02_worker.rs) | Worker processing |
| 03 | [priority](examples/03_priority.rs) | Priority ordering |
| 04 | [delayed](examples/04_delayed.rs) | Scheduled jobs |
| 05 | [batch](examples/05_batch.rs) | Batch operations |
| 06 | [retry](examples/06_retry.rs) | Retry & DLQ |
| 07 | [progress](examples/07_progress.rs) | Progress tracking |
| 08 | [cron](examples/08_cron.rs) | Cron scheduling |
| 09 | [rate_limit](examples/09_rate_limit.rs) | Rate limiting |
| 10 | [queue_api](examples/10_queue_api.rs) | BullMQ Queue API |
| 11 | [unique](examples/11_unique.rs) | Job deduplication |
| 12 | [finished](examples/12_finished.rs) | Wait for completion |
| 13 | [job_options](examples/13_job_options.rs) | All push options |
| 14 | [events](examples/14_events.rs) | Worker events |
| 15 | [queue_control](examples/15_queue_control.rs) | Pause/Resume/Drain |
| 16 | [concurrency](examples/16_concurrency.rs) | Concurrency limits |
| 17 | [benchmark](examples/17_benchmark.rs) | Performance benchmark |
| 18 | [flow](examples/18_flow.rs) | Job dependencies |
| 19 | [ai_workflow](examples/19_ai_workflow.rs) | AI/ML pipeline |
| 20 | [batch_inference](examples/20_batch_inference.rs) | Batch ML inference |
| 21 | [rag_pipeline](examples/21_rag_pipeline.rs) | RAG workflow |
| 22 | [groups](examples/22_groups.rs) | Job groups (FIFO) |
| 23 | [streaming](examples/23_streaming.rs) | Partial results |

Run an example:

```bash
cargo run --example 01_basic
```

## Performance

| Metric | flashQ (Rust SDK) | Redis/BullMQ |
|--------|-------------------|--------------|
| Push (batch) | ~1.9M jobs/sec | ~50K jobs/sec |
| Processing | ~280K jobs/sec | ~15K jobs/sec |
| Wire size | 40% smaller (MessagePack) | JSON only |

## Resources

- [GitHub](https://github.com/egeominotti/flashq)
- [Documentation](https://github.com/egeominotti/flashq/tree/main/docs)
- [TypeScript SDK](https://github.com/egeominotti/flashq/tree/main/sdk/typescript)
- [Python SDK](https://github.com/egeominotti/flashq/tree/main/sdk/python)
- [Go SDK](https://github.com/egeominotti/flashq/tree/main/sdk/go)

## License

MIT
