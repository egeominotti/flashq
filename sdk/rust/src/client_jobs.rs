use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::client::{extract_job, FlashQ};
use crate::constants::CLIENT_TIMEOUT_BUFFER_MS;
use crate::errors::{check_response, Result};
use crate::types::*;

/// Job query and management methods.
impl FlashQ {
    /// Get a job by ID with its current state.
    pub async fn get_job(&self, job_id: u64) -> Result<Option<JobWithState>> {
        let cmd = serde_json::json!({"cmd": "GETJOB", "id": job_id});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        let job = extract_job(&resp, "job")?;
        let state = resp
            .get("state")
            .and_then(|v| serde_json::from_value::<JobState>(v.clone()).ok());
        match (job, state) {
            (Some(job), Some(state)) => Ok(Some(JobWithState { job, state })),
            _ => Ok(None),
        }
    }

    /// Get job state only.
    pub async fn get_state(&self, job_id: u64) -> Result<Option<JobState>> {
        let cmd = serde_json::json!({"cmd": "GETSTATE", "id": job_id});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(resp
            .get("state")
            .and_then(|v| serde_json::from_value::<JobState>(v.clone()).ok()))
    }

    /// Get job result.
    pub async fn get_result(&self, job_id: u64) -> Result<Option<Value>> {
        let cmd = serde_json::json!({"cmd": "GETRESULT", "id": job_id});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(resp.get("result").cloned().filter(|v| !v.is_null()))
    }

    /// Get job by custom ID (idempotency lookup).
    pub async fn get_job_by_custom_id(&self, custom_id: &str) -> Result<Option<JobWithState>> {
        let cmd = serde_json::json!({"cmd": "GETJOBBYCUSTOMID", "job_id": custom_id});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        let job = extract_job(&resp, "job")?;
        let state = resp
            .get("state")
            .and_then(|v| serde_json::from_value::<JobState>(v.clone()).ok());
        match (job, state) {
            (Some(job), Some(state)) => Ok(Some(JobWithState { job, state })),
            _ => Ok(None),
        }
    }

