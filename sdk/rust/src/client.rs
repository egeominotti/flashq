use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tracing::debug;

use crate::constants::{CLIENT_TIMEOUT_BUFFER_MS, DEFAULT_PULL_TIMEOUT_MS};
use crate::errors::{check_response, FlashQError, Result};
use crate::pool::ConnectionPool;
use crate::types::*;
use crate::validation::{validate_batch_size, validate_queue_name};

/// flashQ client with connection pooling.
pub struct FlashQ {
    pub(crate) pool: ConnectionPool,
    pub(crate) opts: ClientOptions,
}

impl FlashQ {
    /// Create a new client with default options.
    pub fn new() -> Self {
        Self::with_options(ClientOptions::default())
    }

    /// Create a new client with custom options.
    pub fn with_options(opts: ClientOptions) -> Self {
        Self {
            pool: ConnectionPool::new(opts.clone()),
            opts,
        }
    }

    /// Connect to the server.
    pub async fn connect(&self) -> Result<()> {
        self.pool.connect().await
    }

    /// Close all connections.
    pub async fn close(&self) -> Result<()> {
        self.pool.close().await
    }

    /// Check if connected to the server.
    pub fn is_connected(&self) -> bool {
        self.pool.is_connected()
    }

    /// Get pool statistics: (reconnects, failures, healthy_connections).
    pub fn pool_stats(&self) -> (u64, u64, usize) {
        self.pool.stats()
    }

    /// Send a command with the default timeout.
    pub(crate) async fn send(&self, cmd: Value) -> Result<Value> {
        self.pool.send(cmd, self.opts.timeout).await
    }

    /// Send a command with a custom timeout.
    pub(crate) async fn send_with_timeout(&self, cmd: Value, timeout: Duration) -> Result<Value> {
        self.pool.send(cmd, timeout).await
    }

    // === Authentication ===

    /// Authenticate with the server.
    pub async fn auth(&self, token: &str) -> Result<bool> {
        let cmd = serde_json::json!({"cmd": "AUTH", "token": token});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Ping the server.
    pub async fn ping(&self) -> Result<bool> {
        let cmd = serde_json::json!({"cmd": "STATS"});
        let resp = self.send(cmd).await?;
        Ok(resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false))
    }

    // === Core Operations ===

    /// Push a job to a queue.
    pub async fn push<T: Serialize>(
        &self,
        queue: &str,
        data: T,
        opts: Option<PushOptions>,
    ) -> Result<u64> {
        validate_queue_name(queue)?;
        let mut cmd = serde_json::json!({
            "cmd": "PUSH",
            "queue": queue,
            "data": serde_json::to_value(data)?,
        });
        if let Some(opts) = opts {
            opts.merge_into(&mut cmd);
        }
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        resp.get("id")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| FlashQError::Protocol("missing id in PUSH response".into()))
    }

    /// Push multiple jobs to a queue.
    pub async fn push_batch(&self, queue: &str, jobs: Vec<JobPayload>) -> Result<BatchPushResult> {
        validate_queue_name(queue)?;
        validate_batch_size(jobs.len())?;
        let jobs_value: Vec<Value> = jobs
            .into_iter()
            .map(serde_json::to_value)
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let cmd = serde_json::json!({
            "cmd": "PUSHB",
            "queue": queue,
            "jobs": jobs_value,
        });
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        let ids = resp
            .get("ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
            .unwrap_or_default();
        Ok(BatchPushResult { ids })
    }

    /// Pull a single job from a queue (blocking).
    pub async fn pull(&self, queue: &str, timeout: Option<Duration>) -> Result<Option<Job>> {
        validate_queue_name(queue)?;
        let timeout_ms = timeout
            .map(|d| d.as_millis() as u64)
            .unwrap_or(DEFAULT_PULL_TIMEOUT_MS);
        let cmd = serde_json::json!({
            "cmd": "PULL",
            "queue": queue,
            "timeout": timeout_ms,
        });
        let client_timeout = Duration::from_millis(timeout_ms + CLIENT_TIMEOUT_BUFFER_MS);
        let resp = self.send_with_timeout(cmd, client_timeout).await?;
        check_response(&resp)?;
        extract_job(&resp, "job")
    }

    /// Pull multiple jobs from a queue.
    pub async fn pull_batch(
        &self,
        queue: &str,
        count: u32,
        timeout: Option<Duration>,
    ) -> Result<Vec<Job>> {
        validate_queue_name(queue)?;
        let timeout_ms = timeout
            .map(|d| d.as_millis() as u64)
            .unwrap_or(DEFAULT_PULL_TIMEOUT_MS);
        let cmd = serde_json::json!({
            "cmd": "PULLB",
            "queue": queue,
            "count": count,
            "timeout": timeout_ms,
        });
        let client_timeout = Duration::from_millis(timeout_ms + CLIENT_TIMEOUT_BUFFER_MS);
        let resp = self.send_with_timeout(cmd, client_timeout).await?;
        check_response(&resp)?;
        Ok(extract_jobs(&resp, "jobs"))
    }

    /// Acknowledge job completion with optional result.
    pub async fn ack(&self, job_id: u64, result: Option<Value>) -> Result<bool> {
        let mut cmd = serde_json::json!({"cmd": "ACK", "id": job_id});
        if let Some(r) = result {
            cmd.as_object_mut().unwrap().insert("result".into(), r);
        }
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }

    /// Acknowledge multiple jobs.
    pub async fn ack_batch(&self, job_ids: Vec<u64>) -> Result<u32> {
        validate_batch_size(job_ids.len())?;
        let cmd = serde_json::json!({"cmd": "ACKB", "ids": job_ids});
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(resp
            .get("count")
            .and_then(|v| v.as_u64())
            .unwrap_or(job_ids.len() as u64) as u32)
    }

    /// Fail a job with optional error message.
    pub async fn fail(&self, job_id: u64, error: Option<&str>) -> Result<bool> {
        let mut cmd = serde_json::json!({"cmd": "FAIL", "id": job_id});
        if let Some(e) = error {
            cmd.as_object_mut()
                .unwrap()
                .insert("error".into(), Value::String(e.to_string()));
        }
        let resp = self.send(cmd).await?;
        check_response(&resp)?;
        Ok(true)
    }
}

impl Default for FlashQ {
    fn default() -> Self {
        Self::new()
    }
}

// === Response extraction helpers ===

pub(crate) fn extract_job(resp: &Value, key: &str) -> Result<Option<Job>> {
    match resp.get(key) {
        Some(Value::Null) | None => Ok(None),
        Some(v) => {
            let job: Job = serde_json::from_value(v.clone())
                .map_err(|e| FlashQError::Protocol(format!("failed to parse job: {e}")))?;
            Ok(Some(job))
        }
    }
}

pub(crate) fn extract_jobs(resp: &Value, key: &str) -> Vec<Job> {
    resp.get(key)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| serde_json::from_value::<Job>(v.clone()).ok())
                .collect()
        })
        .unwrap_or_default()
}

impl Drop for FlashQ {
    fn drop(&mut self) {
        debug!("FlashQ client dropped");
    }
}
