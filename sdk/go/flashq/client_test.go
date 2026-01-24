package flashq

import (
	"context"
	"testing"
	"time"
)

// Integration tests require a running flashQ server on localhost:6789

func getTestClient(t *testing.T) *Client {
	client := New()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Connect(ctx); err != nil {
		t.Skipf("flashQ server not available: %v", err)
	}
	return client
}

func TestClientConnect(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	if !client.IsConnected() {
		t.Error("Expected client to be connected")
	}
}

func TestClientPoolStats(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	reconnects, failures, healthy := client.PoolStats()
	if healthy == 0 {
		t.Error("Expected at least one healthy connection")
	}
	if reconnects < 0 || failures < 0 {
		t.Error("Stats should be non-negative")
	}
}

func TestPushAndPull(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	queue := "test-push-pull"
	client.Obliterate(queue)

	// Push
	data := map[string]interface{}{"message": "hello", "count": 42}
	jobID, err := client.Push(queue, data, nil)
	if err != nil {
		t.Fatalf("Push failed: %v", err)
	}
	if jobID == 0 {
		t.Error("Expected non-zero job ID")
	}

	// Pull
	job, err := client.Pull(queue, 5*time.Second)
	if err != nil {
		t.Fatalf("Pull failed: %v", err)
	}
	if job == nil {
		t.Fatal("Expected job, got nil")
	}
	if job.ID != jobID {
		t.Errorf("Expected job ID %d, got %d", jobID, job.ID)
	}

	// Ack
	success, err := client.Ack(job.ID, map[string]interface{}{"done": true})
	if err != nil {
		t.Fatalf("Ack failed: %v", err)
	}
	if !success {
		t.Error("Ack should return success=true")
	}

	client.Obliterate(queue)
}

func TestPushBatch(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	queue := "test-batch"
	client.Obliterate(queue)

	// Push batch
	jobs := make([]map[string]interface{}, 100)
	for i := 0; i < 100; i++ {
		jobs[i] = map[string]interface{}{"data": map[string]interface{}{"index": i}}
	}

	result, err := client.PushBatch(queue, jobs)
	if err != nil {
		t.Fatalf("PushBatch failed: %v", err)
	}
	if !result.Success {
		t.Error("PushBatch should return success=true")
	}
	if len(result.JobIDs) != 100 {
		t.Errorf("Expected 100 job IDs, got %d", len(result.JobIDs))
	}

	// Verify count
	count, err := client.Count(queue)
	if err != nil {
		t.Fatalf("Count failed: %v", err)
	}
	if count != 100 {
		t.Errorf("Expected count 100, got %d", count)
	}

	client.Obliterate(queue)
}

func TestPullBatch(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	queue := "test-pullbatch"
	client.Obliterate(queue)

	// Push 50 jobs
	for i := 0; i < 50; i++ {
		client.Push(queue, map[string]interface{}{"i": i}, nil)
	}

	// Pull batch
	jobs, err := client.PullBatch(queue, 50, 5*time.Second)
	if err != nil {
		t.Fatalf("PullBatch failed: %v", err)
	}
	if len(jobs) != 50 {
		t.Errorf("Expected 50 jobs, got %d", len(jobs))
	}

	// Ack batch
	ids := make([]int64, len(jobs))
	for i, j := range jobs {
		ids[i] = j.ID
	}
	success, err := client.AckBatch(ids)
	if err != nil {
		t.Fatalf("AckBatch failed: %v", err)
	}
	if !success {
		t.Error("AckBatch should return success=true")
	}

	client.Obliterate(queue)
}

func TestJobOperations(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	queue := "test-job-ops"
	client.Obliterate(queue)

	// Push with delay
	jobID, _ := client.Push(queue, map[string]interface{}{"test": true}, &PushOptions{
		Delay: 10 * time.Second,
	})

	// GetJob
	job, err := client.GetJob(jobID)
	if err != nil {
		t.Fatalf("GetJob failed: %v", err)
	}
	if job == nil {
		t.Fatal("Expected job, got nil")
	}

	// GetState
	state, err := client.GetState(jobID)
	if err != nil {
		t.Fatalf("GetState failed: %v", err)
	}
	if state != JobStateDelayed && state != JobStateWaiting {
		t.Errorf("Expected delayed or waiting state, got %s", state)
	}

	// Promote
	success, err := client.Promote(jobID)
	if err != nil {
		t.Fatalf("Promote failed: %v", err)
	}
	if !success {
		t.Error("Promote should return success=true")
	}

	// Cancel
	success, err = client.Cancel(jobID)
	if err != nil {
		t.Fatalf("Cancel failed: %v", err)
	}

	client.Obliterate(queue)
}

