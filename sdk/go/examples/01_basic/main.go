// Example 01: Basic Operations - Push, Pull, Ack
//
// Demonstrates fundamental queue operations:
// - Connecting to flashQ server
// - Pushing a job to a queue
// - Pulling a job from the queue
// - Acknowledging job completion
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

	// Create client with default options
	client := flashq.New()

	// Connect to server
	if err := client.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer client.Close()

	fmt.Println("Connected to flashQ server")

	// Push a job
	jobID, err := client.Push("emails", map[string]interface{}{
		"to":      "user@example.com",
		"subject": "Welcome!",
		"body":    "Hello from flashQ",
	}, nil)
	if err != nil {
		log.Fatalf("Failed to push job: %v", err)
	}
	fmt.Printf("Pushed job: %d\n", jobID)

	// Pull the job (blocking)
	job, err := client.Pull("emails", 5*time.Second)
	if err != nil {
		log.Fatalf("Failed to pull job: %v", err)
	}
	if job == nil {
		log.Fatal("No job received")
	}
	fmt.Printf("Pulled job %d: %v\n", job.ID, job.Data)

	// Process the job (simulate work)
	fmt.Println("Processing email...")
	time.Sleep(100 * time.Millisecond)

	// Acknowledge completion with result
	success, err := client.Ack(job.ID, map[string]interface{}{
		"sent":   true,
		"sentAt": time.Now().Unix(),
	})
	if err != nil {
		log.Fatalf("Failed to ack job: %v", err)
	}
	fmt.Printf("Acknowledged job: %v\n", success)

	// Get the result
	result, err := client.GetResult(job.ID)
	if err != nil {
		log.Fatalf("Failed to get result: %v", err)
	}
	fmt.Printf("Job result: %v\n", result)

	fmt.Println("\nDone!")
}
