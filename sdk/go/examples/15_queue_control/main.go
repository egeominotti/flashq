// Example 15: Queue Control - Pause, Resume, Drain
//
// Demonstrates queue management:
// - Pause and resume queues
// - Drain (remove all waiting jobs)
// - Obliterate (remove all queue data)
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

	queue := flashq.NewQueue("controlled", nil)
	if err := queue.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer queue.Close()

	// Clean up first
	queue.Obliterate(false)

	fmt.Println("=== Queue Control Example ===\n")

	// Add jobs
	fmt.Println("Adding 5 jobs...")
	for i := 1; i <= 5; i++ {
		queue.Add("task", map[string]interface{}{"i": i}, nil)
	}

	// Check initial count
	count, _ := queue.GetWaitingCount()
	fmt.Printf("Waiting jobs: %d\n\n", count)

	// Pause queue
	fmt.Println("--- Pausing queue ---")
	if err := queue.Pause(); err != nil {
		log.Fatalf("Failed to pause: %v", err)
	}

	paused, _ := queue.IsPaused()
	fmt.Printf("Queue paused: %v\n\n", paused)

	// Try to pull while paused
	fmt.Println("Trying to pull while paused...")
	job, _ := queue.Client().Pull("controlled", 1*time.Second)
	if job == nil {
		fmt.Println("No job received (expected - queue is paused)\n")
	}

	// Resume queue
	fmt.Println("--- Resuming queue ---")
	if err := queue.Resume(); err != nil {
		log.Fatalf("Failed to resume: %v", err)
	}

	paused, _ = queue.IsPaused()
	fmt.Printf("Queue paused: %v\n\n", paused)

	// Now pull should work
	fmt.Println("Pulling after resume...")
	job, _ = queue.Client().Pull("controlled", 1*time.Second)
	if job != nil {
		fmt.Printf("Got job %d\n", job.ID)
		queue.Client().Ack(job.ID, nil)
	}

	// Check count
	count, _ = queue.GetWaitingCount()
	fmt.Printf("Remaining waiting jobs: %d\n\n", count)

	// Drain remaining jobs
	fmt.Println("--- Draining queue ---")
	if err := queue.Drain(); err != nil {
		log.Fatalf("Failed to drain: %v", err)
	}

	count, _ = queue.GetWaitingCount()
	fmt.Printf("After drain - waiting jobs: %d\n\n", count)

	// Add more jobs for obliterate demo
	fmt.Println("Adding more jobs for obliterate demo...")
	for i := 1; i <= 3; i++ {
		queue.Add("task", map[string]interface{}{"i": i}, nil)
	}

	counts, _ := queue.GetJobCounts()
	fmt.Printf("Job counts: %v\n\n", counts)

	// Obliterate
	fmt.Println("--- Obliterating queue ---")
	if err := queue.Obliterate(false); err != nil {
		log.Fatalf("Failed to obliterate: %v", err)
	}

	counts, _ = queue.GetJobCounts()
	fmt.Printf("After obliterate - job counts: %v\n", counts)

	fmt.Println("\nDone!")
}
