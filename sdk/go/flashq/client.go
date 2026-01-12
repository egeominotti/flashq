package flashq

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"time"
)

// Client is a FlashQ client
type Client struct {
	opts      ClientOptions
	conn      net.Conn
	reader    *bufio.Reader
	mu        sync.Mutex
	connected bool
}

// New creates a new FlashQ client with default options
func New() *Client {
	return NewWithOptions(DefaultOptions())
}

// NewWithOptions creates a new FlashQ client with custom options
func NewWithOptions(opts ClientOptions) *Client {
	if opts.Host == "" {
		opts.Host = "localhost"
	}
	if opts.Port == 0 {
		opts.Port = 6789
	}
	if opts.Timeout == 0 {
		opts.Timeout = 5 * time.Second
	}
	return &Client{opts: opts}
}

// Connect connects to the FlashQ server
func (c *Client) Connect() error {
	if c.connected {
		return nil
	}

	addr := fmt.Sprintf("%s:%d", c.opts.Host, c.opts.Port)
	conn, err := net.DialTimeout("tcp", addr, c.opts.Timeout)
	if err != nil {
		return fmt.Errorf("connection failed: %w", err)
	}

	c.conn = conn
	c.reader = bufio.NewReader(conn)
	c.connected = true

	if c.opts.Token != "" {
		if err := c.Auth(c.opts.Token); err != nil {
			c.Close()
			return err
		}
	}

	return nil
}

// Close closes the connection
func (c *Client) Close() error {
	c.connected = false
	if c.conn != nil {
		err := c.conn.Close()
		c.conn = nil
		c.reader = nil
		return err
	}
	return nil
}

// IsConnected returns true if connected
func (c *Client) IsConnected() bool {
	return c.connected
}

// Auth authenticates with the server
func (c *Client) Auth(token string) error {
	_, err := c.send(map[string]interface{}{
		"cmd":   "AUTH",
		"token": token,
	})
	return err
}

// ============== Core Operations ==============

// Push pushes a job to a queue
func (c *Client) Push(queue string, data interface{}, opts *PushOptions) (*Job, error) {
	cmd := map[string]interface{}{
		"cmd":   "PUSH",
		"queue": queue,
		"data":  data,
	}

	if opts != nil {
		if opts.Priority != 0 {
			cmd["priority"] = opts.Priority
		}
		if opts.Delay != 0 {
			cmd["delay"] = opts.Delay
		}
		if opts.TTL != 0 {
			cmd["ttl"] = opts.TTL
		}
		if opts.Timeout != 0 {
			cmd["timeout"] = opts.Timeout
		}
		if opts.MaxAttempts != 0 {
			cmd["max_attempts"] = opts.MaxAttempts
		}
		if opts.Backoff != 0 {
			cmd["backoff"] = opts.Backoff
		}
		if opts.UniqueKey != "" {
			cmd["unique_key"] = opts.UniqueKey
		}
		if len(opts.DependsOn) > 0 {
			cmd["depends_on"] = opts.DependsOn
		}
		if len(opts.Tags) > 0 {
			cmd["tags"] = opts.Tags
		}
	}

	resp, err := c.send(cmd)
	if err != nil {
		return nil, err
	}

	id, _ := resp["id"].(float64)
	dataBytes, _ := json.Marshal(data)

	job := &Job{
		ID:    int64(id),
		Queue: queue,
		Data:  dataBytes,
	}
	if opts != nil {
		job.Priority = opts.Priority
	}

	return job, nil
}

// PushBatch pushes multiple jobs to a queue
func (c *Client) PushBatch(queue string, jobs []map[string]interface{}) ([]int64, error) {
	resp, err := c.send(map[string]interface{}{
		"cmd":   "PUSHB",
		"queue": queue,
		"jobs":  jobs,
	})
	if err != nil {
		return nil, err
	}

	idsRaw, _ := resp["ids"].([]interface{})
	ids := make([]int64, len(idsRaw))
	for i, id := range idsRaw {
		ids[i] = int64(id.(float64))
	}
	return ids, nil
}

