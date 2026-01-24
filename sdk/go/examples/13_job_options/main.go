// Example 13: All Job Options
//
// Demonstrates all available push options:
// - Priority, delay, TTL, timeout
// - Retry settings, unique keys, dependencies
// - Custom job IDs, retention policies
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
	client.Obliterate("options-demo")

	fmt.Println("=== All Job Options Example ===\n")

	// 1. Priority
	fmt.Println("1. Priority (higher = processed first)")
	opts := &flashq.PushOptions{Priority: 100}
	id, _ := client.Push("options-demo", map[string]interface{}{"type": "high-priority"}, opts)
	fmt.Printf("   Pushed job %d with priority=100\n\n", id)

	// 2. Delay
	fmt.Println("2. Delay (schedule for future)")
	opts = &flashq.PushOptions{Delay: 5 * time.Second}
	id, _ = client.Push("options-demo", map[string]interface{}{"type": "delayed"}, opts)
	fmt.Printf("   Pushed job %d with 5s delay\n\n", id)

	// 3. TTL (Time To Live)
	fmt.Println("3. TTL (auto-expire if not processed)")
	opts = &flashq.PushOptions{TTL: 30 * time.Second}
	id, _ = client.Push("options-demo", map[string]interface{}{"type": "expires-soon"}, opts)
	fmt.Printf("   Pushed job %d with 30s TTL\n\n", id)

	// 4. Timeout
	fmt.Println("4. Timeout (max processing time)")
	opts = &flashq.PushOptions{Timeout: 10 * time.Second}
	id, _ = client.Push("options-demo", map[string]interface{}{"type": "has-timeout"}, opts)
	fmt.Printf("   Pushed job %d with 10s timeout\n\n", id)

	// 5. Retry settings
	fmt.Println("5. Retry settings")
	opts = &flashq.PushOptions{
		MaxAttempts: 5,
		Backoff:     2 * time.Second,
	}
	id, _ = client.Push("options-demo", map[string]interface{}{"type": "will-retry"}, opts)
	fmt.Printf("   Pushed job %d with max_attempts=5, backoff=2s\n\n", id)

	// 6. Unique key (deduplication)
	fmt.Println("6. Unique key")
	opts = &flashq.PushOptions{UniqueKey: "order-12345"}
	id, _ = client.Push("options-demo", map[string]interface{}{"type": "unique"}, opts)
	fmt.Printf("   Pushed job %d with unique_key='order-12345'\n\n", id)

	// 7. Tags
	fmt.Println("7. Tags")
	opts = &flashq.PushOptions{Tags: []string{"email", "marketing", "newsletter"}}
	id, _ = client.Push("options-demo", map[string]interface{}{"type": "tagged"}, opts)
	fmt.Printf("   Pushed job %d with tags=['email', 'marketing', 'newsletter']\n\n", id)

	// 8. LIFO mode
	fmt.Println("8. LIFO mode (Last In First Out)")
	opts = &flashq.PushOptions{LIFO: true}
	id, _ = client.Push("options-demo", map[string]interface{}{"type": "lifo"}, opts)
	fmt.Printf("   Pushed job %d with LIFO=true\n\n", id)

	// 9. Custom Job ID (idempotency)
	fmt.Println("9. Custom Job ID")
	opts = &flashq.PushOptions{JobID: "my-custom-job-123"}
	id, _ = client.Push("options-demo", map[string]interface{}{"type": "custom-id"}, opts)
	fmt.Printf("   Pushed job %d with jobId='my-custom-job-123'\n", id)

	// Look up by custom ID
	job, _ := client.GetJobByCustomID("my-custom-job-123")
	if job != nil {
		fmt.Printf("   Found by custom ID: job %d\n\n", job.ID)
	}

	// 10. Retention policies
	fmt.Println("10. Retention policies")
	opts = &flashq.PushOptions{
		KeepCompletedAge:   24 * time.Hour,
		KeepCompletedCount: 100,
	}
	id, _ = client.Push("options-demo", map[string]interface{}{"type": "retained"}, opts)
	fmt.Printf("   Pushed job %d with keepCompletedAge=24h, keepCompletedCount=100\n\n", id)

	// 11. Group ID (FIFO within group)
	fmt.Println("11. Group ID (sequential within group)")
	opts = &flashq.PushOptions{GroupID: "customer-A"}
	id, _ = client.Push("options-demo", map[string]interface{}{"type": "grouped"}, opts)
	fmt.Printf("   Pushed job %d with group_id='customer-A'\n\n", id)

	// 12. Debounce
	fmt.Println("12. Debounce")
	opts = &flashq.PushOptions{
		DebounceID:  "user-typing",
		DebounceTTL: 500 * time.Millisecond,
	}
	id, _ = client.Push("options-demo", map[string]interface{}{"type": "debounced"}, opts)
	fmt.Printf("   Pushed job %d with debounce_id='user-typing', debounce_ttl=500ms\n\n", id)

	// 13. Stall timeout
	fmt.Println("13. Stall timeout")
	opts = &flashq.PushOptions{StallTimeout: 60 * time.Second}
	id, _ = client.Push("options-demo", map[string]interface{}{"type": "stall-monitored"}, opts)
	fmt.Printf("   Pushed job %d with stall_timeout=60s\n\n", id)

	// Summary
	fmt.Println("=== Summary ===")
	counts, _ := client.GetJobCounts("options-demo")
	fmt.Printf("Total jobs: %v\n", counts)

	fmt.Println("\nDone!")
}
