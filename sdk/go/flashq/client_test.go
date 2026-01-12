package flashq

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConnection(t *testing.T) {
	client := New()
	err := client.Connect()
	require.NoError(t, err)
	assert.True(t, client.IsConnected())
	client.Close()
}

func TestPush(t *testing.T) {
	client := New()
	defer client.Close()

	job, err := client.Push("test-queue", map[string]string{"message": "hello"}, nil)
	require.NoError(t, err)
	assert.Greater(t, job.ID, int64(0))
	assert.Equal(t, "test-queue", job.Queue)

	// Cleanup
	pulled, _ := client.Pull("test-queue")
	client.Ack(pulled.ID, nil)
}

func TestPushWithOptions(t *testing.T) {
	client := New()
	defer client.Close()

	job, err := client.Push("test-queue", map[string]string{"task": "process"}, &PushOptions{
		Priority:    10,
		MaxAttempts: 3,
		Tags:        []string{"important"},
	})
	require.NoError(t, err)
	assert.Equal(t, 10, job.Priority)

	// Cleanup
	pulled, _ := client.Pull("test-queue")
	client.Ack(pulled.ID, nil)
}

func TestPushBatch(t *testing.T) {
	client := New()
	defer client.Close()

	ids, err := client.PushBatch("batch-queue", []map[string]interface{}{
		{"data": map[string]int{"n": 1}},
		{"data": map[string]int{"n": 2}},
		{"data": map[string]int{"n": 3}},
	})
	require.NoError(t, err)
	assert.Len(t, ids, 3)

	// Cleanup
	jobs, _ := client.PullBatch("batch-queue", 3)
	jobIDs := make([]int64, len(jobs))
	for i, j := range jobs {
		jobIDs[i] = j.ID
	}
	client.AckBatch(jobIDs)
}

func TestPullBatch(t *testing.T) {
	client := New()
	defer client.Close()

	// Push first
	client.PushBatch("pullb-queue", []map[string]interface{}{
		{"data": map[string]int{"n": 1}},
		{"data": map[string]int{"n": 2}},
	})

	jobs, err := client.PullBatch("pullb-queue", 2)
	require.NoError(t, err)
	assert.Len(t, jobs, 2)

	// Cleanup
	jobIDs := make([]int64, len(jobs))
	for i, j := range jobs {
		jobIDs[i] = j.ID
	}
	client.AckBatch(jobIDs)
}

func TestPullAndAck(t *testing.T) {
	client := New()
	defer client.Close()

	client.Push("pull-test", map[string]int{"value": 42}, nil)
	pulled, err := client.Pull("pull-test")
	require.NoError(t, err)

	var data map[string]int
	pulled.GetData(&data)
	assert.Equal(t, 42, data["value"])

	err = client.Ack(pulled.ID, map[string]bool{"processed": true})
	assert.NoError(t, err)
}

func TestFail(t *testing.T) {
	client := New()
	defer client.Close()

	client.Push("fail-test", map[string]string{"will": "fail"}, &PushOptions{MaxAttempts: 2})
	pulled, _ := client.Pull("fail-test")
	err := client.Fail(pulled.ID, "Test failure")
	assert.NoError(t, err)
}

func TestProgress(t *testing.T) {
	client := New()
	defer client.Close()

	client.Push("progress-test", map[string]string{"task": "long"}, nil)
	pulled, _ := client.Pull("progress-test")

	err := client.Progress(pulled.ID, 50, "Halfway there")
	require.NoError(t, err)

	prog, err := client.GetProgress(pulled.ID)
	require.NoError(t, err)
	assert.Equal(t, 50, prog.Progress)
	assert.Equal(t, "Halfway there", prog.Message)

	client.Ack(pulled.ID, nil)
}

func TestCancel(t *testing.T) {
	client := New()
	defer client.Close()

	job, _ := client.Push("cancel-test", map[string]string{"will": "cancel"}, nil)
	err := client.Cancel(job.ID)
	assert.NoError(t, err)
}

func TestGetState(t *testing.T) {
	client := New()
	defer client.Close()

	job, _ := client.Push("state-test", map[string]int{"data": 1}, nil)
	state, err := client.GetState(job.ID)
	require.NoError(t, err)
	assert.Contains(t, []JobState{JobStateWaiting, JobStateDelayed}, state)

	// Cleanup
	pulled, _ := client.Pull("state-test")
	client.Ack(pulled.ID, nil)
}

func TestGetResult(t *testing.T) {
	client := New()
	defer client.Close()

	client.Push("result-test", map[string]int{"data": 1}, nil)
	pulled, _ := client.Pull("result-test")
	client.Ack(pulled.ID, map[string]int{"answer": 42})

	result, err := client.GetResult(pulled.ID)
	require.NoError(t, err)
	resultMap := result.(map[string]interface{})
	assert.Equal(t, float64(42), resultMap["answer"])
}