// Pull pulls a job from a queue (blocking)
func (c *Client) Pull(queue string) (*Job, error) {
	resp, err := c.send(map[string]interface{}{
		"cmd":   "PULL",
		"queue": queue,
	})
	if err != nil {
		return nil, err
	}

	jobData, _ := resp["job"].(map[string]interface{})
	return parseJob(jobData), nil
}

// PullBatch pulls multiple jobs from a queue
func (c *Client) PullBatch(queue string, count int) ([]*Job, error) {
	resp, err := c.send(map[string]interface{}{
		"cmd":   "PULLB",
		"queue": queue,
		"count": count,
	})
	if err != nil {
		return nil, err
	}

	jobsRaw, _ := resp["jobs"].([]interface{})
	jobs := make([]*Job, len(jobsRaw))
	for i, j := range jobsRaw {
		jobs[i] = parseJob(j.(map[string]interface{}))
	}
	return jobs, nil
}

// Ack acknowledges a job as completed
func (c *Client) Ack(jobID int64, result interface{}) error {
	_, err := c.send(map[string]interface{}{
		"cmd":    "ACK",
		"id":     jobID,
		"result": result,
	})
	return err
}

// AckBatch acknowledges multiple jobs
func (c *Client) AckBatch(jobIDs []int64) (int, error) {
	resp, err := c.send(map[string]interface{}{
		"cmd": "ACKB",
		"ids": jobIDs,
	})
	if err != nil {
		return 0, err
	}

	idsRaw, _ := resp["ids"].([]interface{})
	if len(idsRaw) > 0 {
		return int(idsRaw[0].(float64)), nil
	}
	return 0, nil
}

// Fail fails a job (will retry or move to DLQ)
func (c *Client) Fail(jobID int64, errorMsg string) error {
	_, err := c.send(map[string]interface{}{
		"cmd":   "FAIL",
		"id":    jobID,
		"error": errorMsg,
	})
	return err
}

// ============== Job Management ==============

// GetState gets job state
func (c *Client) GetState(jobID int64) (JobState, error) {
	resp, err := c.send(map[string]interface{}{
		"cmd": "GETSTATE",
		"id":  jobID,
	})
	if err != nil {
		return "", err
	}

	state, _ := resp["state"].(string)
	return ParseJobState(state), nil
}

// GetResult gets job result
func (c *Client) GetResult(jobID int64) (interface{}, error) {
	resp, err := c.send(map[string]interface{}{
		"cmd": "GETRESULT",
		"id":  jobID,
	})
	if err != nil {
		return nil, err
	}
	return resp["result"], nil
}

// Cancel cancels a pending job
func (c *Client) Cancel(jobID int64) error {
	_, err := c.send(map[string]interface{}{
		"cmd": "CANCEL",
		"id":  jobID,
	})
	return err
}

// Progress updates job progress
func (c *Client) Progress(jobID int64, progress int, message string) error {
	if progress < 0 {
		progress = 0
	}
	if progress > 100 {
		progress = 100
	}

	cmd := map[string]interface{}{
		"cmd":      "PROGRESS",
		"id":       jobID,
		"progress": progress,
	}
	if message != "" {
		cmd["message"] = message
	}

	_, err := c.send(cmd)
	return err
}

// GetProgress gets job progress
func (c *Client) GetProgress(jobID int64) (*Progress, error) {
	resp, err := c.send(map[string]interface{}{
		"cmd": "GETPROGRESS",
		"id":  jobID,
	})
	if err != nil {
		return nil, err
	}

	progData, _ := resp["progress"].(map[string]interface{})
	prog := &Progress{}
	if p, ok := progData["progress"].(float64); ok {
		prog.Progress = int(p)
	}
	if m, ok := progData["message"].(string); ok {
		prog.Message = m
	}
	return prog, nil
}

// ============== Dead Letter Queue ==============

// GetDLQ gets jobs from the dead letter queue
func (c *Client) GetDLQ(queue string, count int) ([]*Job, error) {
	resp, err := c.send(map[string]interface{}{
		"cmd":   "DLQ",
		"queue": queue,
		"count": count,
	})
	if err != nil {
		return nil, err
	}

	jobsRaw, _ := resp["jobs"].([]interface{})
	jobs := make([]*Job, len(jobsRaw))
	for i, j := range jobsRaw {
		jobs[i] = parseJob(j.(map[string]interface{}))
	}
	return jobs, nil
}

