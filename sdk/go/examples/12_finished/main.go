// Example 12: Finished - Wait for Job Completion
//
// Demonstrates waiting for job completion:
// - Push a job and wait for its result
// - Useful for synchronous workflows
package main

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/flashq/flashq-go/flashq"
)

func main() {
	ctx := context.Background()

	// Clean up first
	setupClient := flashq.New()
	setupClient.Connect(ctx)
	setupClient.Obliterate("finished-demo")
	setupClient.Close()

	fmt.Println("=== Finished (Wait for Completion) Example ===")

	var wg sync.WaitGroup

	// Start a worker in background
	wg.Add(1)
	go func() {
		defer wg.Done()

		worker := flashq.New()
		if err := worker.Connect(ctx); err != nil {
			log.Printf("Worker: Failed to connect: %v", err)
			return
		}
		defer worker.Close()

		for i := 0; i < 3; i++ {
			job, _ := worker.Pull("finished-demo", 10*time.Second)
			if job == nil {
				continue
			}

			data := job.Data.(map[string]interface{})
			fmt.Printf("Worker: Processing job %d: %v\n", job.ID, data["task"])

			// Simulate work
			time.Sleep(500 * time.Millisecond)

			// Complete with result
			result := map[string]interface{}{
				"status":      "completed",
				"processedAt": time.Now().Unix(),
				"task":        data["task"],
			}
			worker.Ack(job.ID, result)
			fmt.Printf("Worker: Completed job %d\n", job.ID)
		}
	}()

	// Give worker time to start
	time.Sleep(100 * time.Millisecond)

	// Producer waits for job completion
	producer := flashq.New()
	if err := producer.Connect(ctx); err != nil {
		log.Fatalf("Producer: Failed to connect: %v", err)
	}
	defer producer.Close()

	// Push and wait for multiple jobs
	tasks := []string{"Task A", "Task B", "Task C"}

	for _, task := range tasks {
		fmt.Printf("\nProducer: Pushing '%s' and waiting for result...\n", task)

		// Push job
		jobID, err := producer.Push("finished-demo", map[string]interface{}{
			"task": task,
		}, nil)
		if err != nil {
			log.Fatalf("Producer: Failed to push job: %v", err)
		}
		fmt.Printf("Producer: Created job %d\n", jobID)

		// Wait for completion (blocks until job is done)
		start := time.Now()
		result, err := producer.Finished(jobID, 10*time.Second)
		elapsed := time.Since(start)

		if err != nil {
			log.Printf("Producer: Error waiting for job: %v", err)
			continue
		}

		fmt.Printf("Producer: Got result in %v: %v\n", elapsed, result)
	}

	wg.Wait()
	fmt.Println("\nDone!")
}