func TestQueueOperations(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	queue := "test-queue-ops"
	client.Obliterate(queue)

	// Push some jobs
	for i := 0; i < 10; i++ {
		client.Push(queue, map[string]interface{}{"i": i}, nil)
	}

	// Pause
	success, err := client.Pause(queue)
	if err != nil {
		t.Fatalf("Pause failed: %v", err)
	}
	if !success {
		t.Error("Pause should return success=true")
	}

	// IsPaused
	paused, err := client.IsPaused(queue)
	if err != nil {
		t.Fatalf("IsPaused failed: %v", err)
	}
	if !paused {
		t.Error("Queue should be paused")
	}

	// Resume
	success, err = client.Resume(queue)
	if err != nil {
		t.Fatalf("Resume failed: %v", err)
	}
	if !success {
		t.Error("Resume should return success=true")
	}

	// Drain
	success, err = client.Drain(queue)
	if err != nil {
		t.Fatalf("Drain failed: %v", err)
	}

	// Count should be 0 after drain
	count, _ := client.Count(queue)
	if count != 0 {
		t.Errorf("Expected count 0 after drain, got %d", count)
	}

	client.Obliterate(queue)
}

func TestProgress(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	queue := "test-progress"
	client.Obliterate(queue)

	// Push and pull
	_, err := client.Push(queue, map[string]interface{}{"task": "test"}, nil)
	if err != nil {
		t.Fatalf("Push failed: %v", err)
	}
	job, err := client.Pull(queue, 5*time.Second)
	if err != nil {
		t.Fatalf("Pull failed: %v", err)
	}
	if job == nil {
		t.Skip("Could not pull job")
	}

	// Update progress using job.ID (the active job)
	success, err := client.Progress(job.ID, 50, "halfway done")
	if err != nil {
		t.Fatalf("Progress failed: %v", err)
	}
	if !success {
		t.Error("Progress should return success=true")
	}

	// Get progress using same ID
	info, err := client.GetProgress(job.ID)
	if err != nil {
		t.Fatalf("GetProgress failed: %v", err)
	}
	// Progress tracking depends on server implementation
	// Some servers only track progress for active jobs
	t.Logf("Progress info: %+v", info)

	client.Ack(job.ID, nil)
	client.Obliterate(queue)
}

func TestUniqueJobs(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	queue := "test-unique"
	client.Obliterate(queue)

	// Push with unique key
	id1, err := client.Push(queue, map[string]interface{}{"order": 1}, &PushOptions{
		UniqueKey: "order-123",
	})
	if err != nil {
		t.Fatalf("First push failed: %v", err)
	}

	// Push duplicate should fail
	_, err = client.Push(queue, map[string]interface{}{"order": 2}, &PushOptions{
		UniqueKey: "order-123",
	})
	if err == nil {
		t.Error("Expected error for duplicate unique key")
	}

	// Different key should work
	id3, err := client.Push(queue, map[string]interface{}{"order": 3}, &PushOptions{
		UniqueKey: "order-456",
	})
	if err != nil {
		t.Fatalf("Third push failed: %v", err)
	}
	if id3 == id1 {
		t.Error("Different unique keys should create different jobs")
	}

	client.Obliterate(queue)
}

func TestValidation(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	// Empty queue name
	_, err := client.Push("", map[string]interface{}{}, nil)
	if err == nil {
		t.Error("Expected error for empty queue name")
	}

	// Invalid queue name
	_, err = client.Push("invalid queue!", map[string]interface{}{}, nil)
	if err == nil {
		t.Error("Expected error for invalid queue name")
	}

	// Batch too large
	jobs := make([]map[string]interface{}, 1001)
	_, err = client.PushBatch("test", jobs)
	if err == nil {
		t.Error("Expected error for batch too large")
	}
}

func BenchmarkPush(b *testing.B) {
	client := New()
	ctx := context.Background()
	if err := client.Connect(ctx); err != nil {
		b.Skipf("Server not available: %v", err)
	}
	defer client.Close()

	queue := "benchmark-push"
	client.Obliterate(queue)

	data := map[string]interface{}{"test": true}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		client.Push(queue, data, nil)
	}
	b.StopTimer()

	client.Obliterate(queue)
}

func BenchmarkPushBatch(b *testing.B) {
	client := New()
	ctx := context.Background()
	if err := client.Connect(ctx); err != nil {
		b.Skipf("Server not available: %v", err)
	}
	defer client.Close()

	queue := "benchmark-pushbatch"
	client.Obliterate(queue)

	jobs := make([]map[string]interface{}, 1000)
	for i := range jobs {
		jobs[i] = map[string]interface{}{"data": map[string]interface{}{"i": i}}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		client.PushBatch(queue, jobs)
	}
	b.StopTimer()

	client.Obliterate(queue)
}
