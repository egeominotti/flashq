// Example 14: Worker Events
//
// Demonstrates all worker event handlers:
// - ready, active, completed, failed
// - error, stopping, stopped
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/flashq/flashq-go/flashq"
)

func main() {
	ctx := context.Background()

	// Setup
	setup := flashq.New()
	setup.Connect(ctx)
	setup.Obliterate("events-demo")
	setup.Close()

	fmt.Println("=== Worker Events Example ===\n")

	// Push test jobs
	client := flashq.New()
	client.Connect(ctx)

	fmt.Println("Pushing jobs (including one that will fail)...")
	for i := 1; i <= 5; i++ {
		client.Push("events-demo", map[string]interface{}{
			"task":       fmt.Sprintf("Task %d", i),
			"shouldFail": i == 3, // Third job will fail
		}, nil)
	}
	client.Close()

	// Create processor
	processor := func(job *flashq.Job) (interface{}, error) {
		data := job.Data.(map[string]interface{})

		// Simulate work
		time.Sleep(200 * time.Millisecond)

		// Fail specific job
		if shouldFail, ok := data["shouldFail"].(bool); ok && shouldFail {
			return nil, errors.New("intentional failure for demo")
		}

		return map[string]interface{}{
			"processed": true,
			"task":      data["task"],
		}, nil
	}

	// Create worker
	workerOpts := flashq.DefaultWorkerOptions()
	workerOpts.Concurrency = 2
	workerOpts.AutoStart = false

	worker := flashq.NewWorkerSingle("events-demo", processor, nil, &workerOpts)

	// Register ALL event handlers
	worker.On("ready", func() {
		fmt.Println("\n[EVENT: ready] Worker is ready to process jobs")
	})

	worker.On("active", func(job *flashq.Job) {
		data := job.Data.(map[string]interface{})
		fmt.Printf("[EVENT: active] Job %d started: %v\n", job.ID, data["task"])
	})

	worker.On("completed", func(job *flashq.Job, result interface{}) {
		fmt.Printf("[EVENT: completed] Job %d finished: %v\n", job.ID, result)
	})

	worker.On("failed", func(job *flashq.Job, err error) {
		fmt.Printf("[EVENT: failed] Job %d failed: %v\n", job.ID, err)
	})

	worker.On("error", func(err error) {
		fmt.Printf("[EVENT: error] Worker error: %v\n", err)
	})

	worker.On("stopping", func() {
		fmt.Println("\n[EVENT: stopping] Worker is stopping...")
	})

	worker.On("stopped", func() {
		fmt.Println("[EVENT: stopped] Worker has stopped")
	})

	// Start worker
	fmt.Println("Starting worker...")
	if err := worker.Start(ctx); err != nil {
		log.Fatalf("Failed to start worker: %v", err)
	}

	// Wait for jobs to process
	time.Sleep(3 * time.Second)

	// Stop worker
	fmt.Println("\nStopping worker...")
	worker.Stop(ctx)

	// Final stats
	fmt.Printf("\n=== Final Stats ===\n")
	fmt.Printf("Processed: %d\n", worker.Processed())
	fmt.Printf("Failed: %d\n", worker.Failed())
	fmt.Printf("State: %s\n", worker.State())
}
