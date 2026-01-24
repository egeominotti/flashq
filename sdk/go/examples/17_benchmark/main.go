// Example 17: Benchmark - Measure Throughput
//
// Demonstrates high-performance batch operations
// and measures throughput.
package main

import (
	"context"
	"fmt"
	"log"
	"sync/atomic"
	"time"

	"github.com/flashq/flashq-go/flashq"
)

const (
	numJobs     = 10000
	batchSize   = 1000
	concurrency = 20
)

func main() {
	ctx := context.Background()

	client := flashq.New()
	if err := client.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer client.Close()

	// Clean up
	client.Obliterate("benchmark")

	fmt.Println("=== Benchmark Example ===\n")
	fmt.Printf("Jobs: %d, Batch size: %d, Concurrency: %d\n\n", numJobs, batchSize, concurrency)

	// Push in batches
	fmt.Printf("Pushing %d jobs in batches of %d...\n", numJobs, batchSize)
	pushStart := time.Now()

	totalPushed := 0
	for i := 0; i < numJobs; i += batchSize {
		size := batchSize
		if i+size > numJobs {
			size = numJobs - i
		}

		jobs := make([]map[string]interface{}, size)
		for j := 0; j < size; j++ {
			jobs[j] = map[string]interface{}{
				"data": map[string]interface{}{
					"i": i + j,
				},
			}
		}

		result, err := client.PushBatch("benchmark", jobs)
		if err != nil {
			log.Fatalf("Failed to push batch: %v", err)
		}
		totalPushed += len(result.JobIDs)
	}

	pushDuration := time.Since(pushStart)
	pushRate := float64(totalPushed) / pushDuration.Seconds()
	fmt.Printf("Push: %d jobs in %v (%.0f jobs/sec)\n\n", totalPushed, pushDuration, pushRate)

	// Process with worker
	fmt.Println("Processing jobs...")
	processStart := time.Now()

	var processed int64

	// Simple processor
	processor := func(job *flashq.Job) (interface{}, error) {
		atomic.AddInt64(&processed, 1)
		return map[string]interface{}{"ok": true}, nil
	}

	workerOpts := flashq.DefaultWorkerOptions()
	workerOpts.Concurrency = concurrency
	workerOpts.AutoStart = false
	workerOpts.BatchSize = 100

	worker := flashq.NewWorkerSingle("benchmark", processor, nil, &workerOpts)

	worker.On("completed", func(job *flashq.Job, result interface{}) {
		count := atomic.LoadInt64(&processed)
		if count%1000 == 0 {
			fmt.Printf("  Processed: %d/%d\n", count, numJobs)
		}
	})

	worker.Start(ctx)

	// Wait for all jobs
	for atomic.LoadInt64(&processed) < int64(numJobs) {
		time.Sleep(100 * time.Millisecond)
	}

	processDuration := time.Since(processStart)
	processRate := float64(processed) / processDuration.Seconds()

	worker.Stop(ctx)

	fmt.Printf("\nProcess: %d jobs in %v (%.0f jobs/sec)\n", processed, processDuration, processRate)

	// Summary
	totalDuration := pushDuration + processDuration
	overallRate := float64(numJobs) / totalDuration.Seconds()

	fmt.Printf("\n=== Summary ===\n")
	fmt.Printf("Total jobs: %d\n", numJobs)
	fmt.Printf("Push rate: %.0f jobs/sec\n", pushRate)
	fmt.Printf("Process rate: %.0f jobs/sec\n", processRate)
	fmt.Printf("Total time: %v\n", totalDuration)
	fmt.Printf("Overall throughput: %.0f jobs/sec\n", overallRate)

	// Cleanup
	client.Obliterate("benchmark")
}
