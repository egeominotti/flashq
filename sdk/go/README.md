# FlashQ Go SDK

High-performance job queue client for Go.

## Installation

```bash
go get github.com/flashq/flashq-go
```

## Quick Start

```go
package main

import (
    "fmt"
    "log"

    "github.com/flashq/flashq-go/flashq"
)

func main() {
    client := flashq.New()
    defer client.Close()

    if err := client.Connect(); err != nil {
        log.Fatal(err)
    }

    // Push a job
    job, err := client.Push("emails", map[string]string{
        "to":      "user@example.com",
        "subject": "Hello!",
    }, nil)
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Created job %d\n", job.ID)

    // Get stats
    stats, _ := client.Stats()
    fmt.Printf("Queued: %d\n", stats.Queued)
}
```

## Features

### Push Jobs

```go
import "github.com/flashq/flashq-go/flashq"

client := flashq.New()
client.Connect()

// Simple push
job, _ := client.Push("queue", map[string]string{"data": "value"}, nil)

// With options
job, _ := client.Push("queue", data, &flashq.PushOptions{
    Priority:    10,         // Higher = processed first
    Delay:       5000,       // Delay in ms
    TTL:         3600000,    // Time-to-live
    Timeout:     30000,      // Processing timeout
    MaxAttempts: 3,          // Retry attempts
    Backoff:     1000,       // Backoff base (exponential)
    UniqueKey:   "key123",   // Deduplication
    DependsOn:   []int64{1}, // Job dependencies
    Tags:        []string{"important"},
})

// Batch push
ids, _ := client.PushBatch("queue", []map[string]interface{}{
    {"data": map[string]int{"task": 1}},
    {"data": map[string]int{"task": 2}, "priority": 5},
})
```

### Pull & Process Jobs

```go
// Pull single job (blocking)
job, _ := client.Pull("queue")

// Get job data
var data MyStruct
job.GetData(&data)

// Pull batch
jobs, _ := client.PullBatch("queue", 10)

// Acknowledge completion
client.Ack(job.ID, map[string]bool{"success": true})

// Acknowledge batch
ids := make([]int64, len(jobs))
for i, j := range jobs {
    ids[i] = j.ID
}
client.AckBatch(ids)

// Fail job (will retry or go to DLQ)
client.Fail(job.ID, "Something went wrong")
```

### Job Progress

```go
// Update progress
client.Progress(jobID, 50, "Halfway done")

// Get progress
prog, _ := client.GetProgress(jobID)
fmt.Printf("Progress: %d%% - %s\n", prog.Progress, prog.Message)
```

### Queue Control

```go
// Pause/Resume
client.Pause("queue")
client.Resume("queue")

// Rate limiting (jobs per second)
client.SetRateLimit("queue", 100)
client.ClearRateLimit("queue")

// Concurrency limiting
client.SetConcurrency("queue", 5)
client.ClearConcurrency("queue")

// List queues
queues, _ := client.ListQueues()
for _, q := range queues {
    fmt.Printf("%s: %d pending\n", q.Name, q.Pending)
}
```

### Dead Letter Queue

```go
// Get failed jobs
failed, _ := client.GetDLQ("queue", 100)

// Retry all DLQ jobs
count, _ := client.RetryDLQ("queue", nil)

// Retry specific job
jobID := int64(123)
client.RetryDLQ("queue", &jobID)
```

### Cron Jobs

```go
// Add cron job (runs every minute)
client.AddCron("cleanup", flashq.CronOptions{
    Queue:    "maintenance",
    Data:     map[string]string{"task": "cleanup"},
    Schedule: "0 * * * * *",  // sec min hour day month weekday
    Priority: 5,
})

// List cron jobs
crons, _ := client.ListCrons()

// Delete cron job
client.DeleteCron("cleanup")
```

### Metrics

```go
// Basic stats
stats, _ := client.Stats()
fmt.Printf("Queued: %d\n", stats.Queued)
fmt.Printf("Processing: %d\n", stats.Processing)
fmt.Printf("Delayed: %d\n", stats.Delayed)
fmt.Printf("DLQ: %d\n", stats.DLQ)

// Detailed metrics
metrics, _ := client.Metrics()
fmt.Printf("Total pushed: %d\n", metrics.TotalPushed)
fmt.Printf("Jobs/sec: %.2f\n", metrics.JobsPerSecond)
fmt.Printf("Avg latency: %.2fms\n", metrics.AvgLatencyMs)
```

## Connection Options

```go
// Default connection
client := flashq.New()

// Custom options
client := flashq.NewWithOptions(flashq.ClientOptions{
    Host:    "localhost",
    Port:    6789,
    Token:   "secret",  // Authentication
    Timeout: 5 * time.Second,
})
```

## Worker Example

```go
package main

import (
    "fmt"
    "log"

    "github.com/flashq/flashq-go/flashq"
)

func main() {
    client := flashq.New()
    defer client.Close()

    if err := client.Connect(); err != nil {
        log.Fatal(err)
    }

    fmt.Println("Worker started...")

    for {
        job, err := client.Pull("emails")
        if err != nil {
            log.Printf("Pull error: %v", err)
            continue
        }

        fmt.Printf("Processing job %d\n", job.ID)

        // Update progress
        client.Progress(job.ID, 50, "Sending email...")

        // Do work
        var data map[string]string
        job.GetData(&data)
        // sendEmail(data)

        // Complete
        if err := client.Ack(job.ID, map[string]bool{"sent": true}); err != nil {
            client.Fail(job.ID, err.Error())
        }
    }
}
```

## Running Tests

```bash
# Run unit tests
go test ./flashq/...

# Run API tests
go run examples/test_all_apis/main.go
```

## License

MIT
