package flashq

import "time"

// GetJob gets a job by ID.
func (c *Client) GetJob(jobID int64) (*Job, error) {
	resp, err := c.send(map[string]interface{}{"cmd": "GETJOB", "id": jobID})
	if err != nil {
		return nil, err
	}
	if jobData, ok := resp["job"].(map[string]interface{}); ok {
		return JobFromMap(jobData), nil
	}
	return nil, NewJobNotFoundError(jobID)
}

// GetState gets job state only.
func (c *Client) GetState(jobID int64) (JobState, error) {
	resp, err := c.send(map[string]interface{}{"cmd": "GETSTATE", "id": jobID})
	if err != nil {
		return "", err
	}
	if state, ok := resp["state"].(string); ok {
		return JobState(state), nil
	}
	return "", nil
}

// GetResult gets job result.
func (c *Client) GetResult(jobID int64) (interface{}, error) {
	resp, err := c.send(map[string]interface{}{"cmd": "GETRESULT", "id": jobID})
	if err != nil {
		return nil, err
	}
	return resp["result"], nil
}

// GetJobByCustomID gets job by custom ID.
func (c *Client) GetJobByCustomID(customID string) (*Job, error) {
	resp, err := c.send(map[string]interface{}{"cmd": "GETJOBBYCUSTOMID", "customId": customID})
	if err != nil {
		return nil, err
	}
	if jobData, ok := resp["job"].(map[string]interface{}); ok {
		return JobFromMap(jobData), nil
	}
	return nil, nil
}

// GetJobs gets jobs with filtering.
func (c *Client) GetJobs(queue string, state JobState, limit, offset int) ([]*Job, error) {
	if err := validateQueueName(queue); err != nil {
		return nil, err
	}
	cmd := map[string]interface{}{"cmd": "GETJOBS", "queue": queue, "limit": limit, "offset": offset}
	if state != "" {
		cmd["state"] = string(state)
	}
	resp, err := c.send(cmd)
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

// GetJobCounts gets job counts by state.
func (c *Client) GetJobCounts(queue string) (map[string]int, error) {
	if err := validateQueueName(queue); err != nil {
		return nil, err
	}
	resp, err := c.send(map[string]interface{}{"cmd": "GETJOBCOUNTS", "queue": queue})
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int)
	if data, ok := resp["counts"].(map[string]interface{}); ok {
		for k, v := range data {
			if n, ok := v.(float64); ok {
				counts[k] = int(n)
			}
		}
	}
	return counts, nil
}

// Count counts waiting + delayed jobs.
func (c *Client) Count(queue string) (int, error) {
	if err := validateQueueName(queue); err != nil {
		return 0, err
	}
	resp, err := c.send(map[string]interface{}{"cmd": "COUNT", "queue": queue})
	if err != nil {
		return 0, err
	}
	if count, ok := resp["count"].(float64); ok {
		return int(count), nil
	}
	return 0, nil
}

// Cancel cancels a pending job.
func (c *Client) Cancel(jobID int64) (bool, error) {
	_, err := c.send(map[string]interface{}{"cmd": "CANCEL", "id": jobID})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// Progress updates job progress (0-100).
func (c *Client) Progress(jobID int64, progress int, message string) (bool, error) {
	cmd := map[string]interface{}{"cmd": "PROGRESS", "id": jobID, "progress": progress}
	if message != "" {
		cmd["message"] = message
	}
	_, err := c.send(cmd)
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// GetProgress gets job progress.
func (c *Client) GetProgress(jobID int64) (*ProgressInfo, error) {
	resp, err := c.send(map[string]interface{}{"cmd": "GETPROGRESS", "id": jobID})
	if err != nil {
		return nil, err
	}
	info := &ProgressInfo{}
	if progress, ok := resp["progress"].(float64); ok {
		info.Progress = int(progress)
	}
	if message, ok := resp["message"].(string); ok {
		info.Message = message
	}
	return info, nil
}

// Finished waits for job completion.
func (c *Client) Finished(jobID int64, timeout time.Duration) (interface{}, error) {
	if timeout == 0 {
		timeout = 30 * time.Second
	}
	resp, err := c.sendWithTimeout(map[string]interface{}{
		"cmd":     "WAITJOB",
		"id":      jobID,
		"timeout": int64(timeout.Milliseconds()),
	}, timeout+clientTimeoutBuffer)
	if err != nil {
		return nil, err
	}
	return resp["result"], nil
}

// Update updates job data.
func (c *Client) Update(jobID int64, data interface{}) (bool, error) {
	_, err := c.send(map[string]interface{}{"cmd": "UPDATE", "id": jobID, "data": data})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// ChangePriority changes job priority.
func (c *Client) ChangePriority(jobID int64, priority int) (bool, error) {
	_, err := c.send(map[string]interface{}{"cmd": "CHANGEPRIORITY", "id": jobID, "priority": priority})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// MoveToDelayed moves active job back to delayed.
func (c *Client) MoveToDelayed(jobID int64, delay time.Duration) (bool, error) {
	_, err := c.send(map[string]interface{}{"cmd": "MOVETODELAYED", "id": jobID, "delay": int64(delay.Milliseconds())})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// Promote moves delayed job to waiting.
func (c *Client) Promote(jobID int64) (bool, error) {
	_, err := c.send(map[string]interface{}{"cmd": "PROMOTE", "id": jobID})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// Discard moves job to DLQ.
func (c *Client) Discard(jobID int64) (bool, error) {
	_, err := c.send(map[string]interface{}{"cmd": "DISCARD", "id": jobID})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// Heartbeat sends heartbeat for long-running job.
func (c *Client) Heartbeat(jobID int64) (bool, error) {
	_, err := c.send(map[string]interface{}{"cmd": "HEARTBEAT", "id": jobID})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// Partial sends partial result for streaming jobs.
// Emits a "partial" event that can be subscribed via SSE/WebSocket.
// Useful for LLM token streaming, chunked responses, etc.
//
// Example:
//
//	for token := range llm.Generate(prompt) {
//	    client.Partial(job.ID, map[string]any{"token": token}, nil)
//	}
func (c *Client) Partial(jobID int64, data interface{}, index *int) (bool, error) {
	cmd := map[string]interface{}{"cmd": "PARTIAL", "id": jobID, "data": data}
	if index != nil {
		cmd["index"] = *index
	}
	_, err := c.send(cmd)
	if err != nil {
		return false, err
	}
	return true, nil
}

// Log adds log entry to job.
func (c *Client) Log(jobID int64, message, level string) (bool, error) {
	if level == "" {
		level = "info"
	}
	_, err := c.send(map[string]interface{}{"cmd": "LOG", "id": jobID, "message": message, "level": level})
	if err != nil {
		return false, err
	}
	return true, nil // No error = success
}

// GetLogs gets job log entries.
func (c *Client) GetLogs(jobID int64) ([]LogEntry, error) {
	resp, err := c.send(map[string]interface{}{"cmd": "GETLOGS", "id": jobID})
	if err != nil {
		return nil, err
	}
	logs := make([]LogEntry, 0)
	if logsData, ok := resp["logs"].([]interface{}); ok {
		for _, l := range logsData {
			if lm, ok := l.(map[string]interface{}); ok {
				entry := LogEntry{}
				if msg, ok := lm["message"].(string); ok {
					entry.Message = msg
				}
				if level, ok := lm["level"].(string); ok {
					entry.Level = level
				}
				logs = append(logs, entry)
			}
		}
	}
	return logs, nil
}
