package flashq

import (
	"context"
	"time"
)

// Queue provides a BullMQ-compatible API for queue operations.
type Queue struct {
	name   string
	client *Client
}

// NewQueue creates a new Queue instance.
func NewQueue(name string, opts *ClientOptions) *Queue {
	var co ClientOptions
	if opts != nil {
		co = *opts
	} else {
		co = DefaultClientOptions()
	}

	return &Queue{
		name:   name,
		client: NewWithOptions(co),
	}
}

// Name returns the queue name.
func (q *Queue) Name() string {
	return q.name
}

// Client returns the underlying client.
func (q *Queue) Client() *Client {
	return q.client
}

// Connect establishes connection to the server.
func (q *Queue) Connect(ctx context.Context) error {
	return q.client.Connect(ctx)
}

// Close closes the connection.
func (q *Queue) Close() error {
	return q.client.Close()
}

// ============================================================================
// BullMQ-compatible API
// ============================================================================

// Add adds a job to the queue (BullMQ-compatible).
func (q *Queue) Add(name string, data interface{}, opts *PushOptions) (*Job, error) {
	if opts == nil {
		opts = &PushOptions{}
	}

	// Add name as tag
	if opts.Tags == nil {
		opts.Tags = []string{}
	}
	hasTag := false
	for _, t := range opts.Tags {
		if t == name {
			hasTag = true
			break
		}
	}
	if !hasTag {
		opts.Tags = append(opts.Tags, name)
	}

	jobID, err := q.client.Push(q.name, data, opts)
	if err != nil {
		return nil, err
	}

	return q.client.GetJob(jobID)
}

// AddBulk adds multiple jobs (BullMQ-compatible).
func (q *Queue) AddBulk(jobs []struct {
	Name string
	Data interface{}
	Opts *PushOptions
}) ([]*Job, error) {
	payloads := make([]map[string]interface{}, len(jobs))

	for i, job := range jobs {
		payload := map[string]interface{}{
			"data": job.Data,
		}

		if job.Opts != nil {
			for k, v := range job.Opts.ToMap() {
				payload[k] = v
			}
		}

		// Add name as tag
		tags := []string{job.Name}
		if job.Opts != nil && len(job.Opts.Tags) > 0 {
			tags = append(tags, job.Opts.Tags...)
		}
		payload["tags"] = tags

		payloads[i] = payload
	}

	result, err := q.client.PushBatch(q.name, payloads)
	if err != nil {
		return nil, err
	}

	// Fetch full job details
	jobDetails := make([]*Job, len(result.JobIDs))
	for i, id := range result.JobIDs {
		job, err := q.client.GetJob(id)
		if err != nil {
			return nil, err
		}
		jobDetails[i] = job
	}

	return jobDetails, nil
}

// GetJob gets a job by ID.
func (q *Queue) GetJob(jobID int64) (*Job, error) {
	return q.client.GetJob(jobID)
}

// GetJobs gets jobs by state (BullMQ-compatible).
func (q *Queue) GetJobs(types []JobState, start, end int) ([]*Job, error) {
	if len(types) == 0 {
		types = []JobState{JobStateWaiting, JobStateActive, JobStateCompleted, JobStateFailed}
	}

	limit := end - start
	allJobs := make([]*Job, 0)

	for _, state := range types {
		jobs, err := q.client.GetJobs(q.name, state, limit, start)
		if err != nil {
			return nil, err
		}
		allJobs = append(allJobs, jobs...)
	}

	if len(allJobs) > limit {
		allJobs = allJobs[:limit]
	}

	return allJobs, nil
}

// GetJobCounts gets job counts by state.
func (q *Queue) GetJobCounts(types ...string) (map[string]int, error) {
	counts, err := q.client.GetJobCounts(q.name)
	if err != nil {
		return nil, err
	}

	if len(types) > 0 {
		filtered := make(map[string]int)
		for _, t := range types {
			filtered[t] = counts[t]
		}
		return filtered, nil
	}

	return counts, nil
}

// GetWaitingCount gets waiting job count.
func (q *Queue) GetWaitingCount() (int, error) {
	counts, err := q.GetJobCounts("waiting")
	if err != nil {
		return 0, err
	}
	return counts["waiting"], nil
}

// GetActiveCount gets active job count.
func (q *Queue) GetActiveCount() (int, error) {
	counts, err := q.GetJobCounts("active")
	if err != nil {
		return 0, err
	}
	return counts["active"], nil
}

// GetCompletedCount gets completed job count.
func (q *Queue) GetCompletedCount() (int, error) {
	counts, err := q.GetJobCounts("completed")
	if err != nil {
		return 0, err
	}
	return counts["completed"], nil
}

// GetFailedCount gets failed job count.
func (q *Queue) GetFailedCount() (int, error) {
	counts, err := q.GetJobCounts("failed")
	if err != nil {
		return 0, err
	}
	return counts["failed"], nil
}

// GetDelayedCount gets delayed job count.
func (q *Queue) GetDelayedCount() (int, error) {
	counts, err := q.GetJobCounts("delayed")
	if err != nil {
		return 0, err
	}
	return counts["delayed"], nil
}

// Pause pauses the queue.
func (q *Queue) Pause() error {
	_, err := q.client.Pause(q.name)
	return err
}

// Resume resumes the queue.
func (q *Queue) Resume() error {
	_, err := q.client.Resume(q.name)
	return err
}

// IsPaused checks if queue is paused.
func (q *Queue) IsPaused() (bool, error) {
	return q.client.IsPaused(q.name)
}

// Drain removes all waiting jobs.
func (q *Queue) Drain() error {
	_, err := q.client.Drain(q.name)
	return err
}

// Obliterate removes all queue data.
func (q *Queue) Obliterate(force bool) error {
	_, err := q.client.Obliterate(q.name)
	return err
}

// Clean cleans jobs by age.
func (q *Queue) Clean(grace time.Duration, limit int, jobState JobState) (int, error) {
	if jobState == "" {
		jobState = JobStateCompleted
	}
	return q.client.Clean(q.name, grace, jobState, limit)
}

// RetryJobs retries failed jobs from DLQ.
func (q *Queue) RetryJobs(count int) (int, error) {
	return q.client.RetryDLQ(q.name, nil)
}

// Remove removes a job.
func (q *Queue) Remove(jobID int64) (bool, error) {
	return q.client.Cancel(jobID)
}

// Count returns the total count of waiting + delayed jobs.
func (q *Queue) Count() (int, error) {
	return q.client.Count(q.name)
}
