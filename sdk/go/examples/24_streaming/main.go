// Example 24: Live Job Streaming
//
// Demonstrates streaming partial results from jobs in real-time.
// Use case: LLM token streaming, chunked file processing, progress data.
//
// Run: go run examples/24_streaming/main.go
package main

import (
	"context"
	"fmt"
	"time"

	"github.com/flashq/flashq-go/flashq"
)

func main() {
	ctx := context.Background()

	// Producer client
	client := flashq.New()
	if err := client.Connect(ctx); err != nil {
		panic(err)
	}
	defer client.Close()

	fmt.Println("=== Live Job Streaming Example ===")
	fmt.Println()

	// Worker with streaming
	worker := flashq.NewWorkerSingle("llm", func(job *flashq.Job) (interface{}, error) {
		data := job.Data.(map[string]interface{})
		prompt := ""
		if p, ok := data["prompt"].(string); ok {
			prompt = p
		}
		fmt.Printf("[Worker] Processing prompt: \"%s\"\n", prompt)

		// Simulate token-by-token generation
		tokens := []string{"Hello", ",", " I", " am", " an", " AI", " assistant", "."}

		for i, token := range tokens {
			// Send partial result (token)
			idx := i
			client.Partial(job.ID, map[string]interface{}{"token": token}, &idx)
			fmt.Printf("[Worker] Sent token %d: \"%s\"\n", i, token)

			// Simulate generation delay
			time.Sleep(100 * time.Millisecond)
		}

		return map[string]interface{}{"complete": true, "totalTokens": len(tokens)}, nil
	}, nil, nil)

	// Event handlers
	worker.On("completed", func(job *flashq.Job, result interface{}) {
		fmt.Printf("\n[Event] Job %d completed: %v\n", job.ID, result)
	})

	// Start worker in background
	go worker.Start(ctx)
	defer worker.Stop(ctx)

	// Push a job
	jobID, err := client.Push("llm", map[string]interface{}{"prompt": "Say hello"}, nil)
	if err != nil {
		panic(err)
	}
	fmt.Printf("[Client] Pushed job %d\n", jobID)
	fmt.Println("[Client] Streaming tokens...")
	fmt.Println()

	// Wait for completion
	time.Sleep(2 * time.Second)

	// Get final result
	result, _ := client.GetResult(jobID)
	fmt.Printf("\n[Client] Final result: %v\n", result)

	fmt.Println()
	fmt.Println("=== Streaming Complete ===")
	fmt.Println()
	fmt.Println("To consume streaming events, use SSE:")
	fmt.Println("  curl -N http://localhost:6790/events/job/{id}?events=partial")
}
