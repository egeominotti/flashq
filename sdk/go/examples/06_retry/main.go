// Example 06: Retry and DLQ - Error Handling
//
// Demonstrates retry mechanism and Dead Letter Queue:
// - Jobs that fail are automatically retried
// - After max attempts, jobs go to DLQ
// - DLQ jobs can be inspected and retried
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
	client.Obliterate("retry-demo")

	fmt.Println("=== Retry and DLQ Example ===\n")

	// Push a job with max 3 attempts and short backoff
	opts := &flashq.PushOptions{
		MaxAttempts: 3,
		Backoff:     100 * time.Millisecond, // Short backoff for demo
	}

	jobID, err := client.Push("retry-demo", map[string]interface{}{
		"task": "Flaky operation",
	}, opts)
	if err != nil {
		log.Fatalf("Failed to push job: %v", err)
	}
	fmt.Printf("Pushed job %d with max_attempts=3\n\n", jobID)

	// Simulate failing the job multiple times
	for attempt := 1; attempt <= 4; attempt++ {
		job, err := client.Pull("retry-demo", 2*time.Second)
		if err != nil {
			log.Fatalf("Failed to pull job: %v", err)
		}

		if job == nil {
			fmt.Printf("Attempt %d: No job available (might be in DLQ)\n", attempt)
			break
		}

		fmt.Printf("Attempt %d: Got job %d (attempts=%d)\n", attempt, job.ID, job.Attempts)

		// Fail the job
		_, err = client.Fail(job.ID, fmt.Sprintf("Simulated failure on attempt %d", attempt))
		if err != nil {
			log.Fatalf("Failed to fail job: %v", err)
		}
		fmt.Printf("  Failed job %d\n", job.ID)

		// Wait for backoff
		time.Sleep(200 * time.Millisecond)
	}

	// Check DLQ
	fmt.Println("\n--- Checking DLQ ---")
	dlqJobs, err := client.GetDLQ("retry-demo", 10)
	if err != nil {
		log.Fatalf("Failed to get DLQ: %v", err)
	}

	fmt.Printf("Found %d jobs in DLQ\n", len(dlqJobs))
	for _, job := range dlqJobs {
		fmt.Printf("  Job %d: attempts=%d, error=%s\n", job.ID, job.Attempts, job.Error)
	}

	// Retry DLQ jobs
	if len(dlqJobs) > 0 {
		fmt.Println("\n--- Retrying DLQ jobs ---")
		retried, err := client.RetryDLQ("retry-demo", nil)
		if err != nil {
			log.Fatalf("Failed to retry DLQ: %v", err)
		}
		fmt.Printf("Retried %d jobs from DLQ\n", retried)

		// Pull and succeed this time
		job, err := client.Pull("retry-demo", 2*time.Second)
		if err != nil {
			log.Fatalf("Failed to pull job: %v", err)
		}
		if job != nil {
			fmt.Printf("\nGot retried job %d, completing successfully...\n", job.ID)
			client.Ack(job.ID, map[string]interface{}{"success": true})
			fmt.Println("Job completed!")
		}
	}

	// Final state check
	fmt.Println("\n--- Final State ---")
	counts, _ := client.GetJobCounts("retry-demo")
	fmt.Printf("Job counts: %v\n", counts)
}
