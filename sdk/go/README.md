# flashQ Go SDK

High-performance Go client for [flashQ](https://github.com/flashq/flashq) job queue server.

## Installation

```bash
go get github.com/flashq/flashq-go
```

## Quick Start

```go
package main

import (
    "context"
    "fmt"
    "log"

    "github.com/flashq/flashq-go/flashq"
)

func main() {
    ctx := context.Background()

    // Create client
    client := flashq.New()
    if err := client.Connect(ctx); err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Push a job
    jobID, _ := client.Push("emails", map[string]interface{}{
        "to": "user@example.com",
    }, nil)
    fmt.Printf("Pushed job: %d\n", jobID)

    // Pull and process
    job, _ := client.Pull("emails", 5*time.Second)
    fmt.Printf("Got job: %v\n", job.Data)

    // Acknowledge
    client.Ack(job.ID, nil)
}
```

## Features

### Core Operations

| Method | Description |
|--------|-------------|
| `Push(queue, data, opts)` | Push a job to a queue |
| `PushBatch(queue, jobs)` | Push multiple jobs |
| `PushFlow(queue, data, children, opts)` | Push workflow with dependencies |
| `Pull(queue, timeout)` | Pull a job (blocking) |
| `PullBatch(queue, count, timeout)` | Pull multiple jobs |
| `Ack(jobID, result)` | Acknowledge job completion |
| `AckBatch(jobIDs)` | Acknowledge multiple jobs |
| `Fail(jobID, error)` | Fail a job (retry or DLQ) |

### Job Query

| Method | Description |
|--------|-------------|
| `GetJob(jobID)` | Get job by ID |
| `GetState(jobID)` | Get job state only |
| `GetResult(jobID)` | Get job result |
| `GetJobByCustomID(customID)` | Lookup job by custom ID |
| `GetJobs(queue, state, limit, offset)` | List jobs with filtering |
| `GetJobCounts(queue)` | Get counts by state |
| `Count(queue)` | Count waiting + delayed |

### Job Management

| Method | Description |
|--------|-------------|
| `Cancel(jobID)` | Cancel a pending job |
| `Progress(jobID, progress, message)` | Update progress (0-100) |
| `GetProgress(jobID)` | Get job progress |
| `Finished(jobID, timeout)` | Wait for completion |
| `Update(jobID, data)` | Update job data |
| `ChangePriority(jobID, priority)` | Change priority |
| `MoveToDelayed(jobID, delay)` | Move to delayed |
| `Promote(jobID)` | Move delayed to waiting |
| `Discard(jobID)` | Move to DLQ |
| `Heartbeat(jobID)` | Keep job alive |
| `Log(jobID, message, level)` | Add log entry |
| `GetLogs(jobID)` | Get log entries |

### Queue Management

| Method | Description |
|--------|-------------|
| `Pause(queue)` | Pause a queue |
| `Resume(queue)` | Resume a queue |
| `IsPaused(queue)` | Check if paused |
| `Drain(queue)` | Remove all waiting jobs |
| `Obliterate(queue)` | Remove ALL queue data |
| `Clean(queue, grace, state, limit)` | Cleanup by age |
| `ListQueues()` | List all queues |

### DLQ & Rate Limiting

| Method | Description |
|--------|-------------|
| `GetDLQ(queue, count)` | Get DLQ jobs |
| `RetryDLQ(queue, jobID)` | Retry DLQ jobs |
| `SetRateLimit(queue, limit)` | Set rate limit |
| `ClearRateLimit(queue)` | Clear rate limit |
| `SetConcurrency(queue, limit)` | Set concurrency limit |
| `ClearConcurrency(queue)` | Clear concurrency |

### Cron Jobs

| Method | Description |
|--------|-------------|
| `AddCron(name, queue, schedule, data, opts)` | Add cron job |
| `DeleteCron(name)` | Delete cron job |
| `ListCrons()` | List all cron jobs |

### Monitoring

| Method | Description |
|--------|-------------|
| `Stats()` | Get queue statistics |
| `Metrics()` | Get detailed metrics |

## Push Options

```go
opts := &flashq.PushOptions{
    Priority:           10,           // Higher = processed first
    Delay:              5*time.Second, // Delay before processing
    TTL:                60*time.Second, // Auto-expire
    Timeout:            30*time.Second, // Max processing time
    MaxAttempts:        3,             // Retry attempts
    Backoff:            1*time.Second,  // Backoff base
    UniqueKey:          "order-123",   // Deduplication
    DependsOn:          []int64{1, 2}, // Job dependencies
    Tags:               []string{"tag"}, // Tags
    LIFO:               false,         // Last In First Out
    StallTimeout:       60*time.Second, // Stall detection
    DebounceID:         "user-typing", // Debounce ID
    DebounceTTL:        500*time.Millisecond,
    JobID:              "custom-id",   // Custom job ID
    KeepCompletedAge:   24*time.Hour,  // Result retention
    KeepCompletedCount: 100,           // Keep last N
    GroupID:            "customer-A",  // FIFO within group
}
```

## Worker

```go
processor := func(job *flashq.Job) (interface{}, error) {
    data := job.Data.(map[string]interface{})
    // Process job...
    return map[string]interface{}{"done": true}, nil
}

opts := flashq.DefaultWorkerOptions()
opts.Concurrency = 5
opts.AutoStart = false

worker := flashq.NewWorkerSingle("queue", processor, nil, &opts)

// Register events
worker.On("completed", func(job *flashq.Job, result interface{}) {
    fmt.Printf("Job %d completed\n", job.ID)
})

worker.On("failed", func(job *flashq.Job, err error) {
    fmt.Printf("Job %d failed: %v\n", job.ID, err)
})

// Start
worker.Start(ctx)

// Stop gracefully
worker.Stop(ctx)
```

## Queue (BullMQ-Compatible)

```go
queue := flashq.NewQueue("emails", nil)
queue.Connect(ctx)
defer queue.Close()

// Add job
job, _ := queue.Add("send-email", data, nil)

// Get counts
counts, _ := queue.GetJobCounts()

// Pause/Resume
queue.Pause()
queue.Resume()

// Clean old jobs
queue.Clean(24*time.Hour, 100, flashq.JobStateCompleted)
```

## Examples

See the [examples](./examples) directory for 22 complete examples:

| # | Example | Description |
|---|---------|-------------|
| 01 | basic | Push, pull, ack |
| 02 | worker | Concurrent processing |
| 03 | priority | Job priorities |
| 04 | delayed | Scheduled jobs |
| 05 | batch | High-throughput batching |
| 06 | retry | Error handling, DLQ |
| 07 | progress | Progress tracking |
| 08 | cron | Scheduled recurring jobs |
| 09 | rate_limit | API rate limiting |
| 10 | queue_api | BullMQ-compatible API |
| 11 | unique | Job deduplication |
| 12 | finished | Wait for completion |
| 13 | job_options | All push options |
| 14 | events | Worker events |
| 15 | queue_control | Pause, resume, drain |
| 16 | concurrency | Parallel processing |
| 17 | benchmark | Performance testing |
| 18 | flow | Parent/child workflows |
| 19 | ai_workflow | AI agent pipeline |
| 20 | batch_inference | ML batch processing |
| 21 | rag_pipeline | RAG implementation |
| 22 | groups | FIFO group processing |

### Running Examples

```bash
# Start flashQ server
cargo run --release

# Run an example
cd sdk/go/examples/01_basic
go run main.go
```

## Configuration

### Client Options

```go
opts := flashq.ClientOptions{
    Host:               "localhost",
    Port:               6789,
    HTTPPort:           6790,
    Timeout:            5 * time.Second,
    ConnectTimeout:     5 * time.Second,
    Token:              "secret",       // Auth token
    UseHTTP:            false,          // Use HTTP instead of TCP
    UseBinary:          false,          // Use MessagePack
    AutoReconnect:      true,
    ReconnectDelay:     1 * time.Second,
    MaxReconnectDelay:  30 * time.Second,
    MaxReconnectAttempts: 10,
    LogLevel:           flashq.LogLevelInfo,
}

client := flashq.NewWithOptions(opts)
```

### Worker Options

```go
opts := flashq.WorkerOptions{
    Concurrency:  5,                // Parallel jobs
    BatchSize:    100,              // Jobs per batch pull
    AutoStart:    true,             // Start on creation
    CloseTimeout: 30 * time.Second, // Graceful shutdown
    StallTimeout: 30 * time.Second, // Stall detection
    LogLevel:     flashq.LogLevelInfo,
}
```

## Error Handling

```go
import "errors"

job, err := client.GetJob(jobID)
if err != nil {
    var notFound *flashq.JobNotFoundError
    if errors.As(err, &notFound) {
        fmt.Printf("Job %d not found\n", notFound.JobID)
    }

    var connErr *flashq.ConnectionError
    if errors.As(err, &connErr) {
        fmt.Printf("Connection error: %v\n", connErr)
    }
}
```

## License

MIT
