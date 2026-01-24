// Example 19: AI Agent Workflow
//
// Demonstrates AI/ML workloads with:
// - Multi-step agent workflows
// - Rate limiting for API cost control
// - Sequential job execution with finished()
package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/flashq/flashq-go/flashq"
)

const queueName = "ai-workflow"

// Simulated AI functions
func parseIntent(prompt string) map[string]interface{} {
	time.Sleep(100 * time.Millisecond) // Simulate API latency
	return map[string]interface{}{
		"intent":   "search_and_answer",
		"entities": []string{"flashQ", "job queue", "AI"},
	}
}

func retrieveContext(query string) []string {
	time.Sleep(150 * time.Millisecond) // Simulate vector DB lookup
	return []string{
		"flashQ is a high-performance job queue built with Rust.",
		"It supports job dependencies for workflow orchestration.",
		"Rate limiting helps control API costs for LLM calls.",
	}
}

func generateResponse(context []string, intent string) string {
	time.Sleep(200 * time.Millisecond) // Simulate LLM call
	return fmt.Sprintf("Based on the context about %s: %s", intent, strings.Join(context, " "))
}

func main() {
	ctx := context.Background()

	client := flashq.New()
	if err := client.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer client.Close()

	// Clean up
	client.Obliterate(queueName)

	fmt.Println("=== AI Agent Workflow Example ===\n")

	// Set rate limit for API cost control
	client.SetRateLimit(queueName, 10)
	fmt.Println("Set rate limit: 10 jobs/sec (API cost control)\n")

	// Create worker
	processor := func(job *flashq.Job) (interface{}, error) {
		data := job.Data.(map[string]interface{})
		step := data["step"].(string)

		switch step {
		case "parse":
			fmt.Printf("[Job %d] Parsing intent...\n", job.ID)
			prompt, _ := data["prompt"].(string)
			return parseIntent(prompt), nil

		case "retrieve":
			fmt.Printf("[Job %d] Retrieving context...\n", job.ID)
			query, _ := data["query"].(string)
			return retrieveContext(query), nil

		case "generate":
			fmt.Printf("[Job %d] Generating response...\n", job.ID)
			ctx, _ := data["context"].([]interface{})
			context := make([]string, len(ctx))
			for i, c := range ctx {
				context[i], _ = c.(string)
			}
			intent, _ := data["intent"].(string)
			return generateResponse(context, intent), nil

		default:
			return nil, fmt.Errorf("unknown step: %s", step)
		}
	}

	workerOpts := flashq.DefaultWorkerOptions()
	workerOpts.Concurrency = 5
	workerOpts.AutoStart = false

	worker := flashq.NewWorkerSingle(queueName, processor, nil, &workerOpts)

	worker.On("completed", func(job *flashq.Job, result interface{}) {
		resultStr := fmt.Sprintf("%v", result)
		if len(resultStr) > 80 {
			resultStr = resultStr[:80] + "..."
		}
		fmt.Printf("[Job %d] Completed: %s\n", job.ID, resultStr)
	})

	worker.On("failed", func(job *flashq.Job, err error) {
		fmt.Printf("[Job %d] Failed: %v\n", job.ID, err)
	})

	worker.Start(ctx)
	time.Sleep(300 * time.Millisecond)

	// Start the workflow
	userPrompt := "Tell me about flashQ and how it helps with AI workloads"
	fmt.Printf("User: \"%s\"\n\n", userPrompt)

	// Step 1: Parse user intent
	parseJobID, err := client.Push(queueName, map[string]interface{}{
		"step":   "parse",
		"prompt": userPrompt,
	}, nil)
	if err != nil {
		log.Fatalf("Failed to push parse job: %v", err)
	}
	fmt.Printf("Created parse job: %d\n", parseJobID)

	parseResult, err := client.Finished(parseJobID, 10*time.Second)
	if err != nil {
		log.Fatalf("Parse job failed: %v", err)
	}
	fmt.Printf("Parse result: %v\n\n", parseResult)

	// Step 2: Retrieve context
	entities := []string{}
	if pr, ok := parseResult.(map[string]interface{}); ok {
		if e, ok := pr["entities"].([]interface{}); ok {
			for _, entity := range e {
				entities = append(entities, entity.(string))
			}
		}
	}

	retrieveJobID, err := client.Push(queueName, map[string]interface{}{
		"step":  "retrieve",
		"query": strings.Join(entities, " "),
	}, nil)
	if err != nil {
		log.Fatalf("Failed to push retrieve job: %v", err)
	}
	fmt.Printf("Created retrieve job: %d\n", retrieveJobID)

	retrieveResult, err := client.Finished(retrieveJobID, 10*time.Second)
	if err != nil {
		log.Fatalf("Retrieve job failed: %v", err)
	}
	fmt.Printf("Retrieve result: %d chunks\n\n", len(retrieveResult.([]interface{})))

	// Step 3: Generate response
	intent := ""
	if pr, ok := parseResult.(map[string]interface{}); ok {
		intent, _ = pr["intent"].(string)
	}

	generateJobID, err := client.Push(queueName, map[string]interface{}{
		"step":    "generate",
		"context": retrieveResult,
		"intent":  intent,
	}, nil)
	if err != nil {
		log.Fatalf("Failed to push generate job: %v", err)
	}
	fmt.Printf("Created generate job: %d\n", generateJobID)

	finalResult, err := client.Finished(generateJobID, 10*time.Second)
	if err != nil {
		log.Fatalf("Generate job failed: %v", err)
	}

	fmt.Printf("\n=== Final Response ===\n%v\n", finalResult)

	worker.Stop(ctx)
	client.Obliterate(queueName)

	fmt.Println("\n=== Workflow Complete ===")
}
