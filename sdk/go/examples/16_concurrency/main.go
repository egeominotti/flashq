// Example 16: Concurrency - Parallel Job Processing
//
// Demonstrates:
// - Server-side concurrency limits
// - Worker concurrency settings
// - Measuring parallel execution
package main

import (
	"context"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/flashq/flashq-go/flashq"
)

var (
	active    int64
	maxActive int64
)

func main() {
	ctx := context.Background()

	// Setup
	client := flashq.New()
	client.Connect(ctx)
	client.Obliterate("parallel")
	client.Close()

	fmt.Println("=== Concurrency Example ===\n")

	// Push 10 jobs
	pushClient := flashq.New()
	pushClient.Connect(ctx)

	fmt.Println("Pushing 10 jobs...")
	for i := 1; i <= 10; i++ {
		pushClient.Push("parallel", map[string]interface{}{
			"id": i,
		}, nil)
	}
	pushClient.Close()

	// Create processor that tracks concurrency
	processor := func(job *flashq.Job) (interface{}, error) {
		current := atomic.AddInt64(&active, 1)

		// Track max
		for {
			max := atomic.LoadInt64(&maxActive)
			if current <= max || atomic.CompareAndSwapInt64(&maxActive, max, current) {
				break
			}
		}

		data := job.Data.(map[string]interface{})
		fmt.Printf("Start job %v (active: %d)\n", data["id"], current)

		// Simulate work
		time.Sleep(500 * time.Millisecond)

		atomic.AddInt64(&active, -1)
		fmt.Printf("Done job %v (active: %d)\n", data["id"], atomic.LoadInt64(&active))

		return map[string]interface{}{"done": true}, nil
	}

	// Create worker with concurrency 3
	workerOpts := flashq.DefaultWorkerOptions()
	workerOpts.Concurrency = 3
	workerOpts.AutoStart = false
	workerOpts.BatchSize = 10

	worker := flashq.NewWorkerSingle("parallel", processor, nil, &workerOpts)

	// Start worker
	fmt.Println("\nStarting worker with concurrency=3\n")
	worker.Start(ctx)

	// Wait for completion
	time.Sleep(4 * time.Second)

	worker.Stop(ctx)

	fmt.Printf("\n=== Results ===\n")
	fmt.Printf("Max concurrent jobs: %d\n", atomic.LoadInt64(&maxActive))
	fmt.Printf("Processed: %d\n", worker.Processed())

	// Now test server-side concurrency limit
	fmt.Println("\n=== Server-Side Concurrency Limit ===\n")

	atomic.StoreInt64(&active, 0)
	atomic.StoreInt64(&maxActive, 0)

	setupClient := flashq.New()
	setupClient.Connect(ctx)
	setupClient.Obliterate("parallel")

	// Set server concurrency limit
	setupClient.SetConcurrency("parallel", 2)
	fmt.Println("Set server concurrency limit to 2")

	// Push more jobs
	for i := 1; i <= 10; i++ {
		setupClient.Push("parallel", map[string]interface{}{"id": i}, nil)
	}
	setupClient.Close()

	// Create worker with higher concurrency (should be limited by server)
	workerOpts2 := flashq.DefaultWorkerOptions()
	workerOpts2.Concurrency = 5 // Higher than server limit
	workerOpts2.AutoStart = false
	workerOpts2.BatchSize = 10

	worker2 := flashq.NewWorkerSingle("parallel", processor, nil, &workerOpts2)

	fmt.Println("Starting worker with concurrency=5 (server limit=2)\n")
	worker2.Start(ctx)

	time.Sleep(6 * time.Second)

	worker2.Stop(ctx)

	fmt.Printf("\n=== Results ===\n")
	fmt.Printf("Max concurrent jobs: %d (limited by server)\n", atomic.LoadInt64(&maxActive))
	fmt.Printf("Processed: %d\n", worker2.Processed())

	// Clear concurrency limit
	clearClient := flashq.New()
	clearClient.Connect(ctx)
	clearClient.ClearConcurrency("parallel")
	clearClient.Close()
}
