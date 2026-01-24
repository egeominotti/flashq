// Example 09: Rate Limiting
//
// Demonstrates queue rate limiting:
// - Limit how many jobs can be processed per second
// - Useful for API rate limits, resource protection
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

	client := flashq.New()
	if err := client.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer client.Close()

	// Clean up first
	client.Obliterate("rate-limit-demo")

	fmt.Println("=== Rate Limiting Example ===")

	// Push 20 jobs
	numJobs := 20
	fmt.Printf("Pushing %d jobs...\n", numJobs)
	for i := 0; i < numJobs; i++ {
		client.Push("rate-limit-demo", map[string]interface{}{
			"index": i,
		}, nil)
	}

	// Set rate limit: 5 jobs per second
	rateLimit := 5
	_, err := client.SetRateLimit("rate-limit-demo", rateLimit)
	if err != nil {
		log.Fatalf("Failed to set rate limit: %v", err)
	}
	fmt.Printf("Set rate limit: %d jobs/second\n\n", rateLimit)

	// Process jobs with multiple workers
	numWorkers := 3
	var wg sync.WaitGroup
	processedCount := make(chan int, numJobs)
	startTime := time.Now()

	fmt.Printf("Starting %d workers to process jobs...\n", numWorkers)

	for w := 0; w < numWorkers; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()

			workerClient := flashq.New()
			workerClient.Connect(ctx)
			defer workerClient.Close()

			for {
				job, _ := workerClient.Pull("rate-limit-demo", 500*time.Millisecond)
				if job == nil {
					return
				}

				elapsed := time.Since(startTime)
				data := job.Data.(map[string]interface{})
				fmt.Printf("  [%.1fs] Worker %d processed job %d (index=%v)\n",
					elapsed.Seconds(), workerID, job.ID, data["index"])

				workerClient.Ack(job.ID, nil)
				processedCount <- 1
			}
		}(w)
	}

	wg.Wait()
	close(processedCount)

	totalProcessed := 0
	for range processedCount {
		totalProcessed++
	}

	duration := time.Since(startTime)
	actualRate := float64(totalProcessed) / duration.Seconds()

	fmt.Printf("\n--- Results ---\n")
	fmt.Printf("Jobs processed: %d\n", totalProcessed)
	fmt.Printf("Total time: %.2fs\n", duration.Seconds())
	fmt.Printf("Actual rate: %.2f jobs/sec (limit: %d)\n", actualRate, rateLimit)

	// Clear rate limit
	fmt.Println("\nClearing rate limit...")
	client.ClearRateLimit("rate-limit-demo")

	fmt.Println("Done!")
}
