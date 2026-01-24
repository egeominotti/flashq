// Example 11: Unique Jobs - Deduplication
//
// Demonstrates unique job keys:
// - Prevent duplicate jobs with the same unique_key
// - Useful for idempotent operations
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
	client.Obliterate("unique-demo")

	fmt.Println("=== Unique Jobs Example ===\n")

	// Push a job with unique key
	orderID := "ORDER-12345"
	opts := &flashq.PushOptions{
		UniqueKey: orderID,
	}

	fmt.Printf("Pushing job with unique_key='%s'...\n", orderID)
	jobID1, err := client.Push("unique-demo", map[string]interface{}{
		"order_id": orderID,
		"action":   "process",
		"attempt":  1,
	}, opts)
	if err != nil {
		log.Fatalf("Failed to push job: %v", err)
	}
	fmt.Printf("First push: job ID = %d\n", jobID1)

	// Try to push duplicate
	fmt.Printf("\nTrying to push duplicate with same unique_key...\n")
	jobID2, err := client.Push("unique-demo", map[string]interface{}{
		"order_id": orderID,
		"action":   "process",
		"attempt":  2,
	}, opts)
	if err != nil {
		fmt.Printf("Expected error: %v\n", err)
	} else {
		fmt.Printf("Second push returned job ID = %d (same as first)\n", jobID2)
		if jobID1 == jobID2 {
			fmt.Println("✓ Same job ID returned - deduplication worked!")
		}
	}

	// Push with different unique key
	differentOrder := "ORDER-67890"
	opts2 := &flashq.PushOptions{
		UniqueKey: differentOrder,
	}

	fmt.Printf("\nPushing job with different unique_key='%s'...\n", differentOrder)
	jobID3, err := client.Push("unique-demo", map[string]interface{}{
		"order_id": differentOrder,
		"action":   "process",
	}, opts2)
	if err != nil {
		log.Fatalf("Failed to push job: %v", err)
	}
	fmt.Printf("Third push: job ID = %d (different job)\n", jobID3)

	// Check queue count
	count, _ := client.Count("unique-demo")
	fmt.Printf("\nQueue count: %d jobs (should be 2, not 3)\n", count)

	// Process the jobs
	fmt.Println("\n--- Processing jobs ---")
	for i := 0; i < 3; i++ {
		job, _ := client.Pull("unique-demo", 1*time.Second)
		if job == nil {
			break
		}
		data := job.Data.(map[string]interface{})
		fmt.Printf("Job %d: order=%v\n", job.ID, data["order_id"])
		client.Ack(job.ID, nil)
	}

	// The unique key is released after job is completed
	fmt.Println("\n--- After completion, can reuse unique key ---")
	jobID4, _ := client.Push("unique-demo", map[string]interface{}{
		"order_id": orderID,
		"action":   "reprocess",
	}, opts)
	fmt.Printf("Pushed new job with same unique_key: job ID = %d\n", jobID4)

	fmt.Println("\nDone!")
}
