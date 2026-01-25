# flashQ Go SDK

[![Go Reference](https://pkg.go.dev/badge/github.com/flashq/flashq-go.svg)](https://pkg.go.dev/github.com/flashq/flashq-go)
[![Go Report Card](https://goreportcard.com/badge/github.com/flashq/flashq-go)](https://goreportcard.com/report/github.com/flashq/flashq-go)
[![GitHub stars](https://img.shields.io/github/stars/egeominotti/flashq)](https://github.com/egeominotti/flashq)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**[Website](https://flashq.dev)** · **[Documentation](https://flashq.dev/docs/)** · **[GitHub](https://github.com/egeominotti/flashq)**

> **High-performance job queue client for Go. No Redis required.**

flashQ Go SDK provides a fast, type-safe client for the flashQ job queue server. Built for high-throughput workloads with connection pooling, batch operations, and worker support.

## Features

- **Connection Pooling** - Built-in pool with automatic reconnection
- **Batch Operations** - Push/Pull/Ack up to 1000 jobs at once
- **Worker Support** - High-performance concurrent job processing
- **Type-Safe** - Full Go idioms with proper error handling
- **AI/ML Ready** - 10MB payloads, job dependencies, progress tracking

## Installation

```bash
go get github.com/flashq/flashq-go
```

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

```go
package main

import (
    "context"
    "fmt"
    "log"
    "time"

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
        "to":      "user@example.com",
        "subject": "Welcome!",
    }, nil)
    fmt.Printf("Pushed job: %d\n", jobID)

    // Process with worker
    worker := flashq.NewWorkerSingle("emails", func(job *flashq.Job) (interface{}, error) {
        fmt.Printf("Sending email to %v\n", job.Data)
        return map[string]interface{}{"sent": true}, nil
    }, nil, &flashq.WorkerOptions{Concurrency: 10})

    worker.On("completed", func(job *flashq.Job, result interface{}, workerID int) {
        fmt.Printf("Job %d completed\n", job.ID)
    })

    worker.Start(ctx)
}
```

## API Reference

### Queue

```go
import "github.com/flashq/flashq-go/flashq"

queue := flashq.NewQueue("my-queue", nil)
queue.Connect(ctx)

// Add a single job
job, err := queue.Add("job-name", map[string]interface{}{"data": "value"}, &flashq.PushOptions{
    Priority:    10,              // Higher = processed first
    Delay:       5 * time.Second, // Delay before processing
    MaxAttempts: 3,               // Max retry attempts
    Backoff:     time.Second,     // Exponential backoff base
    Timeout:     30 * time.Second,// Processing timeout
    JobID:       "unique-id",     // Custom ID for idempotency
    DependsOn:   []int64{1, 2},   // Wait for these jobs to complete
})

// Add multiple jobs
queue.AddBulk([]map[string]interface{}{
    {"name": "task", "data": map[string]interface{}{"id": 1}},
    {"name": "task", "data": map[string]interface{}{"id": 2}, "priority": 10},
})

// Wait for job completion
result, err := queue.Finished(job.ID, 30*time.Second)

// Queue control
queue.Pause()
queue.Resume()
queue.Drain()       // Remove all waiting jobs
queue.Obliterate()  // Remove ALL queue data

// Cleanup
queue.Close()
```

### Worker

```go
import "github.com/flashq/flashq-go/flashq"

worker := flashq.NewWorkerSingle("my-queue", func(job *flashq.Job) (interface{}, error) {
    // Process job
    fmt.Printf("Processing: %d - %v\n", job.ID, job.Data)

    // Return result (auto-acknowledged)
    return map[string]interface{}{"processed": true}, nil
}, nil, &flashq.WorkerOptions{
    Concurrency:  10,               // Parallel job processing
    BatchSize:    100,              // Jobs per batch pull
    AutoStart:    true,             // Start automatically
    CloseTimeout: 30 * time.Second, // Graceful shutdown timeout
})

// Events
worker.On("ready", func() { fmt.Println("Worker ready") })
worker.On("active", func(job *flashq.Job, workerID int) {
    fmt.Printf("Job started: %d\n", job.ID)
})
worker.On("completed", func(job *flashq.Job, result interface{}, workerID int) {
    fmt.Printf("Job done: %v\n", result)
})
worker.On("failed", func(job *flashq.Job, err error, workerID int) {
    fmt.Printf("Job failed: %v\n", err)
})
worker.On("stopping", func() { fmt.Println("Worker stopping...") })
worker.On("stopped", func() { fmt.Println("Worker stopped") })

// Graceful shutdown
worker.Stop(ctx)        // Wait for current jobs
worker.ForceStop()      // Force close immediately
```

### Low-Level Client

For advanced use cases, use the `Client` directly:

```go
import "github.com/flashq/flashq-go/flashq"

client := flashq.NewWithOptions(flashq.ClientOptions{
    Host:     "localhost",
    Port:     6789,
    Timeout:  5 * time.Second,
    PoolSize: 4,
})

client.Connect(ctx)

// Push/Pull operations
jobID, _ := client.Push("queue", map[string]interface{}{"data": "value"}, nil)
job, _ := client.Pull("queue", 5*time.Second)
client.Ack(job.ID, map[string]interface{}{"result": "done"})

// Job management
state, _ := client.GetState(jobID)
counts, _ := client.GetJobCounts("queue")
client.Cancel(jobID)

// Cron jobs
client.AddCron("daily-cleanup", "maintenance", "0 0 * * *",
    map[string]interface{}{"task": "cleanup"}, nil)

client.Close()
```

## Error Handling

flashQ provides typed error types for precise error handling:

```go
import (
    "errors"
    "github.com/flashq/flashq-go/flashq"
)

job, err := client.GetJob(jobID)
if err != nil {
    var connErr *flashq.ConnectionError
    var notFound *flashq.JobNotFoundError
    var validation *flashq.ValidationError
    var timeout *flashq.TimeoutError

    switch {
    case errors.As(err, &connErr):
        fmt.Println("Connection failed, retrying...")
    case errors.As(err, &notFound):
        fmt.Printf("Job %d not found\n", notFound.JobID)
    case errors.As(err, &validation):
        fmt.Printf("Invalid input: %s\n", validation.Message)
    case errors.As(err, &timeout):
        fmt.Printf("Timeout after %v\n", timeout.Timeout)
    }
}
```

## Push Options

```go
opts := &flashq.PushOptions{
    Priority:           10,                    // Higher = processed first
    Delay:              5 * time.Second,       // Delay in duration
    TTL:                time.Hour,             // Time-to-live
    Timeout:            30 * time.Second,      // Processing timeout
    MaxAttempts:        3,                     // Retry attempts
    Backoff:            time.Second,           // Exponential backoff base
    UniqueKey:          "user:123",            // Deduplication key
    DependsOn:          []int64{1, 2},         // Job dependencies
    Tags:               []string{"urgent"},    // Job tags
    LIFO:               false,                 // Last-In-First-Out mode
    StallTimeout:       time.Minute,           // Stall detection
    DebounceID:         "event",               // Debounce ID
    DebounceTTL:        500 * time.Millisecond,// Debounce window
    // BullMQ-like options
    JobID:              "order-123",           // Custom job ID for idempotency
    KeepCompletedAge:   24 * time.Hour,        // Keep result for 24h
    KeepCompletedCount: 100,                   // Keep in last 100 completed
    GroupID:            "customer-A",          // FIFO within group
}
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

## Configuration

### Client Options

```go
type ClientOptions struct {
    Host                 string        // Default: "localhost"
    Port                 int           // Default: 6789
    HTTPPort             int           // Default: 6790
    Timeout              time.Duration // Default: 5s
    ConnectTimeout       time.Duration // Default: 5s
    Token                string        // Auth token
    UseHTTP              bool          // Use HTTP instead of TCP
    UseBinary            bool          // Use MessagePack (40% smaller)
    AutoReconnect        bool          // Default: true
    ReconnectDelay       time.Duration // Default: 1s
    MaxReconnectDelay    time.Duration // Default: 30s
    MaxReconnectAttempts int           // Default: 10
    LogLevel             LogLevel      // Default: LogLevelInfo
    PoolSize             int           // Default: 4
}
```

### Worker Options

```go
type WorkerOptions struct {
    Concurrency  int           // Parallel jobs (default: 1)
    BatchSize    int           // Jobs per batch pull (default: 100)
    AutoStart    bool          // Auto-start (default: true)
    CloseTimeout time.Duration // Graceful shutdown timeout (default: 30s)
    StallTimeout time.Duration // Stall detection (default: 30s)
    LogLevel     LogLevel      // Logging level
}
```

## Examples

Run examples with:

```bash
cd examples/01_basic && go run main.go
```

| Example | Description |
|---------|-------------|
| `01_basic` | Push, Pull, Ack basics |
| `02_worker` | Concurrent processing |
| `03_priority` | Priority ordering |
| `04_delayed` | Scheduled jobs |
| `05_batch` | High-throughput batching |
| `06_retry` | Error handling, DLQ |
| `07_progress` | Progress tracking |
| `08_cron` | Scheduled recurring jobs |
| `09_rate_limit` | Rate limiting |
| `10_queue_api` | BullMQ-compatible API |
| `11_unique` | Job deduplication |
| `12_finished` | Wait for completion |
| `17_benchmark` | Performance testing |
| `18_flow` | Parent/child workflows |
| `19_ai_workflow` | AI agent pipeline |
| `20_batch_inference` | ML batch processing |
| `21_rag_pipeline` | RAG implementation |

## AI/ML Workloads

flashQ is designed for AI pipelines with large payloads and complex workflows:

```go
// AI Agent with job dependencies
client := flashq.New()
client.Connect(ctx)

// Step 1: Parse user intent
parseID, _ := client.Push("ai-agent", map[string]interface{}{
    "step": "parse", "prompt": userInput,
}, nil)

// Step 2: Retrieve context (waits for step 1)
retrieveID, _ := client.Push("ai-agent", map[string]interface{}{
    "step": "retrieve", "query": query,
}, &flashq.PushOptions{DependsOn: []int64{parseID}})

// Step 3: Generate response (waits for step 2)
generateID, _ := client.Push("ai-agent", map[string]interface{}{
    "step": "generate", "context": context,
}, &flashq.PushOptions{DependsOn: []int64{retrieveID}, Priority: 10})

// Wait for the final result
result, _ := client.Finished(generateID, time.Minute)
```

## Resources

- **Website:** [flashq.dev](https://flashq.dev)
- **Documentation:** [flashq.dev/docs](https://flashq.dev/docs/)
- **GitHub:** [github.com/egeominotti/flashq](https://github.com/egeominotti/flashq)
- **Go Package:** [pkg.go.dev/github.com/flashq/flashq-go](https://pkg.go.dev/github.com/flashq/flashq-go)

## License

MIT
