// Package flashq provides a high-performance Go client for flashQ job queue.
package flashq

import (
	"time"
)

// Version is the SDK version.
const Version = "0.4.0"

// JobState represents the state of a job.
type JobState string

const (
	JobStateWaiting         JobState = "waiting"
	JobStateDelayed         JobState = "delayed"
	JobStateActive          JobState = "active"
	JobStateCompleted       JobState = "completed"
	JobStateFailed          JobState = "failed"
	JobStateWaitingChildren JobState = "waiting-children"
)

// LogLevel represents log level.
type LogLevel int

const (
	LogLevelTrace LogLevel = iota
	LogLevelDebug
	LogLevelInfo
	LogLevelWarn
	LogLevelError
	LogLevelSilent
)

// WorkerState represents the state of a worker.
type WorkerState int

const (
	WorkerStateIdle WorkerState = iota
	WorkerStateStarting
	WorkerStateRunning
	WorkerStateStopping
	WorkerStateStopped
)

func (s WorkerState) String() string {
	switch s {
	case WorkerStateIdle:
		return "idle"
	case WorkerStateStarting:
		return "starting"
	case WorkerStateRunning:
		return "running"
	case WorkerStateStopping:
		return "stopping"
	case WorkerStateStopped:
		return "stopped"
	default:
		return "unknown"
	}
}

// ClientOptions configures the flashQ client.
type ClientOptions struct {
	Host               string
	Port               int
	HTTPPort           int
	Timeout            time.Duration
	ConnectTimeout     time.Duration
	Token              string
	UseHTTP            bool
	UseBinary          bool
	AutoReconnect      bool
	ReconnectDelay     time.Duration
	MaxReconnectDelay  time.Duration
	MaxReconnectAttempts int
	LogLevel           LogLevel
	PoolSize           int // Connection pool size (default: 4)
}

// DefaultClientOptions returns default client options.
func DefaultClientOptions() ClientOptions {
	return ClientOptions{
		Host:               "localhost",
		Port:               6789,
		HTTPPort:           6790,
		Timeout:            5 * time.Second,
		ConnectTimeout:     5 * time.Second,
		UseHTTP:            false,
		UseBinary:          false,
		AutoReconnect:      true,
		ReconnectDelay:     1 * time.Second,
		MaxReconnectDelay:  30 * time.Second,
		MaxReconnectAttempts: 10,
		LogLevel:           LogLevelInfo,
		PoolSize:           4,
	}
}

// PushOptions configures job push options.
type PushOptions struct {
	Priority           int
	Delay              time.Duration
	TTL                time.Duration
	Timeout            time.Duration
	MaxAttempts        int
	Backoff            time.Duration
	UniqueKey          string
	DependsOn          []int64
	Tags               []string
	LIFO               bool
	StallTimeout       time.Duration
	DebounceID         string
	DebounceTTL        time.Duration
	JobID              string
	KeepCompletedAge   time.Duration
	KeepCompletedCount int
	GroupID            string
}

// DefaultPushOptions returns default push options.
func DefaultPushOptions() PushOptions {
	return PushOptions{
		MaxAttempts: 3,
		Backoff:     1 * time.Second,
	}
}

// ToMap converts PushOptions to a map for serialization.
func (o PushOptions) ToMap() map[string]interface{} {
	m := make(map[string]interface{})
	if o.Priority != 0 {
		m["priority"] = o.Priority
	}
	if o.Delay > 0 {
		m["delay"] = int64(o.Delay.Milliseconds())
	}
	if o.TTL > 0 {
		m["ttl"] = int64(o.TTL.Milliseconds())
	}
	if o.Timeout > 0 {
		m["timeout"] = int64(o.Timeout.Milliseconds())
	}
	if o.MaxAttempts != 3 {
		m["max_attempts"] = o.MaxAttempts
	}
	if o.Backoff != 1*time.Second && o.Backoff > 0 {
		m["backoff"] = int64(o.Backoff.Milliseconds())
	}
	if o.UniqueKey != "" {
		m["unique_key"] = o.UniqueKey
	}
	if len(o.DependsOn) > 0 {
		m["depends_on"] = o.DependsOn
	}
	if len(o.Tags) > 0 {
		m["tags"] = o.Tags
	}
	if o.LIFO {
		m["lifo"] = true
	}
	if o.StallTimeout > 0 {
		m["stall_timeout"] = int64(o.StallTimeout.Milliseconds())
	}
	if o.DebounceID != "" {
		m["debounce_id"] = o.DebounceID
	}
	if o.DebounceTTL > 0 {
		m["debounce_ttl"] = int64(o.DebounceTTL.Milliseconds())
	}
	if o.JobID != "" {
		m["jobId"] = o.JobID
	}
	if o.KeepCompletedAge > 0 {
		m["keepCompletedAge"] = int64(o.KeepCompletedAge.Milliseconds())
	}
	if o.KeepCompletedCount > 0 {
		m["keepCompletedCount"] = o.KeepCompletedCount
	}
	if o.GroupID != "" {
		m["group_id"] = o.GroupID
	}
	return m
}

