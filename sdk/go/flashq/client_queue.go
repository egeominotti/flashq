package flashq

import "time"

// Pause pauses a queue.
func (c *Client) Pause(queue string) (bool, error) {
	if err := validateQueueName(queue); err != nil {
		return false, err
	}
	_, err := c.send(map[string]interface{}{"cmd": "PAUSE", "queue": queue})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// Resume resumes a paused queue.
func (c *Client) Resume(queue string) (bool, error) {
	if err := validateQueueName(queue); err != nil {
		return false, err
	}
	_, err := c.send(map[string]interface{}{"cmd": "RESUME", "queue": queue})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// IsPaused checks if a queue is paused.
func (c *Client) IsPaused(queue string) (bool, error) {
	if err := validateQueueName(queue); err != nil {
		return false, err
	}
	resp, err := c.send(map[string]interface{}{"cmd": "ISPAUSED", "queue": queue})
	if err != nil {
		return false, err
	}
	return resp["paused"] == true, nil
}

// Drain removes all waiting jobs from a queue.
func (c *Client) Drain(queue string) (bool, error) {
	if err := validateQueueName(queue); err != nil {
		return false, err
	}
	_, err := c.send(map[string]interface{}{"cmd": "DRAIN", "queue": queue})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// Obliterate removes ALL queue data.
func (c *Client) Obliterate(queue string) (bool, error) {
	if err := validateQueueName(queue); err != nil {
		return false, err
	}
	_, err := c.send(map[string]interface{}{"cmd": "OBLITERATE", "queue": queue})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// Clean cleans up jobs by age and state.
func (c *Client) Clean(queue string, grace time.Duration, state JobState, limit int) (int, error) {
	if err := validateQueueName(queue); err != nil {
		return 0, err
	}
	cmd := map[string]interface{}{
		"cmd":   "CLEAN",
		"queue": queue,
		"grace": int64(grace.Milliseconds()),
		"limit": limit,
	}
	if state != "" {
		cmd["state"] = string(state)
	}
	resp, err := c.send(cmd)
	if err != nil {
		return 0, err
	}
	if count, ok := resp["count"].(float64); ok {
		return int(count), nil
	}
	return 0, nil
}

// ListQueues lists all queues.
func (c *Client) ListQueues() ([]string, error) {
	resp, err := c.send(map[string]interface{}{"cmd": "LISTQUEUES"})
	if err != nil {
		return nil, err
	}
	queues := make([]string, 0)
	if data, ok := resp["queues"].([]interface{}); ok {
		for _, q := range data {
			if s, ok := q.(string); ok {
				queues = append(queues, s)
			}
		}
	}
	return queues, nil
}

// GetDLQ gets jobs from the dead letter queue.
func (c *Client) GetDLQ(queue string, count int) ([]*Job, error) {
	if err := validateQueueName(queue); err != nil {
		return nil, err
	}
	resp, err := c.send(map[string]interface{}{"cmd": "DLQ", "queue": queue, "count": count})
	if err != nil {
		return nil, err
	}
	jobs := make([]*Job, 0)
	if jobsData, ok := resp["jobs"].([]interface{}); ok {
		for _, j := range jobsData {
			if jm, ok := j.(map[string]interface{}); ok {
				jobs = append(jobs, JobFromMap(jm))
			}
		}
	}
	return jobs, nil
}

// RetryDLQ retries jobs from the dead letter queue.
func (c *Client) RetryDLQ(queue string, jobID *int64) (int, error) {
	if err := validateQueueName(queue); err != nil {
		return 0, err
	}
	cmd := map[string]interface{}{"cmd": "RETRYDLQ", "queue": queue}
	if jobID != nil {
		cmd["id"] = *jobID
	}
	resp, err := c.send(cmd)
	if err != nil {
		return 0, err
	}
	if count, ok := resp["count"].(float64); ok {
		return int(count), nil
	}
	return 0, nil
}

// SetRateLimit sets rate limit for a queue.
func (c *Client) SetRateLimit(queue string, limit int) (bool, error) {
	if err := validateQueueName(queue); err != nil {
		return false, err
	}
	_, err := c.send(map[string]interface{}{"cmd": "RATELIMIT", "queue": queue, "limit": limit})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// ClearRateLimit clears rate limit for a queue.
func (c *Client) ClearRateLimit(queue string) (bool, error) {
	if err := validateQueueName(queue); err != nil {
		return false, err
	}
	_, err := c.send(map[string]interface{}{"cmd": "RATELIMITCLEAR", "queue": queue})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// SetConcurrency sets concurrency limit for a queue.
func (c *Client) SetConcurrency(queue string, limit int) (bool, error) {
	if err := validateQueueName(queue); err != nil {
		return false, err
	}
	_, err := c.send(map[string]interface{}{"cmd": "SETCONCURRENCY", "queue": queue, "limit": limit})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// ClearConcurrency clears concurrency limit for a queue.
func (c *Client) ClearConcurrency(queue string) (bool, error) {
	if err := validateQueueName(queue); err != nil {
		return false, err
	}
	_, err := c.send(map[string]interface{}{"cmd": "CLEARCONCURRENCY", "queue": queue})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// AddCron adds a cron job.
func (c *Client) AddCron(name, queue, schedule string, data interface{}, opts *PushOptions) (bool, error) {
	if err := validateQueueName(queue); err != nil {
		return false, err
	}
	cmd := map[string]interface{}{
		"cmd":      "CRON",
		"name":     name,
		"queue":    queue,
		"schedule": schedule,
	}
	if data != nil {
		cmd["data"] = data
	}
	if opts != nil {
		for k, v := range opts.ToMap() {
			cmd[k] = v
		}
	}
	_, err := c.send(cmd)
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// DeleteCron deletes a cron job.
func (c *Client) DeleteCron(name string) (bool, error) {
	_, err := c.send(map[string]interface{}{"cmd": "CRONDELETE", "name": name})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// ListCrons lists all cron jobs.
func (c *Client) ListCrons() ([]CronJob, error) {
	resp, err := c.send(map[string]interface{}{"cmd": "CRONLIST"})
	if err != nil {
		return nil, err
	}
	crons := make([]CronJob, 0)
	if data, ok := resp["jobs"].([]interface{}); ok {
		for _, j := range data {
			if jm, ok := j.(map[string]interface{}); ok {
				cron := CronJob{}
				if name, ok := jm["name"].(string); ok { cron.Name = name }
				if queue, ok := jm["queue"].(string); ok { cron.Queue = queue }
				if schedule, ok := jm["schedule"].(string); ok { cron.Schedule = schedule }
				if data, ok := jm["data"]; ok { cron.Data = data }
				crons = append(crons, cron)
			}
		}
	}
	return crons, nil
}

// Stats gets queue statistics.
func (c *Client) Stats() (map[string]QueueStats, error) {
	resp, err := c.send(map[string]interface{}{"cmd": "STATS"})
	if err != nil {
		return nil, err
	}
	stats := make(map[string]QueueStats)
	if data, ok := resp["queues"].(map[string]interface{}); ok {
		for queue, v := range data {
			if qm, ok := v.(map[string]interface{}); ok {
				qs := QueueStats{}
				if n, ok := qm["waiting"].(float64); ok { qs.Waiting = int(n) }
				if n, ok := qm["active"].(float64); ok { qs.Active = int(n) }
				if n, ok := qm["completed"].(float64); ok { qs.Completed = int(n) }
				if n, ok := qm["failed"].(float64); ok { qs.Failed = int(n) }
				if n, ok := qm["delayed"].(float64); ok { qs.Delayed = int(n) }
				if b, ok := qm["paused"].(bool); ok { qs.Paused = b }
				stats[queue] = qs
			}
		}
	}
	return stats, nil
}

// Metrics gets detailed metrics.
func (c *Client) Metrics() (map[string]interface{}, error) {
	resp, err := c.send(map[string]interface{}{"cmd": "METRICS"})
	if err != nil {
		return nil, err
	}
	return resp, nil
}
