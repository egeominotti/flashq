// Example 22: Group Support - FIFO Processing Within Groups
//
// Jobs with the same group_id are processed sequentially,
// while different groups can be processed in parallel.
//
// Use case: Process all orders for a customer in sequence
// while allowing orders from different customers in parallel.
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

	fmt.Println("=== Group Support Example ===")

	// Clean up
	client.Drain("orders")

	// Push multiple orders for customer A (same group)
	fmt.Println("Pushing orders for Customer A (same group - processed sequentially)...")
	customerA1, _ := client.Push("orders", map[string]interface{}{
		"customer": "A",
		"order":    1,
	}, &flashq.PushOptions{GroupID: "customer-A"})

	customerA2, _ := client.Push("orders", map[string]interface{}{
		"customer": "A",
		"order":    2,
	}, &flashq.PushOptions{GroupID: "customer-A"})

	customerA3, _ := client.Push("orders", map[string]interface{}{
		"customer": "A",
		"order":    3,
	}, &flashq.PushOptions{GroupID: "customer-A"})

	// Push orders for customer B (different group)
	fmt.Println("Pushing orders for Customer B (different group - can run in parallel)...")
	customerB1, _ := client.Push("orders", map[string]interface{}{
		"customer": "B",
		"order":    1,
	}, &flashq.PushOptions{GroupID: "customer-B"})

	customerB2, _ := client.Push("orders", map[string]interface{}{
		"customer": "B",
		"order":    2,
	}, &flashq.PushOptions{GroupID: "customer-B"})

	fmt.Printf("\nPushed jobs: A1=%d, A2=%d, A3=%d, B1=%d, B2=%d\n",
		customerA1, customerA2, customerA3, customerB1, customerB2)

	// Simulate a worker pulling and processing jobs
	fmt.Println("\n--- Simulating Worker Processing ---")

	// First pull - should get one job from each group
	job1, _ := client.Pull("orders", 1*time.Second)
	job2, _ := client.Pull("orders", 1*time.Second)

	if job1 != nil && job2 != nil {
		data1 := job1.Data.(map[string]interface{})
		data2 := job2.Data.(map[string]interface{})
		fmt.Printf("First batch pulled: Job %d (%s-%v), Job %d (%s-%v)\n",
			job1.ID, data1["customer"], data1["order"],
			job2.ID, data2["customer"], data2["order"])
	}

	// Ack the first job and see that we can pull the next one from that group
	if job1 != nil {
		data1 := job1.Data.(map[string]interface{})
		fmt.Printf("\nAcking Job %d (%s-%v)...\n", job1.ID, data1["customer"], data1["order"])
		client.Ack(job1.ID, nil)

		// Now we should be able to pull the next job from that customer's group
		job3, _ := client.Pull("orders", 1*time.Second)
		if job3 != nil {
			data3 := job3.Data.(map[string]interface{})
			fmt.Printf("After ack, pulled: Job %d (%s-%v)\n",
				job3.ID, data3["customer"], data3["order"])
			client.Ack(job3.ID, nil)
		}
	}

	// Ack remaining jobs
	if job2 != nil {
		client.Ack(job2.ID, nil)
	}

	// Pull and ack remaining jobs
	for {
		remaining, _ := client.Pull("orders", 500*time.Millisecond)
		if remaining == nil || remaining.ID == 0 {
			break
		}
		data := remaining.Data.(map[string]interface{})
		fmt.Printf("Processing remaining: Job %d (%s-%v)\n",
			remaining.ID, data["customer"], data["order"])
		client.Ack(remaining.ID, nil)
	}

	fmt.Println("\n=== Group Support Benefits ===")
	fmt.Println("1. Jobs within a group are processed in FIFO order")
	fmt.Println("2. Different groups can be processed in parallel")
	fmt.Println("3. Perfect for per-user, per-tenant, or per-resource processing")
	fmt.Println("4. Ensures data consistency for related operations")

	fmt.Println("\nDone!")
}
