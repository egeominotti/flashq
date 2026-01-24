// Example 02: Worker - Concurrent Job Processing
//
// Demonstrates the Worker class:
// - Creating a worker with a processor function
// - Processing jobs concurrently
// - Handling worker events
// - Graceful shutdown
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/flashq/flashq-go/flashq"
)

func main() {
	ctx := context.Background()

	// First, push some jobs
	client := flashq.New()
	if err := client.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}

	fmt.Println("Pushing 5 jobs...")
	for i := 1; i <= 5; i++ {
		jobID, err := client.Push("tasks", map[string]interface{}{
			"task": fmt.Sprintf("Task %d", i),
			"num":  i,
		}, nil)
		if err != nil {
			log.Fatalf("Failed to push job: %v", err)
		}
		fmt.Printf("  Pushed job %d\n", jobID)
	}
	client.Close()

	// Create processor function
	processor := func(job *flashq.Job) (interface{}, error) {
		data := job.Data.(map[string]interface{})
		fmt.Printf("Processing: %v\n", data["task"])

		// Simulate work
		time.Sleep(200 * time.Millisecond)

		return map[string]interface{}{
			"processed": true,
			"timestamp": time.Now().Unix(),
		}, nil
	}

	// Create worker with concurrency 3
	workerOpts := flashq.DefaultWorkerOptions()
	workerOpts.Concurrency = 3
	workerOpts.AutoStart = false

	worker := flashq.NewWorkerSingle("tasks", processor, nil, &workerOpts)

	// Register event handlers
	worker.On("ready", func() {
		fmt.Println("\n[Event] Worker ready")
	})

	worker.On("active", func(job *flashq.Job) {
		fmt.Printf("[Event] Job %d started\n", job.ID)
	})

	worker.On("completed", func(job *flashq.Job, result interface{}) {
		fmt.Printf("[Event] Job %d completed: %v\n", job.ID, result)
	})

	worker.On("failed", func(job *flashq.Job, err error) {
		fmt.Printf("[Event] Job %d failed: %v\n", job.ID, err)
	})

	worker.On("stopped", func() {
		fmt.Println("[Event] Worker stopped")
	})

	// Start worker
	if err := worker.Start(ctx); err != nil {
		log.Fatalf("Failed to start worker: %v", err)
	}

	// Wait for signal or all jobs processed
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Give time for processing
	go func() {
		time.Sleep(3 * time.Second)
		sigChan <- syscall.SIGTERM
	}()

	<-sigChan

	// Graceful shutdown
	fmt.Println("\nShutting down...")
	if err := worker.Stop(ctx); err != nil {
		log.Printf("Error stopping worker: %v", err)
	}

	fmt.Printf("\nStats: Processed=%d, Failed=%d\n", worker.Processed(), worker.Failed())
}
