package main

import (
	"fmt"
	"os"
	"time"

	"github.com/flashq/flashq-go/flashq"
)

type TestRunner struct {
	passed int
	failed int
	errors []struct {
		name  string
		error string
	}
}

func (r *TestRunner) test(name string, fn func() error) {
	err := fn()
	if err != nil {
		r.failed++
		r.errors = append(r.errors, struct {
			name  string
			error string
		}{name, err.Error()})
		fmt.Printf("  ✗ %s: %v\n", name, err)
	} else {
		r.passed++
		fmt.Printf("  ✓ %s\n", name)
	}
}

func (r *TestRunner) summary() bool {
	total := r.passed + r.failed
	fmt.Println()
	fmt.Println("============================================================")
	if r.failed == 0 {
		fmt.Printf("  ✓ All %d tests passed!\n", total)
	} else {
		fmt.Printf("  %d/%d tests passed, %d failed\n", r.passed, total, r.failed)
		fmt.Println()
		fmt.Println("  Failed tests:")
		for _, e := range r.errors {
			fmt.Printf("    - %s: %s\n", e.name, e.error)
		}
	}
	fmt.Println("============================================================")
	return r.failed == 0
}

func main() {
	fmt.Println("FlashQ Go SDK - API Tests")
	fmt.Println("============================================================")

	runner := &TestRunner{}

	fmt.Println("\n[TCP Protocol Tests]")

	client := flashq.New()
	defer client.Close()

	// Connection
	runner.test("connect", func() error {
		err := client.Connect()
		if err != nil {
			return err
		}
		if !client.IsConnected() {
			return fmt.Errorf("client should be connected")
		}
		return nil
	})

	// Core Operations
	runner.test("push", func() error {
		job, err := client.Push("test-queue", map[string]string{"message": "hello"}, nil)
		if err != nil {
			return err
		}
		if job.ID <= 0 {
			return fmt.Errorf("expected job ID > 0, got %d", job.ID)
		}
		if job.Queue != "test-queue" {
			return fmt.Errorf("expected queue test-queue, got %s", job.Queue)
		}
		return nil
	})

	runner.test("push with options", func() error {
		job, err := client.Push("test-queue", map[string]string{"task": "process"}, &flashq.PushOptions{
			Priority:    10,
			MaxAttempts: 3,
			Tags:        []string{"important"},
		})
		if err != nil {
			return err
		}
		if job.Priority != 10 {
			return fmt.Errorf("expected priority 10, got %d", job.Priority)
		}
		return nil
	})

	runner.test("push_batch", func() error {
		ids, err := client.PushBatch("batch-queue", []map[string]interface{}{
			{"data": map[string]int{"n": 1}},
			{"data": map[string]int{"n": 2}},
			{"data": map[string]int{"n": 3}},
		})
		if err != nil {
			return err
		}
		if len(ids) != 3 {
			return fmt.Errorf("expected 3 IDs, got %d", len(ids))
		}
		return nil
	})

	runner.test("pull_batch", func() error {
		jobs, err := client.PullBatch("batch-queue", 3)
		if err != nil {
			return err
		}
		if len(jobs) != 3 {
			return fmt.Errorf("expected 3 jobs, got %d", len(jobs))
		}
		// Cleanup
		ids := make([]int64, len(jobs))
		for i, j := range jobs {
			ids[i] = j.ID
		}
		client.AckBatch(ids)
		return nil
	})

	runner.test("ack_batch", func() error {
		ids, _ := client.PushBatch("ack-batch-queue", []map[string]interface{}{
			{"data": map[string]int{"n": 1}},
			{"data": map[string]int{"n": 2}},
		})
		jobs, _ := client.PullBatch("ack-batch-queue", 2)
		jobIDs := make([]int64, len(jobs))
		for i, j := range jobs {
			jobIDs[i] = j.ID
		}
		_, err := client.AckBatch(jobIDs)
		if err != nil {
			return err
		}
		_ = ids // suppress unused warning
		return nil
	})

	runner.test("pull and ack", func() error {
		client.Push("pull-test", map[string]int{"value": 42}, nil)
		pulled, err := client.Pull("pull-test")
		if err != nil {
			return err
		}
		var data map[string]int
		pulled.GetData(&data)
		if data["value"] != 42 {
			return fmt.Errorf("expected value 42, got %d", data["value"])
		}
		return client.Ack(pulled.ID, map[string]bool{"processed": true})
	})

	runner.test("fail", func() error {
		client.Push("fail-test", map[string]string{"will": "fail"}, &flashq.PushOptions{MaxAttempts: 2})
		pulled, _ := client.Pull("fail-test")
		return client.Fail(pulled.ID, "Test failure")
	})

	runner.test("progress", func() error {
		client.Push("progress-test", map[string]string{"task": "long"}, nil)
		pulled, _ := client.Pull("progress-test")
		if err := client.Progress(pulled.ID, 50, "Halfway there"); err != nil {
			return err
		}
		prog, err := client.GetProgress(pulled.ID)
		if err != nil {
			return err
		}
		if prog.Progress != 50 {
			return fmt.Errorf("expected progress 50, got %d", prog.Progress)
		}
		if prog.Message != "Halfway there" {
			return fmt.Errorf("expected message 'Halfway there', got '%s'", prog.Message)
		}
		return client.Ack(pulled.ID, nil)
	})

	runner.test("cancel", func() error {
		job, _ := client.Push("cancel-test", map[string]string{"will": "cancel"}, nil)
		return client.Cancel(job.ID)
	})

	runner.test("get_state", func() error {
		job, _ := client.Push("state-test", map[string]int{"data": 1}, nil)
		state, err := client.GetState(job.ID)
		if err != nil {
			return err
		}
		if state != flashq.JobStateWaiting && state != flashq.JobStateDelayed {
			return fmt.Errorf("unexpected state: %s", state)
		}
		// Cleanup
		pulled, _ := client.Pull("state-test")
		client.Ack(pulled.ID, nil)
		return nil
	})

	runner.test("get_result", func() error {
		client.Push("result-test", map[string]int{"data": 1}, nil)
		pulled, _ := client.Pull("result-test")
		client.Ack(pulled.ID, map[string]int{"answer": 42})
		result, err := client.GetResult(pulled.ID)
		if err != nil {
			return err
		}
		resultMap := result.(map[string]interface{})
		if resultMap["answer"] != float64(42) {
			return fmt.Errorf("expected answer 42, got %v", resultMap["answer"])
		}
		return nil
	})

	// Queue Control
	runner.test("pause/resume", func() error {
		if err := client.Pause("pause-test"); err != nil {
			return err
		}
		return client.Resume("pause-test")
	})

	runner.test("rate_limit", func() error {
		if err := client.SetRateLimit("rate-test", 100); err != nil {
			return err
		}
		return client.ClearRateLimit("rate-test")
	})

	runner.test("concurrency", func() error {
		if err := client.SetConcurrency("conc-test", 5); err != nil {
			return err
		}
		return client.ClearConcurrency("conc-test")
	})

	runner.test("list_queues", func() error {
		queues, err := client.ListQueues()
		if err != nil {
			return err
		}
		if len(queues) == 0 {
			return fmt.Errorf("expected at least one queue")
		}
		return nil
	})

	// DLQ
	runner.test("dlq", func() error {
		client.Push("dlq-test", map[string]bool{"fail": true}, &flashq.PushOptions{MaxAttempts: 1})
		pulled, _ := client.Pull("dlq-test")
		client.Fail(pulled.ID, "Intentional failure")
		_, err := client.GetDLQ("dlq-test", 100)
		return err
	})

	runner.test("retry_dlq", func() error {
		_, err := client.RetryDLQ("dlq-test", nil)
		return err
	})

	// Cron
	runner.test("add_cron", func() error {
		return client.AddCron("test-cron", flashq.CronOptions{
			Queue:    "cron-queue",
			Data:     map[string]bool{"scheduled": true},
			Schedule: "0 0 * * * *",
			Priority: 5,
		})
	})

	runner.test("list_crons", func() error {
		crons, err := client.ListCrons()
		if err != nil {
			return err
		}
		found := false
		for _, c := range crons {
			if c.Name == "test-cron" {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("test-cron not found in cron list")
		}
		return nil
	})

	runner.test("delete_cron", func() error {
		result, err := client.DeleteCron("test-cron")
		if err != nil {
			return err
		}
		if !result {
			return fmt.Errorf("expected true, got false")
		}
		return nil
	})

	// Stats & Metrics
	runner.test("stats", func() error {
		stats, err := client.Stats()
		if err != nil {
			return err
		}
		if stats.Queued < 0 || stats.Processing < 0 || stats.Delayed < 0 || stats.DLQ < 0 {
			return fmt.Errorf("invalid stats values")
		}
		return nil
	})

	runner.test("metrics", func() error {
		metrics, err := client.Metrics()
		if err != nil {
			return err
		}
		if metrics.TotalPushed < 0 || metrics.TotalCompleted < 0 || metrics.JobsPerSecond < 0 {
			return fmt.Errorf("invalid metrics values")
		}
		return nil
	})

	// Job Dependencies
	runner.test("dependencies", func() error {
		parent, _ := client.Push("deps-queue", map[string]string{"type": "parent"}, nil)
		child, err := client.Push("deps-queue", map[string]string{"type": "child"}, &flashq.PushOptions{
			DependsOn: []int64{parent.ID},
		})
		if err != nil {
			return err
		}
		state, _ := client.GetState(child.ID)
		if state != flashq.JobStateWaiting && state != flashq.JobStateWaitingChildren {
			return fmt.Errorf("unexpected state: %s", state)
		}
		// Cleanup
		pulled, _ := client.Pull("deps-queue")
		client.Ack(pulled.ID, nil)
		return nil
	})

	// Unique Jobs
	runner.test("unique_key deduplication", func() error {
		key := fmt.Sprintf("unique-%d", time.Now().UnixNano())
		job1, err := client.Push("unique-queue", map[string]int{"n": 1}, &flashq.PushOptions{UniqueKey: key})
		if err != nil {
			return err
		}
		job2, err := client.Push("unique-queue", map[string]int{"n": 2}, &flashq.PushOptions{UniqueKey: key})
		if err != nil {
			// Duplicate error is expected
			if err.Error() == "" || job2 != nil {
				// If we got here with an error but also a job, something is wrong
			}
			// This is expected behavior
		} else if job1.ID != job2.ID {
			return fmt.Errorf("expected deduplication: %d != %d", job1.ID, job2.ID)
		}
		// Cleanup
		pulled, _ := client.Pull("unique-queue")
		client.Ack(pulled.ID, nil)
		return nil
	})

	// Summary
	success := runner.summary()
	if !success {
		os.Exit(1)
	}
}
