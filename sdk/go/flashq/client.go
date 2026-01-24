package flashq

import (
	"context"
	"fmt"
	"regexp"
	"time"
)

const (
	maxQueueNameLength  = 256
	maxBatchSize        = 1000
	defaultPullTimeout  = 30 * time.Second
	clientTimeoutBuffer = 5 * time.Second
	defaultPoolSize     = 4
)

var queueNamePattern = regexp.MustCompile(`^[a-zA-Z0-9_\-\.]+$`)

// Client is the main flashQ client with connection pooling.
type Client struct {
	pool *ConnectionPool
	opts ClientOptions
}

// New creates a new flashQ client with default options.
func New() *Client {
	return NewWithOptions(DefaultClientOptions())
}

// NewWithOptions creates a new flashQ client with custom options.
func NewWithOptions(opts ClientOptions) *Client {
	poolSize := opts.PoolSize
	if poolSize < 1 {
		poolSize = defaultPoolSize
	}
	return &Client{
		pool: NewConnectionPool(opts, poolSize),
		opts: opts,
	}
}

// Connect establishes connections to the server.
func (c *Client) Connect(ctx context.Context) error {
	return c.pool.Connect(ctx)
}

// Close closes all connections.
func (c *Client) Close() error {
	return c.pool.Close()
}

// IsConnected returns connection status.
func (c *Client) IsConnected() bool {
	return c.pool.IsConnected()
}

// PoolStats returns connection pool statistics.
func (c *Client) PoolStats() (reconnects, failures int64, healthyConns int) {
	return c.pool.Stats()
}

func (c *Client) send(cmd map[string]interface{}) (map[string]interface{}, error) {
	return c.pool.Send(cmd, c.opts.Timeout)
}

func (c *Client) sendWithTimeout(cmd map[string]interface{}, timeout time.Duration) (map[string]interface{}, error) {
	return c.pool.Send(cmd, timeout)
}

func validateQueueName(queue string) error {
	if queue == "" {
		return NewValidationError("queue name is required")
	}
	if len(queue) > maxQueueNameLength {
		return NewValidationError(fmt.Sprintf("queue name exceeds max length (%d)", maxQueueNameLength))
	}
	if !queueNamePattern.MatchString(queue) {
		return NewValidationError("queue name must be alphanumeric, underscore, hyphen, or dot")
	}
	return nil
}

// Push pushes a job to a queue.
func (c *Client) Push(queue string, data interface{}, opts *PushOptions) (int64, error) {
	if err := validateQueueName(queue); err != nil {
		return 0, err
	}
	cmd := map[string]interface{}{"cmd": "PUSH", "queue": queue, "data": data}
	if opts != nil {
		for k, v := range opts.ToMap() {
			cmd[k] = v
		}
	}
	resp, err := c.send(cmd)
	if err != nil {
		return 0, err
	}
	if id, ok := resp["id"].(float64); ok {
		return int64(id), nil
	}
	return 0, nil
}

// PushBatch pushes multiple jobs to a queue (optimized).
func (c *Client) PushBatch(queue string, jobs []map[string]interface{}) (*BatchPushResult, error) {
	if err := validateQueueName(queue); err != nil {
		return nil, err
	}
	if len(jobs) > maxBatchSize {
		return nil, NewValidationError(fmt.Sprintf("batch size (%d) exceeds max (%d)", len(jobs), maxBatchSize))
	}
	resp, err := c.send(map[string]interface{}{"cmd": "PUSHB", "queue": queue, "jobs": jobs})
	if err != nil {
		return nil, err
	}
	result := &BatchPushResult{Success: true} // No error = success
	if ids, ok := resp["ids"].([]interface{}); ok {
		result.JobIDs = make([]int64, len(ids))
		for i, id := range ids {
			if n, ok := id.(float64); ok {
				result.JobIDs[i] = int64(n)
			}
		}
	}
	return result, nil
}

