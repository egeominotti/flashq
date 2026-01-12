package main

import (
	"fmt"
	"log"

	"github.com/flashq/flashq-go/flashq"
)

func main() {
	fmt.Println("FlashQ Go SDK - Basic Usage Example")
	fmt.Println("====================================")

	// Create client
	client := flashq.New()
	defer client.Close()

	// Connect
	if err := client.Connect(); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	fmt.Println("Connected to FlashQ")

	// Push a job
	job, err := client.Push("emails", map[string]string{
		"to":      "user@example.com",
		"subject": "Welcome!",
		"body":    "Hello from FlashQ!",
	}, nil)
	if err != nil {
		log.Fatalf("Failed to push: %v", err)
	}
	fmt.Printf("Created job %d\n", job.ID)

	// Get stats
	stats, err := client.Stats()
	if err != nil {
		log.Fatalf("Failed to get stats: %v", err)
	}
	fmt.Printf("Queue stats - Queued: %d, Processing: %d\n", stats.Queued, stats.Processing)

	// Push with options
	job2, err := client.Push("notifications", map[string]string{"message": "Hello!"}, &flashq.PushOptions{
		Priority:    10,
		MaxAttempts: 3,
	})
	if err != nil {
		log.Fatalf("Failed to push: %v", err)
	}
	fmt.Printf("Created notification job %d\n", job2.ID)

	// Pull and process the job
	pulled, err := client.Pull("notifications")
	if err != nil {
		log.Fatalf("Failed to pull: %v", err)
	}

	var data map[string]string
	pulled.GetData(&data)
	fmt.Printf("Pulled job %d: %v\n", pulled.ID, data)

	// Acknowledge completion
	if err := client.Ack(pulled.ID, map[string]bool{"sent": true}); err != nil {
		log.Fatalf("Failed to ack: %v", err)
	}
	fmt.Printf("Job %d completed\n", pulled.ID)

	// Pull and ack the email job
	emailJob, _ := client.Pull("emails")
	client.Ack(emailJob.ID, nil)
	fmt.Println("Email job completed")

	fmt.Println("\nBasic usage complete!")
}