func TestPauseResume(t *testing.T) {
	client := New()
	defer client.Close()

	err := client.Pause("pause-test")
	assert.NoError(t, err)
	err = client.Resume("pause-test")
	assert.NoError(t, err)
}

func TestRateLimit(t *testing.T) {
	client := New()
	defer client.Close()

	err := client.SetRateLimit("rate-test", 100)
	assert.NoError(t, err)
	err = client.ClearRateLimit("rate-test")
	assert.NoError(t, err)
}

func TestConcurrency(t *testing.T) {
	client := New()
	defer client.Close()

	err := client.SetConcurrency("conc-test", 5)
	assert.NoError(t, err)
	err = client.ClearConcurrency("conc-test")
	assert.NoError(t, err)
}

func TestListQueues(t *testing.T) {
	client := New()
	defer client.Close()

	// Create a queue first
	client.Push("list-test", map[string]int{"n": 1}, nil)

	queues, err := client.ListQueues()
	require.NoError(t, err)
	assert.Greater(t, len(queues), 0)

	// Cleanup
	pulled, _ := client.Pull("list-test")
	client.Ack(pulled.ID, nil)
}

func TestDLQ(t *testing.T) {
	client := New()
	defer client.Close()

	client.Push("dlq-test", map[string]bool{"fail": true}, &PushOptions{MaxAttempts: 1})
	pulled, _ := client.Pull("dlq-test")
	client.Fail(pulled.ID, "Intentional failure")

	dlqJobs, err := client.GetDLQ("dlq-test", 100)
	require.NoError(t, err)
	assert.IsType(t, []*Job{}, dlqJobs)
}

func TestRetryDLQ(t *testing.T) {
	client := New()
	defer client.Close()

	count, err := client.RetryDLQ("dlq-test", nil)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, count, 0)
}

func TestAddCron(t *testing.T) {
	client := New()
	defer client.Close()

	err := client.AddCron("test-cron", CronOptions{
		Queue:    "cron-queue",
		Data:     map[string]bool{"scheduled": true},
		Schedule: "0 0 * * * *",
		Priority: 5,
	})
	assert.NoError(t, err)
}

func TestListCrons(t *testing.T) {
	client := New()
	defer client.Close()

	crons, err := client.ListCrons()
	require.NoError(t, err)

	found := false
	for _, c := range crons {
		if c.Name == "test-cron" {
			found = true
			break
		}
	}
	assert.True(t, found, "test-cron not found in cron list")
}

func TestDeleteCron(t *testing.T) {
	client := New()
	defer client.Close()

	result, err := client.DeleteCron("test-cron")
	require.NoError(t, err)
	assert.True(t, result)
}

func TestStats(t *testing.T) {
	client := New()
	defer client.Close()

	stats, err := client.Stats()
	require.NoError(t, err)
	assert.GreaterOrEqual(t, stats.Queued, 0)
	assert.GreaterOrEqual(t, stats.Processing, 0)
	assert.GreaterOrEqual(t, stats.Delayed, 0)
	assert.GreaterOrEqual(t, stats.DLQ, 0)
}

func TestMetrics(t *testing.T) {
	client := New()
	defer client.Close()

	metrics, err := client.Metrics()
	require.NoError(t, err)
	assert.GreaterOrEqual(t, metrics.TotalPushed, int64(0))
	assert.GreaterOrEqual(t, metrics.TotalCompleted, int64(0))
	assert.GreaterOrEqual(t, metrics.JobsPerSecond, float64(0))
}

func TestDependencies(t *testing.T) {
	client := New()
	defer client.Close()

	parent, _ := client.Push("deps-queue", map[string]string{"type": "parent"}, nil)
	child, err := client.Push("deps-queue", map[string]string{"type": "child"}, &PushOptions{
		DependsOn: []int64{parent.ID},
	})
	require.NoError(t, err)

	state, _ := client.GetState(child.ID)
	assert.Contains(t, []JobState{JobStateWaiting, JobStateWaitingChildren}, state)

	// Cleanup
	pulled, _ := client.Pull("deps-queue")
	client.Ack(pulled.ID, nil)
}

func TestUniqueKey(t *testing.T) {
	client := New()
	defer client.Close()

	key := fmt.Sprintf("unique-%d", time.Now().UnixNano())
	job1, err := client.Push("unique-queue", map[string]int{"n": 1}, &PushOptions{UniqueKey: key})
	require.NoError(t, err)

	job2, err := client.Push("unique-queue", map[string]int{"n": 2}, &PushOptions{UniqueKey: key})
	if err != nil {
		// Duplicate error is expected
		assert.Contains(t, err.Error(), "Duplicate")
	} else {
		assert.Equal(t, job1.ID, job2.ID)
	}

	// Cleanup
	pulled, _ := client.Pull("unique-queue")
	client.Ack(pulled.ID, nil)
}
