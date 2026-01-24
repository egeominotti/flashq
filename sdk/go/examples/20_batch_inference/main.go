// Example 20: Batch Inference
//
// Demonstrates high-throughput AI inference:
// - Bulk job submission for batch processing
// - Concurrency control for GPU utilization
// - Result collection with events
package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"sync"
	"sync/atomic"
	"time"

	"github.com/flashq/flashq-go/flashq"
)

const (
	batchSizeConst = 20
	concurrencyLimit  = 3
)

// Simulated embedding generation
func generateEmbedding(text string) []float64 {
	time.Sleep(20 * time.Millisecond) // 20ms inference
	embedding := make([]float64, 1536)
	for i := range embedding {
		embedding[i] = rand.Float64()*2 - 1
	}
	return embedding
}

func main() {
	ctx := context.Background()

	client := flashq.New()
	if err := client.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer client.Close()

	// Clean up
	client.Obliterate("batch-inference")

	fmt.Println("=== Batch Inference Example ===\n")
	fmt.Printf("Batch size: %d documents\n", batchSizeConst)
	fmt.Printf("Concurrency: %d parallel jobs\n\n", concurrencyLimit)

	// Track results
	var (
		results   = make(map[int][]float64)
		resultsMu sync.Mutex
		completed int64
	)

	// Create worker
	processor := func(job *flashq.Job) (interface{}, error) {
		data := job.Data.(map[string]interface{})
		text, _ := data["text"].(string)
		index := int(data["index"].(float64))

		embedding := generateEmbedding(text)

		return map[string]interface{}{
			"index":     index,
			"embedding": embedding,
		}, nil
	}

	workerOpts := flashq.DefaultWorkerOptions()
	workerOpts.Concurrency = concurrencyLimit
	workerOpts.AutoStart = false

	worker := flashq.NewWorkerSingle("batch-inference", processor, nil, &workerOpts)

	worker.On("completed", func(job *flashq.Job, result interface{}) {
		if r, ok := result.(map[string]interface{}); ok {
			var index int
			switch v := r["index"].(type) {
			case int: index = v
			case float64: index = int(v)
			}
			if emb, ok := r["embedding"].([]float64); ok {
				resultsMu.Lock()
				results[index] = emb
				resultsMu.Unlock()
			}

			count := atomic.AddInt64(&completed, 1)
			if count%10 == 0 {
				fmt.Printf("Progress: %d/%d\n", count, batchSizeConst)
			}
		}
	})

	worker.On("failed", func(job *flashq.Job, err error) {
		fmt.Printf("Job failed: %v\n", err)
	})

	worker.Start(ctx)
	time.Sleep(300 * time.Millisecond)

	// Generate documents
	documents := make([]map[string]interface{}, batchSizeConst)
	for i := 0; i < batchSizeConst; i++ {
		documents[i] = map[string]interface{}{
			"data": map[string]interface{}{
				"text":  fmt.Sprintf("Document %d: Sample text for embedding.", i),
				"index": i,
			},
		}
	}

	fmt.Println("Submitting batch...")
	startTime := time.Now()

	// Submit all jobs
	result, err := client.PushBatch("batch-inference", documents)
	if err != nil {
		log.Fatalf("Failed to push batch: %v", err)
	}
	fmt.Printf("Submitted %d jobs\n\n", len(result.JobIDs))

	fmt.Println("Processing...")

	// Wait for all jobs
	for atomic.LoadInt64(&completed) < int64(batchSizeConst) {
		time.Sleep(100 * time.Millisecond)
	}

	totalTime := time.Since(startTime)
	throughput := float64(batchSizeConst) / totalTime.Seconds()

	resultsMu.Lock()
	numResults := len(results)
	sampleDims := 0
	if len(results) > 0 {
		sampleDims = len(results[0])
	}
	resultsMu.Unlock()

	fmt.Printf("\n=== Results ===\n")
	fmt.Printf("Total time: %v\n", totalTime)
	fmt.Printf("Throughput: %.1f embeddings/sec\n", throughput)
	fmt.Printf("Results collected: %d\n", numResults)
	fmt.Printf("Sample embedding dims: %d\n", sampleDims)

	allValid := numResults == batchSizeConst
	if allValid {
		fmt.Println("All results valid: YES")
	} else {
		fmt.Println("All results valid: NO")
	}

	worker.Stop(ctx)
	client.Obliterate("batch-inference")

	fmt.Println("\n=== Batch Complete ===")
}