// RetryDLQ retries jobs from DLQ
func (c *Client) RetryDLQ(queue string, jobID *int64) (int, error) {
	cmd := map[string]interface{}{
		"cmd":   "RETRYDLQ",
		"queue": queue,
	}
	if jobID != nil {
		cmd["id"] = *jobID
	}

	resp, err := c.send(cmd)
	if err != nil {
		return 0, err
	}

	idsRaw, _ := resp["ids"].([]interface{})
	if len(idsRaw) > 0 {
		return int(idsRaw[0].(float64)), nil
	}
	return 0, nil
}

// ============== Queue Control ==============

// Pause pauses a queue
func (c *Client) Pause(queue string) error {
	_, err := c.send(map[string]interface{}{
		"cmd":   "PAUSE",
		"queue": queue,
	})
	return err
}

// Resume resumes a paused queue
func (c *Client) Resume(queue string) error {
	_, err := c.send(map[string]interface{}{
		"cmd":   "RESUME",
		"queue": queue,
	})
	return err
}

// SetRateLimit sets rate limit for a queue
func (c *Client) SetRateLimit(queue string, limit int) error {
	_, err := c.send(map[string]interface{}{
		"cmd":   "RATELIMIT",
		"queue": queue,
		"limit": limit,
	})
	return err
}

// ClearRateLimit clears rate limit for a queue
func (c *Client) ClearRateLimit(queue string) error {
	_, err := c.send(map[string]interface{}{
		"cmd":   "RATELIMITCLEAR",
		"queue": queue,
	})
	return err
}

// SetConcurrency sets concurrency limit for a queue
func (c *Client) SetConcurrency(queue string, limit int) error {
	_, err := c.send(map[string]interface{}{
		"cmd":   "SETCONCURRENCY",
		"queue": queue,
		"limit": limit,
	})
	return err
}

// ClearConcurrency clears concurrency limit for a queue
func (c *Client) ClearConcurrency(queue string) error {
	_, err := c.send(map[string]interface{}{
		"cmd":   "CLEARCONCURRENCY",
		"queue": queue,
	})
	return err
}

// ListQueues lists all queues
func (c *Client) ListQueues() ([]QueueInfo, error) {
	resp, err := c.send(map[string]interface{}{
		"cmd": "LISTQUEUES",
	})
	if err != nil {
		return nil, err
	}

	queuesRaw, _ := resp["queues"].([]interface{})
	queues := make([]QueueInfo, len(queuesRaw))
	for i, q := range queuesRaw {
		qm := q.(map[string]interface{})
		queues[i] = QueueInfo{
			Name:       getString(qm, "name"),
			Pending:    getInt(qm, "pending"),
			Processing: getInt(qm, "processing"),
			DLQ:        getInt(qm, "dlq"),
			Paused:     getBool(qm, "paused"),
		}
	}
	return queues, nil
}

// ============== Cron Jobs ==============

// AddCron adds a cron job
func (c *Client) AddCron(name string, opts CronOptions) error {
	_, err := c.send(map[string]interface{}{
		"cmd":      "CRON",
		"name":     name,
		"queue":    opts.Queue,
		"data":     opts.Data,
		"schedule": opts.Schedule,
		"priority": opts.Priority,
	})
	return err
}

// DeleteCron deletes a cron job
func (c *Client) DeleteCron(name string) (bool, error) {
	resp, err := c.send(map[string]interface{}{
		"cmd":  "CRONDELETE",
		"name": name,
	})
	if err != nil {
		return false, err
	}
	return getBool(resp, "ok"), nil
}

// ListCrons lists all cron jobs
func (c *Client) ListCrons() ([]CronJob, error) {
	resp, err := c.send(map[string]interface{}{
		"cmd": "CRONLIST",
	})
	if err != nil {
		return nil, err
	}

	cronsRaw, _ := resp["crons"].([]interface{})
	crons := make([]CronJob, len(cronsRaw))
	for i, cr := range cronsRaw {
		cm := cr.(map[string]interface{})
		dataBytes, _ := json.Marshal(cm["data"])
		crons[i] = CronJob{
			Name:     getString(cm, "name"),
			Queue:    getString(cm, "queue"),
			Data:     dataBytes,
			Schedule: getString(cm, "schedule"),
			Priority: getInt(cm, "priority"),
			NextRun:  getInt64(cm, "next_run"),
		}
	}
	return crons, nil
}

