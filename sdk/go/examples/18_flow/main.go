// Example 18: Job Flow - Parent/Child Dependencies
//
// Demonstrates workflow with job dependencies:
// - Parent jobs wait for all children to complete
// - Useful for fan-out/fan-in patterns
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

	// Clean up
	client.Obliterate("sections")
	client.Obliterate("report")

	fmt.Println("=== Job Flow Example ===\n")

	// Create workers for child and parent queues
	childProcessor := func(job *flashq.Job) (interface{}, error) {
		data := job.Data.(map[string]interface{})
		section := data["section"].(string)
		fmt.Printf("Processing section: %s\n", section)

		time.Sleep(300 * time.Millisecond)

		return map[string]interface{}{
			"section": section,
			"done":    true,
		}, nil
	}

	parentProcessor := func(job *flashq.Job) (interface{}, error) {
		data := job.Data.(map[string]interface{})
		fmt.Printf("\nGenerating report: %v\n", data["type"])

		return map[string]interface{}{
			"report": "complete",
		}, nil
	}

	// Start child worker
	childOpts := flashq.DefaultWorkerOptions()
	childOpts.Concurrency = 3
	childOpts.AutoStart = false
	childWorker := flashq.NewWorkerSingle("sections", childProcessor, nil, &childOpts)
	childWorker.Start(ctx)

	// Start parent worker
	parentOpts := flashq.DefaultWorkerOptions()
	parentOpts.Concurrency = 1
	parentOpts.AutoStart = false
	parentWorker := flashq.NewWorkerSingle("report", parentProcessor, nil, &parentOpts)
	parentWorker.Start(ctx)

	// Push flow: parent waits for children
	fmt.Println("Pushing flow with parent and 3 children...\n")
	flow, err := client.PushFlow(
		"report",
		map[string]interface{}{"type": "monthly"},
		[]flashq.FlowChild{
			{Queue: "sections", Data: map[string]interface{}{"section": "sales"}},
			{Queue: "sections", Data: map[string]interface{}{"section": "marketing"}},
			{Queue: "sections", Data: map[string]interface{}{"section": "operations"}},
		},
		nil,
	)
	if err != nil {
		log.Fatalf("Failed to push flow: %v", err)
	}

	fmt.Printf("Parent ID: %d\n", flow.ParentID)
	fmt.Printf("Children IDs: %v\n\n", flow.ChildrenIDs)

	// Wait for completion
	fmt.Println("Waiting for workflow to complete...")
	time.Sleep(3 * time.Second)

	// Check parent job state
	parentJob, err := client.GetJob(flow.ParentID)
	if err != nil {
		log.Printf("Failed to get parent job: %v", err)
	} else {
		fmt.Printf("\nParent job state: %s\n", parentJob.State)
		if parentJob.Result != nil {
			fmt.Printf("Parent result: %v\n", parentJob.Result)
		}
	}

	// Stop workers
	childWorker.Stop(ctx)
	parentWorker.Stop(ctx)

	fmt.Println("\nDone!")
}