// Job represents a job in the queue.
type Job struct {
	ID              int64                  `json:"id"`
	Queue           string                 `json:"queue"`
	Data            interface{}            `json:"data"`
	Priority        int                    `json:"priority"`
	Attempts        int                    `json:"attempts"`
	MaxAttempts     int                    `json:"max_attempts"`
	CreatedAt       *time.Time             `json:"created_at,omitempty"`
	RunAt           *time.Time             `json:"run_at,omitempty"`
	StartedAt       *time.Time             `json:"started_at,omitempty"`
	CompletedAt     *time.Time             `json:"completed_at,omitempty"`
	State           JobState               `json:"state"`
	Result          interface{}            `json:"result,omitempty"`
	Error           string                 `json:"error,omitempty"`
	Progress        int                    `json:"progress"`
	ProgressMessage string                 `json:"progress_message,omitempty"`
	Tags            []string               `json:"tags,omitempty"`
	CustomID        string                 `json:"custom_id,omitempty"`
	ParentID        int64                  `json:"parent_id,omitempty"`
}

// JobFromMap creates a Job from a map response.
func JobFromMap(m map[string]interface{}) *Job {
	j := &Job{
		State:       JobStateWaiting,
		MaxAttempts: 3,
	}

	if id, ok := m["id"].(float64); ok {
		j.ID = int64(id)
	}
	if queue, ok := m["queue"].(string); ok {
		j.Queue = queue
	}
	if data, ok := m["data"]; ok {
		j.Data = data
	}
	if priority, ok := m["priority"].(float64); ok {
		j.Priority = int(priority)
	}
	if attempts, ok := m["attempts"].(float64); ok {
		j.Attempts = int(attempts)
	}
	if maxAttempts, ok := m["max_attempts"].(float64); ok {
		j.MaxAttempts = int(maxAttempts)
	}
	if state, ok := m["state"].(string); ok {
		j.State = JobState(state)
	}
	if result, ok := m["result"]; ok {
		j.Result = result
	}
	if errMsg, ok := m["error"].(string); ok {
		j.Error = errMsg
	}
	if progress, ok := m["progress"].(float64); ok {
		j.Progress = int(progress)
	}
	if msg, ok := m["progress_message"].(string); ok {
		j.ProgressMessage = msg
	}
	if customID, ok := m["custom_id"].(string); ok {
		j.CustomID = customID
	}
	if parentID, ok := m["parent_id"].(float64); ok {
		j.ParentID = int64(parentID)
	}
	if tags, ok := m["tags"].([]interface{}); ok {
		j.Tags = make([]string, len(tags))
		for i, t := range tags {
			if s, ok := t.(string); ok {
				j.Tags[i] = s
			}
		}
	}

	// Parse timestamps
	j.CreatedAt = parseTimestamp(m["created_at"])
	j.RunAt = parseTimestamp(m["run_at"])
	j.StartedAt = parseTimestamp(m["started_at"])
	j.CompletedAt = parseTimestamp(m["completed_at"])

	return j
}

func parseTimestamp(v interface{}) *time.Time {
	if v == nil { return nil }
	switch t := v.(type) {
	case float64: ts := time.UnixMilli(int64(t)); return &ts
	case int64: ts := time.UnixMilli(t); return &ts
	case string: if p, err := time.Parse(time.RFC3339, t); err == nil { return &p }
	}
	return nil
}

// BatchPushResult represents the result of a batch push operation.
type BatchPushResult struct {
	Success bool    `json:"success"`
	JobIDs  []int64 `json:"job_ids"`
	Failed  []map[string]interface{} `json:"failed,omitempty"`
}

// QueueStats represents queue statistics.
type QueueStats struct {
	Waiting   int  `json:"waiting"`
	Active    int  `json:"active"`
	Completed int  `json:"completed"`
	Failed    int  `json:"failed"`
	Delayed   int  `json:"delayed"`
	Paused    bool `json:"paused"`
}

// CronJob represents a cron job definition.
type CronJob struct {
	Name     string      `json:"name"`
	Queue    string      `json:"queue"`
	Schedule string      `json:"schedule"`
	Data     interface{} `json:"data,omitempty"`
}

// FlowChild represents a child job in a flow.
type FlowChild struct {
	Queue   string
	Data    interface{}
	Options *PushOptions
}

// FlowResult represents the result of pushing a flow.
type FlowResult struct {
	ParentID    int64
	ChildrenIDs []int64
}

// WorkerOptions configures a worker.
type WorkerOptions struct {
	Concurrency  int
	BatchSize    int
	AutoStart    bool
	CloseTimeout time.Duration
	StallTimeout time.Duration
	LogLevel     LogLevel
}

// DefaultWorkerOptions returns default worker options.
func DefaultWorkerOptions() WorkerOptions {
	return WorkerOptions{
		Concurrency:  1,
		BatchSize:    100,
		AutoStart:    true,
		CloseTimeout: 30 * time.Second,
		StallTimeout: 30 * time.Second,
		LogLevel:     LogLevelInfo,
	}
}

// ProgressInfo represents job progress information.
type ProgressInfo struct {
	Progress int
	Message  string
}

// LogEntry represents a job log entry.
type LogEntry struct {
	Message   string    `json:"message"`
	Level     string    `json:"level"`
	Timestamp time.Time `json:"timestamp"`
}
