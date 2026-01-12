package flashq

import (
	"encoding/json"
	"time"
)

// JobState represents the state of a job
type JobState string

const (
	JobStateWaiting         JobState = "waiting"
	JobStateDelayed         JobState = "delayed"
	JobStateActive          JobState = "active"
	JobStateCompleted       JobState = "completed"
	JobStateFailed          JobState = "failed"
	JobStateWaitingChildren JobState = "waiting-children"
)

// ParseJobState converts string to JobState, handling server variations
func ParseJobState(s string) JobState {
	if s == "waitingchildren" {
		return JobStateWaitingChildren
	}
	return JobState(s)
}

// Job represents a job in the queue
type Job struct {
	ID          int64           `json:"id"`
	Queue       string          `json:"queue"`
	Data        json.RawMessage `json:"data"`
	Priority    int             `json:"priority"`
	CreatedAt   int64           `json:"created_at"`
	RunAt       int64           `json:"run_at"`
	StartedAt   int64           `json:"started_at"`
	Attempts    int             `json:"attempts"`
	MaxAttempts int             `json:"max_attempts"`
	Backoff     int             `json:"backoff"`
	TTL         int64           `json:"ttl"`
	Timeout     int64           `json:"timeout"`
	UniqueKey   string          `json:"unique_key,omitempty"`
	DependsOn   []int64         `json:"depends_on,omitempty"`
	Progress    int             `json:"progress"`
	ProgressMsg string          `json:"progress_msg,omitempty"`
	Tags        []string        `json:"tags,omitempty"`
}

// GetData unmarshals job data into the provided type
func (j *Job) GetData(v interface{}) error {
	return json.Unmarshal(j.Data, v)
}

// PushOptions contains options for pushing a job
type PushOptions struct {
	Priority    int      `json:"priority,omitempty"`
	Delay       int64    `json:"delay,omitempty"`
	TTL         int64    `json:"ttl,omitempty"`
	Timeout     int64    `json:"timeout,omitempty"`
	MaxAttempts int      `json:"max_attempts,omitempty"`
	Backoff     int      `json:"backoff,omitempty"`
	UniqueKey   string   `json:"unique_key,omitempty"`
	DependsOn   []int64  `json:"depends_on,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

// CronOptions contains options for creating a cron job
type CronOptions struct {
	Queue    string      `json:"queue"`
	Data     interface{} `json:"data"`
	Schedule string      `json:"schedule"`
	Priority int         `json:"priority,omitempty"`
}

// QueueInfo contains information about a queue
type QueueInfo struct {
	Name             string `json:"name"`
	Pending          int    `json:"pending"`
	Processing       int    `json:"processing"`
	DLQ              int    `json:"dlq"`
	Paused           bool   `json:"paused"`
	RateLimit        *int   `json:"rate_limit,omitempty"`
	ConcurrencyLimit *int   `json:"concurrency_limit,omitempty"`
}

// QueueStats contains queue statistics
type QueueStats struct {
	Queued     int `json:"queued"`
	Processing int `json:"processing"`
	Delayed    int `json:"delayed"`
	DLQ        int `json:"dlq"`
}

// Metrics contains detailed metrics
type Metrics struct {
	TotalPushed    int64   `json:"total_pushed"`
	TotalCompleted int64   `json:"total_completed"`
	TotalFailed    int64   `json:"total_failed"`
	JobsPerSecond  float64 `json:"jobs_per_second"`
	AvgLatencyMs   float64 `json:"avg_latency_ms"`
	Queues         []struct {
		Name       string `json:"name"`
		Pending    int    `json:"pending"`
		Processing int    `json:"processing"`
		DLQ        int    `json:"dlq"`
		RateLimit  *int   `json:"rate_limit,omitempty"`
	} `json:"queues,omitempty"`
}

// CronJob contains cron job information
type CronJob struct {
	Name     string          `json:"name"`
	Queue    string          `json:"queue"`
	Data     json.RawMessage `json:"data"`
	Schedule string          `json:"schedule"`
	Priority int             `json:"priority"`
	NextRun  int64           `json:"next_run"`
}

// Progress contains job progress information
type Progress struct {
	Progress int    `json:"progress"`
	Message  string `json:"message,omitempty"`
}

// ClientOptions contains client configuration
type ClientOptions struct {
	Host    string
	Port    int
	Token   string
	Timeout time.Duration
}

// DefaultOptions returns default client options
func DefaultOptions() ClientOptions {
	return ClientOptions{
		Host:    "localhost",
		Port:    6789,
		Timeout: 5 * time.Second,
	}
}