// ============== Stats & Metrics ==============

// Stats gets queue statistics
func (c *Client) Stats() (*QueueStats, error) {
	resp, err := c.send(map[string]interface{}{
		"cmd": "STATS",
	})
	if err != nil {
		return nil, err
	}

	return &QueueStats{
		Queued:     getInt(resp, "queued"),
		Processing: getInt(resp, "processing"),
		Delayed:    getInt(resp, "delayed"),
		DLQ:        getInt(resp, "dlq"),
	}, nil
}

// Metrics gets detailed metrics
func (c *Client) Metrics() (*Metrics, error) {
	resp, err := c.send(map[string]interface{}{
		"cmd": "METRICS",
	})
	if err != nil {
		return nil, err
	}

	m, _ := resp["metrics"].(map[string]interface{})
	return &Metrics{
		TotalPushed:    getInt64(m, "total_pushed"),
		TotalCompleted: getInt64(m, "total_completed"),
		TotalFailed:    getInt64(m, "total_failed"),
		JobsPerSecond:  getFloat(m, "jobs_per_second"),
		AvgLatencyMs:   getFloat(m, "avg_latency_ms"),
	}, nil
}

// ============== Internal Methods ==============

func (c *Client) send(cmd map[string]interface{}) (map[string]interface{}, error) {
	if !c.connected {
		if err := c.Connect(); err != nil {
			return nil, err
		}
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	// Send command
	data, err := json.Marshal(cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal command: %w", err)
	}

	c.conn.SetDeadline(time.Now().Add(c.opts.Timeout))
	if _, err := c.conn.Write(append(data, '\n')); err != nil {
		return nil, fmt.Errorf("failed to send command: %w", err)
	}

	// Read response
	line, err := c.reader.ReadBytes('\n')
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(line, &resp); err != nil {
		return nil, fmt.Errorf("invalid response: %w", err)
	}

	if ok, exists := resp["ok"]; exists && ok == false {
		errMsg, _ := resp["error"].(string)
		return nil, fmt.Errorf("server error: %s", errMsg)
	}

	return resp, nil
}

func parseJob(data map[string]interface{}) *Job {
	if data == nil {
		return &Job{}
	}

	dataBytes, _ := json.Marshal(data["data"])

	var dependsOn []int64
	if deps, ok := data["depends_on"].([]interface{}); ok {
		dependsOn = make([]int64, len(deps))
		for i, d := range deps {
			dependsOn[i] = int64(d.(float64))
		}
	}

	var tags []string
	if t, ok := data["tags"].([]interface{}); ok {
		tags = make([]string, len(t))
		for i, tag := range t {
			tags[i] = tag.(string)
		}
	}

	return &Job{
		ID:          getInt64(data, "id"),
		Queue:       getString(data, "queue"),
		Data:        dataBytes,
		Priority:    getInt(data, "priority"),
		CreatedAt:   getInt64(data, "created_at"),
		RunAt:       getInt64(data, "run_at"),
		StartedAt:   getInt64(data, "started_at"),
		Attempts:    getInt(data, "attempts"),
		MaxAttempts: getInt(data, "max_attempts"),
		Backoff:     getInt(data, "backoff"),
		TTL:         getInt64(data, "ttl"),
		Timeout:     getInt64(data, "timeout"),
		UniqueKey:   getString(data, "unique_key"),
		DependsOn:   dependsOn,
		Progress:    getInt(data, "progress"),
		ProgressMsg: getString(data, "progress_msg"),
		Tags:        tags,
	}
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func getInt(m map[string]interface{}, key string) int {
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	return 0
}

func getInt64(m map[string]interface{}, key string) int64 {
	if v, ok := m[key].(float64); ok {
		return int64(v)
	}
	return 0
}

func getFloat(m map[string]interface{}, key string) float64 {
	if v, ok := m[key].(float64); ok {
		return v
	}
	return 0
}

func getBool(m map[string]interface{}, key string) bool {
	if v, ok := m[key].(bool); ok {
		return v
	}
	return false
}
