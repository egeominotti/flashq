// Example 03: Priority - Job Prioritization
//
// Demonstrates job priorities:
// - Higher priority jobs are processed first
// - Priority range: any integer (higher = more important)
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
	client.Obliterate("priority-demo")

	fmt.Println("Pushing jobs with different priorities...")

	// Push jobs with different priorities
	priorities := []struct {
		name     string
		priority int
	}{
		{"Low priority task", 1},
		{"Medium priority task", 5},
		{"High priority task", 10},
		{"Critical task", 100},
		{"Normal task", 3},
	}

	for _, p := range priorities {
		opts := &flashq.PushOptions{Priority: p.priority}
		jobID, err := client.Push("priority-demo", map[string]interface{}{
			"name":     p.name,
			"priority": p.priority,
		}, opts)
		if err != nil {
			log.Fatalf("Failed to push job: %v", err)
		}
		fmt.Printf("  Pushed: %s (priority=%d) -> Job %d\n", p.name, p.priority, jobID)
	}

	fmt.Println("\nPulling jobs (should come in priority order):")

	// Pull jobs - they should come in priority order
	for i := 0; i < 5; i++ {
		job, err := client.Pull("priority-demo", 5*time.Second)
		if err != nil {
			log.Fatalf("Failed to pull job: %v", err)
		}
		if job == nil {
			break
		}

		data := job.Data.(map[string]interface{})
		fmt.Printf("  %d. %s (priority=%v)\n", i+1, data["name"], data["priority"])

		client.Ack(job.ID, nil)
	}

	fmt.Println("\nDone!")
}
