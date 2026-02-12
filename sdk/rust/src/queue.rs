use serde::Serialize;
use serde_json::Value;

use crate::client::FlashQ;
use crate::errors::Result;
use crate::types::*;

/// BullMQ-compatible Queue wrapper.
///
/// Provides a higher-level API that scopes all operations to a single queue name.
pub struct Queue {
    name: String,
    client: FlashQ,
}

impl Queue {
    /// Create a new queue with default client options.
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            client: FlashQ::new(),
        }
    }

    /// Create a new queue with custom client options.
    pub fn with_options(name: &str, opts: ClientOptions) -> Self {
        Self {
            name: name.to_string(),
            client: FlashQ::with_options(opts),
        }
    }

    /// Connect to the server.
    pub async fn connect(&self) -> Result<()> {
        self.client.connect().await
    }

    /// Close the connection.
    pub async fn close(&self) -> Result<()> {
        self.client.close().await
    }

    /// Add a job to the queue.
    pub async fn add<T: Serialize>(
        &self,
        _name: &str,
        data: T,
        opts: Option<PushOptions>,
    ) -> Result<u64> {
        self.client.push(&self.name, data, opts).await
    }

    /// Add multiple jobs to the queue.
    pub async fn add_bulk(&self, jobs: Vec<BulkJob>) -> Result<Vec<u64>> {
        let payloads: Vec<JobPayload> = jobs
            .into_iter()
            .map(|j| JobPayload {
                data: j.data,
                options: j.options.unwrap_or_default(),
            })
            .collect();
        let result = self.client.push_batch(&self.name, payloads).await?;
        Ok(result.ids)
    }

    /// Get a job by ID.
    pub async fn get_job(&self, job_id: u64) -> Result<Option<JobWithState>> {
        self.client.get_job(job_id).await
    }

    /// Wait for job completion.
    pub async fn finished(
        &self,
        job_id: u64,
        timeout: Option<std::time::Duration>,
    ) -> Result<Option<Value>> {
        self.client.finished(job_id, timeout).await
    }

    /// Pause the queue.
    pub async fn pause(&self) -> Result<bool> {
        self.client.pause(&self.name).await
    }

    /// Resume the queue.
    pub async fn resume(&self) -> Result<bool> {
        self.client.resume(&self.name).await
    }

    /// Check if the queue is paused.
    pub async fn is_paused(&self) -> Result<bool> {
        self.client.is_paused(&self.name).await
    }

    /// Get job counts by state.
    pub async fn get_job_counts(&self) -> Result<JobCounts> {
        self.client.get_job_counts(&self.name).await
    }

    /// Count waiting + delayed jobs.
    pub async fn count(&self) -> Result<u64> {
        self.client.count(&self.name).await
    }

    /// Drain all waiting jobs.
    pub async fn drain(&self) -> Result<u64> {
        self.client.drain(&self.name).await
    }

    /// Remove ALL queue data.
    pub async fn obliterate(&self) -> Result<bool> {
        self.client.obliterate(&self.name).await
    }

    /// Clean jobs older than grace period by state.
    pub async fn clean(&self, grace: u64, state: &str, limit: Option<u32>) -> Result<u64> {
        self.client.clean(&self.name, grace, state, limit).await
    }

    /// Get the queue name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Get a reference to the underlying client.
    pub fn client(&self) -> &FlashQ {
        &self.client
    }
}
