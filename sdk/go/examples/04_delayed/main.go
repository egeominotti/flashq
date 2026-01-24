// Example 04: Delayed Jobs - Schedule for Future Execution
//
// Demonstrates delayed jobs:
// - Jobs can be scheduled for future execution
// - Delay is specified in milliseconds
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

	client := flashq.New()
	if err := client.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer client.Close()

	// Clean up first
	client.Obliterate("delayed-demo")

	fmt.Println("=== Delayed Jobs Example ===\n")

	// Push a delayed job (2 seconds delay)
	opts := &flashq.PushOptions{
		Delay: 2 * time.Second,
	}

	now := time.Now()
	jobID, err := client.Push("delayed-demo", map[string]interface{}{
		"message":    "This job was delayed",
		"scheduledAt": now.Unix(),
	}, opts)
	if err != nil {
		log.Fatalf("Failed to push job: %v", err)
	}

	fmt.Printf("Pushed delayed job %d at %s\n", jobID, now.Format("15:04:05"))
	fmt.Printf("Job will be available in 2 seconds...\n\n")

	// Check job state
	job, err := client.GetJob(jobID)
	if err != nil {
		log.Fatalf("Failed to get job: %v", err)
	}
	fmt.Printf("Initial state: %s\n", job.State)

	// Try to pull immediately - should timeout
	fmt.Println("\nTrying to pull immediately...")
	quickJob, _ := client.Pull("delayed-demo", 500*time.Millisecond)
	if quickJob == nil {
		fmt.Println("No job available yet (expected)")
	}

	// Wait for delay
	fmt.Println("\nWaiting for delay to expire...")
	time.Sleep(2 * time.Second)

	// Now pull should work
	fmt.Println("\nTrying to pull after delay...")
	delayedJob, err := client.Pull("delayed-demo", 5*time.Second)
	if err != nil {
		log.Fatalf("Failed to pull job: %v", err)
	}

	if delayedJob != nil {
		receivedAt := time.Now()
		fmt.Printf("Received job %d at %s\n", delayedJob.ID, receivedAt.Format("15:04:05"))
		fmt.Printf("Total delay: %v\n", receivedAt.Sub(now))

		client.Ack(delayedJob.ID, nil)
	}

	fmt.Println("\nDone!")
}
