// Example 08: Cron Jobs - Scheduled Tasks
//
// Demonstrates cron job scheduling:
// - Create recurring jobs using cron expressions
// - 6-field cron format: sec min hour day month weekday
// - List and delete cron jobs
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
	client.Obliterate("cron-demo")
	client.DeleteCron("hourly-report")
	client.DeleteCron("daily-cleanup")
	client.DeleteCron("every-minute")

	fmt.Println("=== Cron Jobs Example ===")

	// Add cron jobs with different schedules
	// Format: sec min hour day month weekday

	// Every minute at second 0 (for demo)
	_, err := client.AddCron(
		"every-minute",
		"cron-demo",
		"0 * * * * *",
		map[string]interface{}{
			"task": "Quick check",
		},
		nil,
	)
	if err != nil {
		log.Fatalf("Failed to add cron: %v", err)
	}
	fmt.Println("Added: every-minute (0 * * * * *)")

	// Every hour at minute 0
	_, err = client.AddCron(
		"hourly-report",
		"cron-demo",
		"0 0 * * * *",
		map[string]interface{}{
			"task":   "Generate hourly report",
			"format": "pdf",
		},
		nil,
	)
	if err != nil {
		log.Fatalf("Failed to add cron: %v", err)
	}
	fmt.Println("Added: hourly-report (0 0 * * * *)")

	// Every day at midnight
	opts := &flashq.PushOptions{
		Priority: 10,
	}
	_, err = client.AddCron(
		"daily-cleanup",
		"cron-demo",
		"0 0 0 * * *",
		map[string]interface{}{
			"task": "Daily cleanup",
		},
		opts,
	)
	if err != nil {
		log.Fatalf("Failed to add cron: %v", err)
	}
	fmt.Println("Added: daily-cleanup (0 0 0 * * *) with priority=10")

	// List all cron jobs
	fmt.Println("\n--- Current Cron Jobs ---")
	crons, err := client.ListCrons()
	if err != nil {
		log.Fatalf("Failed to list crons: %v", err)
	}
	for _, cron := range crons {
		fmt.Printf("  %s: queue=%s, schedule=%s, data=%v\n",
			cron.Name, cron.Queue, cron.Schedule, cron.Data)
	}

	// Wait for a few cron triggers
	fmt.Println("\n--- Waiting for cron jobs (15 seconds) ---")
	received := 0
	start := time.Now()
	for time.Since(start) < 15*time.Second {
		job, _ := client.Pull("cron-demo", 1*time.Second)
		if job != nil {
			data := job.Data.(map[string]interface{})
			fmt.Printf("Received cron job %d: %v\n", job.ID, data["task"])
			client.Ack(job.ID, nil)
			received++
		}
	}
	fmt.Printf("Received %d cron-triggered jobs\n", received)

	// Delete a cron job
	fmt.Println("\n--- Deleting every-minute cron ---")
	_, err = client.DeleteCron("every-minute")
	if err != nil {
		log.Fatalf("Failed to delete cron: %v", err)
	}

	// List remaining crons
	fmt.Println("\n--- Remaining Cron Jobs ---")
	crons, _ = client.ListCrons()
	for _, cron := range crons {
		fmt.Printf("  %s: queue=%s, schedule=%s\n", cron.Name, cron.Queue, cron.Schedule)
	}

	// Cleanup
	client.DeleteCron("hourly-report")
	client.DeleteCron("daily-cleanup")

	fmt.Println("\nDone!")
}