// PushFlow pushes a parent job with child dependencies.
func (c *Client) PushFlow(parentQueue string, parentData interface{}, children []FlowChild, parentOpts *PushOptions) (*FlowResult, error) {
	if err := validateQueueName(parentQueue); err != nil {
		return nil, err
	}
	childrenIDs := make([]int64, 0, len(children))
	for _, child := range children {
		queue := child.Queue
		if queue == "" {
			queue = parentQueue
		}
		childID, err := c.Push(queue, child.Data, child.Options)
		if err != nil {
			return nil, err
		}
		childrenIDs = append(childrenIDs, childID)
	}
	opts := parentOpts
	if opts == nil {
		opts = &PushOptions{}
	}
	opts.DependsOn = childrenIDs
	parentID, err := c.Push(parentQueue, parentData, opts)
	if err != nil {
		return nil, err
	}
	return &FlowResult{ParentID: parentID, ChildrenIDs: childrenIDs}, nil
}

// Pull pulls a job from a queue (blocking).
func (c *Client) Pull(queue string, timeout time.Duration) (*Job, error) {
	if err := validateQueueName(queue); err != nil {
		return nil, err
	}
	if timeout == 0 {
		timeout = defaultPullTimeout
	}
	resp, err := c.sendWithTimeout(map[string]interface{}{
		"cmd": "PULL", "queue": queue, "timeout": int64(timeout.Milliseconds()),
	}, timeout+clientTimeoutBuffer)
	if err != nil {
		return nil, err
	}
	if jobData, ok := resp["job"].(map[string]interface{}); ok {
		return JobFromMap(jobData), nil
	}
	return nil, nil
}

// PullBatch pulls multiple jobs from a queue.
func (c *Client) PullBatch(queue string, count int, timeout time.Duration) ([]*Job, error) {
	if err := validateQueueName(queue); err != nil {
		return nil, err
	}
	if count > maxBatchSize {
		return nil, NewValidationError(fmt.Sprintf("batch size (%d) exceeds max (%d)", count, maxBatchSize))
	}
	if timeout == 0 {
		timeout = defaultPullTimeout
	}
	resp, err := c.sendWithTimeout(map[string]interface{}{
		"cmd": "PULLB", "queue": queue, "count": count, "timeout": int64(timeout.Milliseconds()),
	}, timeout+clientTimeoutBuffer)
	if err != nil {
		return nil, err
	}
	if jobsData, ok := resp["jobs"].([]interface{}); ok {
		jobs := make([]*Job, 0, len(jobsData))
		for _, j := range jobsData {
			if jm, ok := j.(map[string]interface{}); ok {
				jobs = append(jobs, JobFromMap(jm))
			}
		}
		return jobs, nil
	}
	return nil, nil
}

// Ack acknowledges job completion.
func (c *Client) Ack(jobID int64, result interface{}) (bool, error) {
	cmd := map[string]interface{}{"cmd": "ACK", "id": jobID}
	if result != nil {
		cmd["result"] = result
	}
	_, err := c.send(cmd)
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// AckBatch acknowledges multiple jobs.
// Returns the number of jobs acknowledged.
func (c *Client) AckBatch(jobIDs []int64) (int, error) {
	if len(jobIDs) > maxBatchSize {
		return 0, NewValidationError(fmt.Sprintf("batch size (%d) exceeds max (%d)", len(jobIDs), maxBatchSize))
	}
	resp, err := c.send(map[string]interface{}{"cmd": "ACKB", "ids": jobIDs})
	if err != nil {
		return 0, err
	}
	// Return count of acknowledged jobs (fallback to ids length for compatibility)
	if count, ok := resp["count"].(float64); ok {
		return int(count), nil
	}
	return len(jobIDs), nil
}

// Fail fails a job (will retry or go to DLQ).
func (c *Client) Fail(jobID int64, errMsg string) (bool, error) {
	_, err := c.send(map[string]interface{}{"cmd": "FAIL", "id": jobID, "error": errMsg})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}
