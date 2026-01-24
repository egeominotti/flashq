// Example 05: Batch Operations - High-Throughput Processing
//
// Demonstrates batch operations:
// - Push multiple jobs in a single request
// - Pull multiple jobs at once
// - Acknowledge multiple jobs together
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
	client.Obliterate("batch-demo")

	fmt.Println("=== Batch Operations Example ===\n")

	// Batch push
	numJobs := 100
	jobs := make([]map[string]interface{}, numJobs)
	for i := 0; i < numJobs; i++ {
		jobs[i] = map[string]interface{}{
			"data": map[string]interface{}{
				"index": i,
				"email": fmt.Sprintf("user%d@example.com", i),
			},
		}
	}

	fmt.Printf("Pushing %d jobs in batch...\n", numJobs)
	pushStart := time.Now()

	result, err := client.PushBatch("batch-demo", jobs)
	if err != nil {
		log.Fatalf("Failed to batch push: %v", err)
	}

	pushDuration := time.Since(pushStart)
	fmt.Printf("Pushed %d jobs in %v\n", len(result.JobIDs), pushDuration)
	fmt.Printf("Throughput: %.0f jobs/sec\n\n", float64(len(result.JobIDs))/pushDuration.Seconds())

	// Batch pull
	fmt.Println("Pulling jobs in batches of 20...")
	pullStart := time.Now()

	var pulledJobs []*flashq.Job
	for {
		batch, err := client.PullBatch("batch-demo", 20, 1*time.Second)
		if err != nil {
			log.Fatalf("Failed to batch pull: %v", err)
		}
		if len(batch) == 0 {
			break
		}
		pulledJobs = append(pulledJobs, batch...)
		fmt.Printf("  Pulled batch of %d jobs (total: %d)\n", len(batch), len(pulledJobs))
	}

	pullDuration := time.Since(pullStart)
	fmt.Printf("\nPulled %d jobs in %v\n", len(pulledJobs), pullDuration)

	// Batch ack
	fmt.Println("\nAcknowledging all jobs in batch...")
	ackStart := time.Now()

	// Collect job IDs
	jobIDs := make([]int64, len(pulledJobs))
	for i, job := range pulledJobs {
		jobIDs[i] = job.ID
	}

	// Ack in batches of 50
	for i := 0; i < len(jobIDs); i += 50 {
		end := i + 50
		if end > len(jobIDs) {
			end = len(jobIDs)
		}
		batch := jobIDs[i:end]

		_, err := client.AckBatch(batch)
		if err != nil {
			log.Fatalf("Failed to batch ack: %v", err)
		}
	}

	ackDuration := time.Since(ackStart)
	fmt.Printf("Acknowledged %d jobs in %v\n", len(jobIDs), ackDuration)

	// Summary
	totalDuration := pushDuration + pullDuration + ackDuration
	fmt.Printf("\n=== Summary ===\n")
	fmt.Printf("Total jobs: %d\n", numJobs)
	fmt.Printf("Push time: %v\n", pushDuration)
	fmt.Printf("Pull time: %v\n", pullDuration)
	fmt.Printf("Ack time: %v\n", ackDuration)
	fmt.Printf("Total time: %v\n", totalDuration)
	fmt.Printf("Overall throughput: %.0f jobs/sec\n", float64(numJobs)/totalDuration.Seconds())
}
