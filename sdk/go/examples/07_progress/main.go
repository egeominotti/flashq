// Example 07: Progress Tracking
//
// Demonstrates job progress tracking:
// - Update progress (0-100%) during processing
// - Include optional progress message
// - Monitor progress from another client
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
	client := flashq.New()
	client.Connect(ctx)
	client.Obliterate("progress-demo")
	client.Close()

	fmt.Println("=== Progress Tracking Example ===")

	var wg sync.WaitGroup
	var jobID int64

	// Producer - push job and monitor progress
	wg.Add(1)
	go func() {
		defer wg.Done()

		producer := flashq.New()
		if err := producer.Connect(ctx); err != nil {
			log.Fatalf("Producer: Failed to connect: %v", err)
		}
		defer producer.Close()

		// Push a job
		var err error
		jobID, err = producer.Push("progress-demo", map[string]interface{}{
			"file":   "large_video.mp4",
			"action": "transcode",
		}, nil)
		if err != nil {
			log.Fatalf("Producer: Failed to push job: %v", err)
		}
		fmt.Printf("Producer: Pushed job %d\n", jobID)

		// Monitor progress
		fmt.Println("Producer: Monitoring progress...")
		for {
			time.Sleep(300 * time.Millisecond)

			info, err := producer.GetProgress(jobID)
			if err != nil {
				continue
			}

			fmt.Printf("Producer: Progress = %d%% - %s\n", info.Progress, info.Message)

			if info.Progress >= 100 {
				break
			}
		}

		// Get final result
		result, _ := producer.GetResult(jobID)
		fmt.Printf("Producer: Job completed with result: %v\n", result)
	}()

	// Give producer time to push
	time.Sleep(100 * time.Millisecond)

	// Worker - process job and report progress
	wg.Add(1)
	go func() {
		defer wg.Done()

		worker := flashq.New()
		if err := worker.Connect(ctx); err != nil {
			log.Fatalf("Worker: Failed to connect: %v", err)
		}
		defer worker.Close()

		// Pull job
		job, err := worker.Pull("progress-demo", 5*time.Second)
		if err != nil {
			log.Fatalf("Worker: Failed to pull job: %v", err)
		}
		if job == nil {
			log.Fatal("Worker: No job received")
		}
		fmt.Printf("\nWorker: Got job %d\n", job.ID)

		// Simulate processing with progress updates
		steps := []struct {
			progress int
			message  string
		}{
			{10, "Initializing..."},
			{25, "Reading input file..."},
			{50, "Processing frames..."},
			{75, "Encoding output..."},
			{90, "Finalizing..."},
			{100, "Complete!"},
		}

		for _, step := range steps {
			time.Sleep(500 * time.Millisecond)
			worker.Progress(job.ID, step.progress, step.message)
			fmt.Printf("Worker: Set progress to %d%% - %s\n", step.progress, step.message)
		}

		// Complete job
		worker.Ack(job.ID, map[string]interface{}{
			"outputFile": "transcoded_video.mp4",
			"duration":   "2:30:15",
		})
		fmt.Println("Worker: Job completed")
	}()

	wg.Wait()
	fmt.Println("\nDone!")
}