    /// Get multiple jobs by IDs.
    pub async fn get_jobs_batch(&self, job_ids: Vec<u64>) -> Result<Vec<JobWithState>> {
        let cmd = serde_json::json!({"cmd": "GETJOBSBATCH", "ids": job_ids});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        let jobs = resp
            .get("jobs")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value::<JobWithState>(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(jobs)
    }

    /// List jobs with filtering and pagination.
    pub async fn get_jobs(
        &self,
        queue: Option<&str>,
        state: Option<JobState>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<JobsResult> {
        let mut cmd = serde_json::json!({"cmd": "GETJOBS"});
        let obj = cmd.as_object_mut().unwrap();
        if let Some(q) = queue {
            obj.insert("queue".into(), Value::String(q.to_string()));
        }
        if let Some(s) = state {
            obj.insert("state".into(), serde_json::to_value(s)?);
        }
        if let Some(l) = limit {
            obj.insert("limit".into(), Value::Number(l.into()));
        }
        if let Some(o) = offset {
            obj.insert("offset".into(), Value::Number(o.into()));
        }
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        let jobs = resp
            .get("jobs")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value::<JobWithState>(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        let total = resp.get("total").and_then(|v| v.as_u64()).unwrap_or(0);
        Ok(JobsResult { jobs, total })
    }

    /// Get job counts by state for a queue.
    pub async fn get_job_counts(&self, queue: &str) -> Result<JobCounts> {
        let cmd = serde_json::json!({"cmd": "GETJOBCOUNTS", "queue": queue});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(JobCounts {
            waiting: resp.get("waiting").and_then(|v| v.as_u64()).unwrap_or(0),
            active: resp.get("active").and_then(|v| v.as_u64()).unwrap_or(0),
            delayed: resp.get("delayed").and_then(|v| v.as_u64()).unwrap_or(0),
            completed: resp.get("completed").and_then(|v| v.as_u64()).unwrap_or(0),
            failed: resp.get("failed").and_then(|v| v.as_u64()).unwrap_or(0),
        })
    }

    /// Count waiting + delayed jobs in a queue.
    pub async fn count(&self, queue: &str) -> Result<u64> {
        let cmd = serde_json::json!({"cmd": "COUNT", "queue": queue});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(resp.get("count").and_then(|v| v.as_u64()).unwrap_or(0))
    }

    /// Wait for job completion and return result (blocking).
    pub async fn finished(&self, job_id: u64, timeout: Option<Duration>) -> Result<Option<Value>> {
        let timeout_ms = timeout.map(|d| d.as_millis() as u64).unwrap_or(30_000);
        let cmd = serde_json::json!({"cmd": "WAITJOB", "id": job_id, "timeout": timeout_ms});
        let client_timeout = Duration::from_millis(timeout_ms + CLIENT_TIMEOUT_BUFFER_MS);
        let resp = self.send_with_timeout(cmd, client_timeout).await?;
        check_response(&resp)?;
        Ok(resp.get("result").cloned().filter(|v| !v.is_null()))
    }

    /// Cancel a pending job.
    pub async fn cancel(&self, job_id: u64) -> Result<bool> {
        let cmd = serde_json::json!({"cmd": "CANCEL", "id": job_id});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Update job progress (0-100) with optional message.
    pub async fn progress(&self, job_id: u64, progress: u8, message: Option<&str>) -> Result<bool> {
        let mut cmd = serde_json::json!({
            "cmd": "PROGRESS",
            "id": job_id,
            "progress": progress,
        });
        if let Some(msg) = message {
            cmd.as_object_mut()
                .unwrap()
                .insert("message".into(), Value::String(msg.to_string()));
        }
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Get job progress.
    pub async fn get_progress(&self, job_id: u64) -> Result<ProgressInfo> {
        let cmd = serde_json::json!({"cmd": "GETPROGRESS", "id": job_id});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(ProgressInfo {
            progress: resp.get("progress").and_then(|v| v.as_u64()).unwrap_or(0) as u8,
            message: resp
                .get("message")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        })
    }

    /// Update job data.
    pub async fn update<T: Serialize>(&self, job_id: u64, data: T) -> Result<bool> {
        let cmd = serde_json::json!({
            "cmd": "UPDATEJOB",
            "id": job_id,
            "data": serde_json::to_value(data)?,
        });
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Change job priority.
    pub async fn change_priority(&self, job_id: u64, priority: i32) -> Result<bool> {
        let cmd = serde_json::json!({
            "cmd": "CHANGEPRIORITY",
            "id": job_id,
            "priority": priority,
        });
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Move active job back to delayed state.
    pub async fn move_to_delayed(&self, job_id: u64, delay: u64) -> Result<bool> {
        let cmd = serde_json::json!({
            "cmd": "MOVETODELAYED",
            "id": job_id,
            "delay": delay,
        });
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Promote delayed job to waiting.
    pub async fn promote(&self, job_id: u64) -> Result<bool> {
        let cmd = serde_json::json!({"cmd": "PROMOTE", "id": job_id});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Discard a job (move to DLQ).
    pub async fn discard(&self, job_id: u64) -> Result<bool> {
        let cmd = serde_json::json!({"cmd": "DISCARD", "id": job_id});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Send heartbeat for a long-running job.
    pub async fn heartbeat(&self, job_id: u64) -> Result<bool> {
        let cmd = serde_json::json!({"cmd": "HEARTBEAT", "id": job_id});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Add a log entry to a job.
    pub async fn log(&self, job_id: u64, message: &str, level: Option<&str>) -> Result<bool> {
        let cmd = serde_json::json!({
            "cmd": "LOG",
            "id": job_id,
            "message": message,
            "level": level.unwrap_or("info"),
        });
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Get job log entries.
    pub async fn get_logs(&self, job_id: u64) -> Result<Vec<LogEntry>> {
        let cmd = serde_json::json!({"cmd": "GETLOGS", "id": job_id});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        let logs = resp
            .get("logs")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value::<LogEntry>(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(logs)
    }

    /// Get child job IDs for a parent job.
    pub async fn get_children(&self, job_id: u64) -> Result<Vec<u64>> {
        let cmd = serde_json::json!({"cmd": "GETCHILDREN", "parent_id": job_id});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(resp
            .get("ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
            .unwrap_or_default())
    }

    /// Send partial result for streaming.
    pub async fn partial(&self, job_id: u64, data: Value, index: Option<u32>) -> Result<bool> {
        let mut cmd = serde_json::json!({
            "cmd": "PARTIAL",
            "id": job_id,
            "data": data,
        });
        if let Some(idx) = index {
            cmd.as_object_mut()
                .unwrap()
                .insert("index".into(), Value::Number(idx.into()));
        }
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }
}
