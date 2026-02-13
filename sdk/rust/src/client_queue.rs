use serde::Serialize;
use serde_json::Value;

use crate::client::{extract_jobs, FlashQ};
use crate::errors::{check_response, Result};
use crate::types::*;
use crate::validation::validate_queue_name;

/// Queue management, DLQ, rate limiting, cron, flow, and monitoring methods.
impl FlashQ {
    // === Queue Management ===

    /// Pause a queue.
    pub async fn pause(&self, queue: &str) -> Result<bool> {
        validate_queue_name(queue)?;
        let cmd = serde_json::json!({"cmd": "PAUSE", "queue": queue});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Resume a paused queue.
    pub async fn resume(&self, queue: &str) -> Result<bool> {
        validate_queue_name(queue)?;
        let cmd = serde_json::json!({"cmd": "RESUME", "queue": queue});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Check if a queue is paused.
    pub async fn is_paused(&self, queue: &str) -> Result<bool> {
        validate_queue_name(queue)?;
        let cmd = serde_json::json!({"cmd": "ISPAUSED", "queue": queue});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(resp
            .get("paused")
            .and_then(|v| v.as_bool())
            .unwrap_or(false))
    }

    /// Drain all waiting jobs from a queue. Returns count of drained jobs.
    pub async fn drain(&self, queue: &str) -> Result<u64> {
        validate_queue_name(queue)?;
        let cmd = serde_json::json!({"cmd": "DRAIN", "queue": queue});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(resp.get("count").and_then(|v| v.as_u64()).unwrap_or(0))
    }

    /// Remove ALL data for a queue (jobs, DLQ, cron, etc.).
    pub async fn obliterate(&self, queue: &str) -> Result<bool> {
        validate_queue_name(queue)?;
        let cmd = serde_json::json!({"cmd": "OBLITERATE", "queue": queue});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Clean jobs older than grace period by state.
    pub async fn clean(
        &self,
        queue: &str,
        grace: u64,
        state: &str,
        limit: Option<u32>,
    ) -> Result<u64> {
        validate_queue_name(queue)?;
        let mut cmd = serde_json::json!({
            "cmd": "CLEAN",
            "queue": queue,
            "grace": grace,
            "state": state,
        });
        if let Some(l) = limit {
            cmd.as_object_mut()
                .unwrap()
                .insert("limit".into(), Value::Number(l.into()));
        }
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(resp.get("count").and_then(|v| v.as_u64()).unwrap_or(0))
    }

    /// List all queues.
    pub async fn list_queues(&self) -> Result<Vec<QueueInfo>> {
        let cmd = serde_json::json!({"cmd": "LISTQUEUES"});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        let queues = resp
            .get("queues")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value::<QueueInfo>(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(queues)
    }

    // === Dead Letter Queue ===

    /// Get jobs from the dead letter queue.
    pub async fn get_dlq(&self, queue: &str, count: Option<u32>) -> Result<Vec<Job>> {
        validate_queue_name(queue)?;
        let mut cmd = serde_json::json!({"cmd": "DLQ", "queue": queue});
        if let Some(c) = count {
            cmd.as_object_mut()
                .unwrap()
                .insert("count".into(), Value::Number(c.into()));
        }
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(extract_jobs(&resp, "jobs"))
    }

    /// Retry DLQ jobs. If job_id provided, retries specific job; otherwise retries all.
    pub async fn retry_dlq(&self, queue: &str, job_id: Option<u64>) -> Result<u64> {
        validate_queue_name(queue)?;
        let mut cmd = serde_json::json!({"cmd": "RETRYDLQ", "queue": queue});
        if let Some(id) = job_id {
            cmd.as_object_mut()
                .unwrap()
                .insert("id".into(), Value::Number(id.into()));
        }
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(resp.get("count").and_then(|v| v.as_u64()).unwrap_or(0))
    }

    /// Purge all jobs from dead letter queue.
    pub async fn purge_dlq(&self, queue: &str) -> Result<u64> {
        validate_queue_name(queue)?;
        let cmd = serde_json::json!({"cmd": "PURGEDLQ", "queue": queue});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(resp.get("count").and_then(|v| v.as_u64()).unwrap_or(0))
    }

    // === Rate Limiting ===

    /// Set rate limit for a queue (jobs per second).
    pub async fn set_rate_limit(&self, queue: &str, limit: u32) -> Result<bool> {
        validate_queue_name(queue)?;
        let cmd = serde_json::json!({"cmd": "RATELIMIT", "queue": queue, "limit": limit});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Clear rate limit for a queue.
    pub async fn clear_rate_limit(&self, queue: &str) -> Result<bool> {
        validate_queue_name(queue)?;
        let cmd = serde_json::json!({"cmd": "RATELIMITCLEAR", "queue": queue});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Set concurrency limit for a queue.
    pub async fn set_concurrency(&self, queue: &str, limit: u32) -> Result<bool> {
        validate_queue_name(queue)?;
        let cmd = serde_json::json!({"cmd": "SETCONCURRENCY", "queue": queue, "limit": limit});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Clear concurrency limit for a queue.
    pub async fn clear_concurrency(&self, queue: &str) -> Result<bool> {
        validate_queue_name(queue)?;
        let cmd = serde_json::json!({"cmd": "CLEARCONCURRENCY", "queue": queue});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    // === Cron Jobs ===

    /// Add a cron job.
    pub async fn add_cron(&self, name: &str, opts: CronOptions) -> Result<bool> {
        validate_queue_name(&opts.queue)?;
        let mut cmd = serde_json::json!({
            "cmd": "CRON",
            "name": name,
            "queue": opts.queue,
            "data": opts.data,
        });
        let obj = cmd.as_object_mut().unwrap();
        if let Some(schedule) = opts.schedule {
            obj.insert("schedule".into(), Value::String(schedule));
        }
        if let Some(repeat_every) = opts.repeat_every {
            obj.insert("repeat_every".into(), Value::Number(repeat_every.into()));
        }
        if let Some(priority) = opts.priority {
            obj.insert("priority".into(), Value::Number(priority.into()));
        }
        if let Some(limit) = opts.limit {
            obj.insert("limit".into(), Value::Number(limit.into()));
        }
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Delete a cron job.
    pub async fn delete_cron(&self, name: &str) -> Result<bool> {
        let cmd = serde_json::json!({"cmd": "CRONDELETE", "name": name});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// List all cron jobs.
    pub async fn list_crons(&self) -> Result<Vec<CronJob>> {
        let cmd = serde_json::json!({"cmd": "CRONLIST"});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        let crons = resp
            .get("crons")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value::<CronJob>(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(crons)
    }

    // === Flows ===

    /// Push a flow (parent job with children dependencies).
    pub async fn push_flow<T: Serialize>(
        &self,
        queue: &str,
        data: T,
        children: Vec<FlowChild>,
        opts: Option<PushOptions>,
    ) -> Result<FlowResult> {
        validate_queue_name(queue)?;
        let mut cmd = serde_json::json!({
            "cmd": "FLOW",
            "queue": queue,
            "data": serde_json::to_value(data)?,
            "children": serde_json::to_value(&children)?,
        });
        if let Some(opts) = opts {
            if let Some(p) = opts.priority {
                cmd.as_object_mut()
                    .unwrap()
                    .insert("priority".into(), Value::Number(p.into()));
            }
        }
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        let parent_id = resp.get("parent_id").and_then(|v| v.as_u64()).unwrap_or(0);
        let children_ids = resp
            .get("children_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
            .unwrap_or_default();
        Ok(FlowResult {
            parent_id,
            children_ids,
        })
    }

    // === Monitoring ===

    /// Get queue statistics.
    pub async fn stats(&self) -> Result<Stats> {
        let cmd = serde_json::json!({"cmd": "STATS"});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(Stats {
            queued: resp.get("queued").and_then(|v| v.as_u64()).unwrap_or(0),
            processing: resp.get("processing").and_then(|v| v.as_u64()).unwrap_or(0),
            delayed: resp.get("delayed").and_then(|v| v.as_u64()).unwrap_or(0),
            dlq: resp.get("dlq").and_then(|v| v.as_u64()).unwrap_or(0),
        })
    }

    /// Get detailed metrics.
    pub async fn metrics(&self) -> Result<Metrics> {
        let cmd = serde_json::json!({"cmd": "METRICS"});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(Metrics {
            total_pushed: resp
                .get("total_pushed")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            total_completed: resp
                .get("total_completed")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            total_failed: resp
                .get("total_failed")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            jobs_per_second: resp
                .get("jobs_per_second")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            avg_latency_ms: resp
                .get("avg_latency_ms")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            queues: resp
                .get("queues")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| serde_json::from_value::<QueueMetrics>(v.clone()).ok())
                        .collect()
                })
                .unwrap_or_default(),
        })
    }
}
