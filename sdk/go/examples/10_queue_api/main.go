// Example 10: Queue API - BullMQ-Compatible Interface
//
// Demonstrates the Queue class:
// - BullMQ-compatible API for easy migration
// - Simplified interface for common operations
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

	// Create queue
	queue := flashq.NewQueue("email-queue", nil)

	if err := queue.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer queue.Close()

	// Clean up first
	queue.Obliterate(false)

	fmt.Println("=== Queue API (BullMQ-Compatible) Example ===")

	// Add a single job
	job, err := queue.Add("send-welcome", map[string]interface{}{
		"to":      "newuser@example.com",
		"type":    "welcome",
	}, nil)
	if err != nil {
		log.Fatalf("Failed to add job: %v", err)
	}
	fmt.Printf("Added job: %d (tags: %v)\n", job.ID, job.Tags)

	// Add with options
	opts := &flashq.PushOptions{
		Priority: 10,
		Delay:    0,
	}
	job2, err := queue.Add("send-notification", map[string]interface{}{
		"to":      "vip@example.com",
		"type":    "alert",
	}, opts)
	if err != nil {
		log.Fatalf("Failed to add job: %v", err)
	}
	fmt.Printf("Added priority job: %d\n", job2.ID)

	// Get job counts
	fmt.Println("\n--- Job Counts ---")
	counts, err := queue.GetJobCounts()
	if err != nil {
		log.Fatalf("Failed to get counts: %v", err)
	}
	for state, count := range counts {
		fmt.Printf("  %s: %d\n", state, count)
	}

	// Get specific counts
	waiting, _ := queue.GetWaitingCount()
	fmt.Printf("\nWaiting jobs: %d\n", waiting)

	// Get jobs by state
	fmt.Println("\n--- Waiting Jobs ---")
	jobs, err := queue.GetJobs([]flashq.JobState{flashq.JobStateWaiting}, 0, 10)
	if err != nil {
		log.Fatalf("Failed to get jobs: %v", err)
	}
	for _, j := range jobs {
		fmt.Printf("  Job %d: %v\n", j.ID, j.Data)
	}

	// Process jobs using underlying client
	fmt.Println("\n--- Processing Jobs ---")
	client := queue.Client()
	for {
		j, _ := client.Pull(queue.Name(), 1*time.Second)
		if j == nil {
			break
		}
		fmt.Printf("Processing job %d...\n", j.ID)
		client.Ack(j.ID, map[string]interface{}{"sent": true})
	}

	// Get updated counts
	fmt.Println("\n--- Updated Counts ---")
	counts, _ = queue.GetJobCounts()
	for state, count := range counts {
		if count > 0 {
			fmt.Printf("  %s: %d\n", state, count)
		}
	}

	// Total count
	total, _ := queue.Count()
	fmt.Printf("\nTotal (waiting + delayed): %d\n", total)

	fmt.Println("\nDone!")
}
