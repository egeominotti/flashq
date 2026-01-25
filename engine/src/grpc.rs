//! gRPC server implementation for flashQ
//!
//! Provides high-performance streaming API for job processing.

use std::pin::Pin;
use std::sync::Arc;

use tokio::sync::mpsc;
use tokio_stream::{wrappers::ReceiverStream, Stream, StreamExt};
use tonic::{Request, Response, Status, Streaming};

use crate::protocol::{
    Job as InternalJob, JobInput as InternalJobInput, JobState as InternalJobState,
};
use crate::queue::QueueManager;

// Include generated protobuf code
pub mod pb {
    tonic::include_proto!("flashq");
}

use pb::queue_service_server::{QueueService, QueueServiceServer};
use pb::*;

/// gRPC service implementation
pub struct QueueServiceImpl {
    queue_manager: Arc<QueueManager>,
}

impl QueueServiceImpl {
    pub fn new(queue_manager: Arc<QueueManager>) -> Self {
        Self { queue_manager }
    }

    pub fn into_server(self) -> QueueServiceServer<Self> {
        QueueServiceServer::new(self)
    }
}

// Helper conversions
impl From<InternalJob> for Job {
    fn from(job: InternalJob) -> Self {
        Job {
            id: job.id,
            queue: job.queue,
            data: serde_json::to_vec(&job.data).unwrap_or_default(),
            priority: job.priority,
            created_at: job.created_at,
            run_at: job.run_at,
            started_at: job.started_at,
            attempts: job.attempts,
            max_attempts: job.max_attempts,
            backoff: job.backoff,
            ttl: job.ttl,
            timeout: job.timeout,
            unique_key: job.unique_key,
            depends_on: job.depends_on,
            progress: job.progress as u32,
            progress_msg: job.progress_msg,
            lifo: job.lifo,
        }
    }
}

impl From<InternalJobState> for JobState {
    fn from(state: InternalJobState) -> Self {
        match state {
            InternalJobState::Waiting => JobState::Waiting,
            InternalJobState::Delayed => JobState::Delayed,
            InternalJobState::Active => JobState::Active,
            InternalJobState::Completed => JobState::Completed,
            InternalJobState::Failed => JobState::Failed,
            InternalJobState::WaitingChildren => JobState::WaitingChildren,
            InternalJobState::WaitingParent => JobState::WaitingChildren, // Map to same gRPC enum
            InternalJobState::Stalled => JobState::Active, // Map stalled to active for gRPC
            InternalJobState::Unknown => JobState::Unknown,
        }
    }
}

#[tonic::async_trait]
impl QueueService for QueueServiceImpl {
    // === Unary RPCs ===

    async fn push(&self, request: Request<PushRequest>) -> Result<Response<PushResponse>, Status> {
        let req = request.into_inner();

        let data: serde_json::Value = serde_json::from_slice(&req.data)
            .map_err(|e| Status::invalid_argument(format!("Invalid JSON data: {}", e)))?;

        let input = InternalJobInput {
            data,
            priority: req.priority,
            delay: if req.delay_ms > 0 {
                Some(req.delay_ms)
            } else {
                None
            },
            ttl: if req.ttl_ms > 0 {
                Some(req.ttl_ms)
            } else {
                None
            },
            timeout: if req.timeout_ms > 0 {
                Some(req.timeout_ms)
            } else {
                None
            },
            max_attempts: if req.max_attempts > 0 {
                Some(req.max_attempts)
            } else {
                None
            },
            backoff: if req.backoff_ms > 0 {
                Some(req.backoff_ms)
            } else {
                None
            },
            unique_key: req.unique_key,
            depends_on: if req.depends_on.is_empty() {
                None
            } else {
                Some(req.depends_on)
            },
            tags: None,
            lifo: req.lifo,
            remove_on_complete: false,
            remove_on_fail: false,
            stall_timeout: None,
            debounce_id: None,
            debounce_ttl: None,
            job_id: None,
            keep_completed_age: None,
            keep_completed_count: None,
            group_id: None,
        };

        match self.queue_manager.push(req.queue, input).await {
            Ok(job) => Ok(Response::new(PushResponse {
                ok: true,
                id: job.id,
            })),
            Err(e) => Err(Status::internal(e)),
        }
    }

    async fn push_batch(
        &self,
        request: Request<PushBatchRequest>,
    ) -> Result<Response<PushBatchResponse>, Status> {
        let req = request.into_inner();

        let mut jobs = Vec::with_capacity(req.jobs.len());
        for j in req.jobs {
            let data: serde_json::Value = serde_json::from_slice(&j.data)
                .map_err(|e| Status::invalid_argument(format!("Invalid JSON: {}", e)))?;

            jobs.push(InternalJobInput {
                data,
                priority: j.priority,
                delay: if j.delay_ms > 0 {
                    Some(j.delay_ms)
                } else {
                    None
                },
                ttl: if j.ttl_ms > 0 { Some(j.ttl_ms) } else { None },
                timeout: if j.timeout_ms > 0 {
                    Some(j.timeout_ms)
                } else {
                    None
                },
                max_attempts: if j.max_attempts > 0 {
                    Some(j.max_attempts)
                } else {
                    None
                },
                backoff: if j.backoff_ms > 0 {
                    Some(j.backoff_ms)
                } else {
                    None
                },
                unique_key: j.unique_key,
                depends_on: if j.depends_on.is_empty() {
                    None
                } else {
                    Some(j.depends_on)
                },
                tags: None,
                lifo: j.lifo,
                remove_on_complete: false,
                remove_on_fail: false,
                stall_timeout: None,
                debounce_id: None,
                debounce_ttl: None,
                job_id: None,
                keep_completed_age: None,
                keep_completed_count: None,
                group_id: None,
            });
        }

        let ids = self.queue_manager.push_batch(req.queue, jobs).await;
        Ok(Response::new(PushBatchResponse { ok: true, ids }))
    }

    async fn pull(&self, request: Request<PullRequest>) -> Result<Response<Job>, Status> {
        let req = request.into_inner();
        let job = self.queue_manager.pull(&req.queue).await;
        Ok(Response::new(job.into()))
    }

    async fn pull_batch(
        &self,
        request: Request<PullBatchRequest>,
    ) -> Result<Response<PullBatchResponse>, Status> {
        let req = request.into_inner();
        // Limit batch size to prevent DOS attacks (max 1000 jobs per request)
        const MAX_BATCH_SIZE: u32 = 1000;
        let count = (req.count as usize).min(MAX_BATCH_SIZE as usize);
        let jobs = self.queue_manager.pull_batch(&req.queue, count).await;
        Ok(Response::new(PullBatchResponse {
            jobs: jobs.into_iter().map(Into::into).collect(),
        }))
    }

    async fn ack(&self, request: Request<AckRequest>) -> Result<Response<AckResponse>, Status> {
        let req = request.into_inner();

        let result = if let Some(data) = req.result {
            Some(
                serde_json::from_slice(&data)
                    .map_err(|e| Status::invalid_argument(format!("Invalid result JSON: {}", e)))?,
            )
        } else {
            None
        };

        match self.queue_manager.ack(req.id, result).await {
            Ok(()) => Ok(Response::new(AckResponse { ok: true })),
            Err(e) => Err(Status::not_found(e)),
        }
    }

    async fn ack_batch(
        &self,
        request: Request<AckBatchRequest>,
    ) -> Result<Response<AckBatchResponse>, Status> {
        let req = request.into_inner();
        let acked = self.queue_manager.ack_batch(&req.ids).await;
        Ok(Response::new(AckBatchResponse {
            ok: true,
            acked: acked as u32,
        }))
    }

    async fn fail(&self, request: Request<FailRequest>) -> Result<Response<FailResponse>, Status> {
        let req = request.into_inner();
        match self.queue_manager.fail(req.id, req.error).await {
            Ok(()) => Ok(Response::new(FailResponse { ok: true })),
            Err(e) => Err(Status::not_found(e)),
        }
    }

    async fn get_state(
        &self,
        request: Request<GetStateRequest>,
    ) -> Result<Response<GetStateResponse>, Status> {
        let req = request.into_inner();
        let state = self.queue_manager.get_state(req.id);
        Ok(Response::new(GetStateResponse {
            id: req.id,
            state: JobState::from(state).into(),
        }))
    }

    async fn stats(
        &self,
        _request: Request<StatsRequest>,
    ) -> Result<Response<StatsResponse>, Status> {
        let (queued, processing, delayed, dlq, completed) = self.queue_manager.stats().await;
        Ok(Response::new(StatsResponse {
            queued: queued as u64,
            processing: processing as u64,
            delayed: delayed as u64,
            dlq: dlq as u64,
            completed: completed as u64,
        }))
    }

    // === Streaming RPCs ===

    type StreamJobsStream = Pin<Box<dyn Stream<Item = Result<Job, Status>> + Send>>;

    async fn stream_jobs(
        &self,
        request: Request<StreamJobsRequest>,
    ) -> Result<Response<Self::StreamJobsStream>, Status> {
        let req = request.into_inner();
        let queue = req.queue;
        // Limit batch size to prevent DOS attacks
        const MAX_BATCH_SIZE: usize = 100;
        const MAX_PREFETCH: usize = 1000;
        let batch_size = if req.batch_size > 0 {
            (req.batch_size as usize).min(MAX_BATCH_SIZE)
        } else {
            1
        };
        let qm = Arc::clone(&self.queue_manager);

        let (tx, rx) = mpsc::channel((req.prefetch as usize).clamp(1, MAX_PREFETCH));

        // Spawn background task to pull jobs and send to stream
        // Uses timeout to periodically check if client disconnected
        tokio::spawn(async move {
            loop {
                // Check if client disconnected before blocking on pull
                if tx.is_closed() {
                    break;
                }

                if batch_size == 1 {
                    // Use timeout to periodically check for client disconnect
                    let pull_result =
                        tokio::time::timeout(tokio::time::Duration::from_secs(30), qm.pull(&queue))
                            .await;

                    match pull_result {
                        Ok(job) => {
                            if tx.send(Ok(job.into())).await.is_err() {
                                break; // Client disconnected
                            }
                        }
                        Err(_) => {
                            // Timeout - check if client still connected and retry
                            if tx.is_closed() {
                                break;
                            }
                        }
                    }
                } else {
                    let jobs = qm.pull_batch(&queue, batch_size).await;
                    for job in jobs {
                        if tx.send(Ok(job.into())).await.is_err() {
                            break;
                        }
                    }
                    // Small delay to prevent busy loop when queue is empty
                    if tx.is_closed() {
                        break;
                    }
                }
            }
        });

        let stream = ReceiverStream::new(rx);
        Ok(Response::new(Box::pin(stream)))
    }

    type ProcessJobsStream = Pin<Box<dyn Stream<Item = Result<Job, Status>> + Send>>;

    async fn process_jobs(
        &self,
        request: Request<Streaming<JobResult>>,
    ) -> Result<Response<Self::ProcessJobsStream>, Status> {
        let mut inbound = request.into_inner();
        let qm = Arc::clone(&self.queue_manager);
        let qm2 = Arc::clone(&self.queue_manager);

        let (tx, rx) = mpsc::channel(32);

        // Task to process incoming results from client
        tokio::spawn(async move {
            while let Some(result) = inbound.next().await {
                match result {
                    Ok(job_result) => {
                        if job_result.success {
                            let result_data = job_result
                                .result
                                .and_then(|d| serde_json::from_slice(&d).ok());
                            let _ = qm.ack(job_result.id, result_data).await;
                        } else {
                            let _ = qm.fail(job_result.id, job_result.error).await;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // Task to send jobs to client
        // NOTE: This bidirectional stream uses "default" queue. For production use,
        // clients should use the unidirectional stream_jobs() RPC which accepts a queue parameter,
        // or use the HTTP/WebSocket API for queue-specific streaming.
        tokio::spawn(async move {
            let queue = "default".to_string();
            loop {
                // Check if client disconnected before blocking on pull
                if tx.is_closed() {
                    break;
                }

                // Use timeout to periodically check for client disconnect
                let pull_result =
                    tokio::time::timeout(tokio::time::Duration::from_secs(30), qm2.pull(&queue))
                        .await;

                match pull_result {
                    Ok(job) => {
                        if tx.send(Ok(job.into())).await.is_err() {
                            break; // Client disconnected
                        }
                    }
                    Err(_) => {
                        // Timeout - check if client still connected and retry
                        if tx.is_closed() {
                            break;
                        }
                    }
                }
            }
        });

        let stream = ReceiverStream::new(rx);
        Ok(Response::new(Box::pin(stream)))
    }
}

/// Create and run the gRPC server
pub async fn run_grpc_server(
    addr: std::net::SocketAddr,
    queue_manager: Arc<QueueManager>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let service = QueueServiceImpl::new(queue_manager);

    tonic::transport::Server::builder()
        .add_service(service.into_server())
        .serve(addr)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::Job as InternalJob;
    use serde_json::json;

    /// Helper to create a test internal job.
    fn create_test_internal_job(id: u64) -> InternalJob {
        InternalJob {
            id,
            queue: "test-queue".to_string(),
            data: Arc::new(json!({"test": "data"})),
            priority: 10,
            created_at: 1000,
            run_at: 1000,
            started_at: 500,
            attempts: 1,
            max_attempts: 3,
            backoff: 1000,
            ttl: 60000,
            timeout: 30000,
            unique_key: Some("unique".to_string()),
            depends_on: vec![1, 2],
            progress: 50,
            progress_msg: Some("halfway".to_string()),
            tags: vec!["tag1".to_string()],
            lifo: true,
            remove_on_complete: false,
            remove_on_fail: false,
            last_heartbeat: 0,
            stall_timeout: 0,
            stall_count: 0,
            parent_id: None,
            children_ids: vec![],
            children_completed: 0,
            custom_id: None,
            keep_completed_age: 0,
            keep_completed_count: 0,
            completed_at: 0,
            group_id: None,
        }
    }

    #[test]
    fn test_internal_job_to_grpc_job_conversion() {
        let internal = create_test_internal_job(123);
        let grpc_job: Job = internal.into();

        assert_eq!(grpc_job.id, 123);
        assert_eq!(grpc_job.queue, "test-queue");
        assert_eq!(grpc_job.priority, 10);
        assert_eq!(grpc_job.created_at, 1000);
        assert_eq!(grpc_job.run_at, 1000);
        assert_eq!(grpc_job.started_at, 500);
        assert_eq!(grpc_job.attempts, 1);
        assert_eq!(grpc_job.max_attempts, 3);
        assert_eq!(grpc_job.backoff, 1000);
        assert_eq!(grpc_job.ttl, 60000);
        assert_eq!(grpc_job.timeout, 30000);
        assert_eq!(grpc_job.unique_key, Some("unique".to_string()));
        assert_eq!(grpc_job.depends_on, vec![1, 2]);
        assert_eq!(grpc_job.progress, 50);
        assert_eq!(grpc_job.progress_msg, Some("halfway".to_string()));
        assert!(grpc_job.lifo);
    }

    #[test]
    fn test_internal_job_data_serialization() {
        let internal = create_test_internal_job(1);
        let grpc_job: Job = internal.into();

        // Data should be serialized as JSON bytes
        let data: serde_json::Value =
            serde_json::from_slice(&grpc_job.data).expect("Data should be valid JSON");
        assert_eq!(data["test"], "data");
    }

    #[test]
    fn test_job_state_conversion_waiting() {
        let state: JobState = InternalJobState::Waiting.into();
        assert_eq!(state, JobState::Waiting);
    }

    #[test]
    fn test_job_state_conversion_delayed() {
        let state: JobState = InternalJobState::Delayed.into();
        assert_eq!(state, JobState::Delayed);
    }

    #[test]
    fn test_job_state_conversion_active() {
        let state: JobState = InternalJobState::Active.into();
        assert_eq!(state, JobState::Active);
    }

    #[test]
    fn test_job_state_conversion_completed() {
        let state: JobState = InternalJobState::Completed.into();
        assert_eq!(state, JobState::Completed);
    }

    #[test]
    fn test_job_state_conversion_failed() {
        let state: JobState = InternalJobState::Failed.into();
        assert_eq!(state, JobState::Failed);
    }

    #[test]
    fn test_job_state_conversion_waiting_children() {
        let state: JobState = InternalJobState::WaitingChildren.into();
        assert_eq!(state, JobState::WaitingChildren);
    }

    #[test]
    fn test_job_state_conversion_stalled_maps_to_active() {
        // Stalled is mapped to Active in gRPC
        let state: JobState = InternalJobState::Stalled.into();
        assert_eq!(state, JobState::Active);
    }

    #[test]
    fn test_job_state_conversion_unknown() {
        let state: JobState = InternalJobState::Unknown.into();
        assert_eq!(state, JobState::Unknown);
    }

    #[tokio::test]
    async fn test_queue_service_impl_creation() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(qm);
        // Service should be created successfully
        let _ = service.into_server();
    }

    #[test]
    fn test_job_with_empty_optional_fields() {
        let internal = InternalJob {
            id: 1,
            queue: "q".to_string(),
            data: Arc::new(json!(null)),
            priority: 0,
            created_at: 0,
            run_at: 0,
            started_at: 0,
            attempts: 0,
            max_attempts: 0,
            backoff: 0,
            ttl: 0,
            timeout: 0,
            unique_key: None,
            depends_on: vec![],
            progress: 0,
            progress_msg: None,
            tags: vec![],
            lifo: false,
            remove_on_complete: false,
            remove_on_fail: false,
            last_heartbeat: 0,
            stall_timeout: 0,
            stall_count: 0,
            parent_id: None,
            children_ids: vec![],
            children_completed: 0,
            custom_id: None,
            keep_completed_age: 0,
            keep_completed_count: 0,
            completed_at: 0,
            group_id: None,
        };

        let grpc_job: Job = internal.into();
        assert_eq!(grpc_job.id, 1);
        assert!(grpc_job.unique_key.is_none());
        assert!(grpc_job.depends_on.is_empty());
        assert!(grpc_job.progress_msg.is_none());
    }

    // ==================== GRPC SERVICE FUNCTIONAL TESTS ====================

    #[tokio::test]
    async fn test_grpc_push_operation() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(qm);

        let request = Request::new(PushRequest {
            queue: "grpc-test".to_string(),
            data: serde_json::to_vec(&json!({"key": "value"})).unwrap(),
            priority: 10,
            delay_ms: 0,
            ttl_ms: 0,
            timeout_ms: 30000,
            max_attempts: 3,
            backoff_ms: 1000,
            unique_key: None,
            depends_on: vec![],
            lifo: false,
        });

        let response = service.push(request).await.unwrap();
        let resp = response.into_inner();
        assert!(resp.ok);
        assert!(resp.id > 0);
    }

    #[tokio::test]
    async fn test_grpc_push_batch_operation() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(qm);

        let jobs = vec![
            JobInput {
                data: serde_json::to_vec(&json!({"i": 1})).unwrap(),
                priority: 0,
                delay_ms: 0,
                ttl_ms: 0,
                timeout_ms: 0,
                max_attempts: 0,
                backoff_ms: 0,
                unique_key: None,
                depends_on: vec![],
                lifo: false,
            },
            JobInput {
                data: serde_json::to_vec(&json!({"i": 2})).unwrap(),
                priority: 5,
                delay_ms: 0,
                ttl_ms: 0,
                timeout_ms: 0,
                max_attempts: 0,
                backoff_ms: 0,
                unique_key: None,
                depends_on: vec![],
                lifo: false,
            },
        ];

        let request = Request::new(PushBatchRequest {
            queue: "grpc-batch-test".to_string(),
            jobs,
        });

        let response = service.push_batch(request).await.unwrap();
        let resp = response.into_inner();
        assert!(resp.ok);
        assert_eq!(resp.ids.len(), 2);
    }

    #[tokio::test]
    async fn test_grpc_pull_operation() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(Arc::clone(&qm));

        // First push a job
        let _ = qm
            .push(
                "grpc-pull-test".to_string(),
                crate::protocol::JobInput::new(json!({"test": true})),
            )
            .await
            .unwrap();

        // Now pull it via gRPC
        let request = Request::new(PullRequest {
            queue: "grpc-pull-test".to_string(),
        });

        let response = service.pull(request).await.unwrap();
        let job = response.into_inner();
        assert!(job.id > 0);
        assert_eq!(job.queue, "grpc-pull-test");
    }

    #[tokio::test]
    async fn test_grpc_pull_batch_operation() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(Arc::clone(&qm));

        // Push multiple jobs
        for i in 0..5 {
            let _ = qm
                .push(
                    "grpc-pullb-test".to_string(),
                    crate::protocol::JobInput::new(json!({"i": i})),
                )
                .await
                .unwrap();
        }

        // Pull batch
        let request = Request::new(PullBatchRequest {
            queue: "grpc-pullb-test".to_string(),
            count: 3,
        });

        let response = service.pull_batch(request).await.unwrap();
        let resp = response.into_inner();
        assert_eq!(resp.jobs.len(), 3);
    }

    #[tokio::test]
    async fn test_grpc_ack_operation() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(Arc::clone(&qm));

        // Push and pull a job
        let job = qm
            .push(
                "grpc-ack-test".to_string(),
                crate::protocol::JobInput::new(json!({})),
            )
            .await
            .unwrap();
        let _ = qm.pull("grpc-ack-test").await;

        // Ack via gRPC
        let request = Request::new(AckRequest {
            id: job.id,
            result: Some(serde_json::to_vec(&json!({"done": true})).unwrap()),
        });

        let response = service.ack(request).await.unwrap();
        assert!(response.into_inner().ok);

        // Verify job is completed
        let state = qm.get_state(job.id);
        assert_eq!(state, crate::protocol::JobState::Completed);
    }

    #[tokio::test]
    async fn test_grpc_ack_batch_operation() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(Arc::clone(&qm));

        // Push and pull multiple jobs
        let mut ids = vec![];
        for _ in 0..3 {
            let job = qm
                .push(
                    "grpc-ackb-test".to_string(),
                    crate::protocol::JobInput::new(json!({})),
                )
                .await
                .unwrap();
            ids.push(job.id);
        }
        let _ = qm.pull_batch("grpc-ackb-test", 3).await;

        // Ack batch via gRPC
        let request = Request::new(AckBatchRequest { ids: ids.clone() });

        let response = service.ack_batch(request).await.unwrap();
        let resp = response.into_inner();
        assert!(resp.ok);
        assert_eq!(resp.acked, 3);
    }

    #[tokio::test]
    async fn test_grpc_fail_operation() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(Arc::clone(&qm));

        // Push and pull a job with max_attempts=1
        let job = qm
            .push(
                "grpc-fail-test".to_string(),
                crate::protocol::JobInput {
                    data: json!({}),
                    max_attempts: Some(1),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let _ = qm.pull("grpc-fail-test").await;

        // Fail via gRPC
        let request = Request::new(FailRequest {
            id: job.id,
            error: Some("test error".to_string()),
        });

        let response = service.fail(request).await.unwrap();
        assert!(response.into_inner().ok);

        // Verify job is in DLQ
        let state = qm.get_state(job.id);
        assert_eq!(state, crate::protocol::JobState::Failed);
    }

    #[tokio::test]
    async fn test_grpc_get_state_operation() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(Arc::clone(&qm));

        // Push a job
        let job = qm
            .push(
                "grpc-state-test".to_string(),
                crate::protocol::JobInput::new(json!({})),
            )
            .await
            .unwrap();

        // Get state via gRPC
        let request = Request::new(GetStateRequest { id: job.id });

        let response = service.get_state(request).await.unwrap();
        let resp = response.into_inner();
        assert_eq!(resp.id, job.id);
        assert_eq!(resp.state, JobState::Waiting as i32);
    }

    #[tokio::test]
    async fn test_grpc_stats_operation() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(Arc::clone(&qm));

        // Push some jobs
        for _ in 0..5 {
            let _ = qm
                .push(
                    "grpc-stats-test".to_string(),
                    crate::protocol::JobInput::new(json!({})),
                )
                .await
                .unwrap();
        }

        // Get stats via gRPC
        let request = Request::new(StatsRequest {});

        let response = service.stats(request).await.unwrap();
        let resp = response.into_inner();
        assert!(resp.queued >= 5);
    }

    #[tokio::test]
    async fn test_grpc_push_invalid_json_error() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(qm);

        // Send invalid JSON bytes
        let request = Request::new(PushRequest {
            queue: "grpc-error-test".to_string(),
            data: vec![0xFF, 0xFE], // Invalid JSON
            priority: 0,
            delay_ms: 0,
            ttl_ms: 0,
            timeout_ms: 0,
            max_attempts: 0,
            backoff_ms: 0,
            unique_key: None,
            depends_on: vec![],
            lifo: false,
        });

        let result = service.push(request).await;
        assert!(result.is_err());
        let status = result.unwrap_err();
        assert_eq!(status.code(), tonic::Code::InvalidArgument);
    }

    #[tokio::test]
    async fn test_grpc_ack_not_found_error() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(qm);

        // Try to ack a non-existent job
        let request = Request::new(AckRequest {
            id: 999999,
            result: None,
        });

        let result = service.ack(request).await;
        assert!(result.is_err());
        let status = result.unwrap_err();
        assert_eq!(status.code(), tonic::Code::NotFound);
    }

    #[tokio::test]
    async fn test_grpc_fail_not_found_error() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(qm);

        // Try to fail a non-existent job
        let request = Request::new(FailRequest {
            id: 999999,
            error: Some("error".to_string()),
        });

        let result = service.fail(request).await;
        assert!(result.is_err());
        let status = result.unwrap_err();
        assert_eq!(status.code(), tonic::Code::NotFound);
    }

    #[tokio::test]
    async fn test_grpc_push_with_all_options() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(qm);

        let request = Request::new(PushRequest {
            queue: "grpc-options-test".to_string(),
            data: serde_json::to_vec(&json!({"full": "options"})).unwrap(),
            priority: 100,
            delay_ms: 5000,
            ttl_ms: 60000,
            timeout_ms: 30000,
            max_attempts: 5,
            backoff_ms: 2000,
            unique_key: Some("unique-key-123".to_string()),
            depends_on: vec![],
            lifo: true,
        });

        let response = service.push(request).await.unwrap();
        let resp = response.into_inner();
        assert!(resp.ok);
        assert!(resp.id > 0);
    }

    #[tokio::test]
    async fn test_grpc_state_unknown_job() {
        let qm = crate::queue::QueueManager::new(false);
        let service = QueueServiceImpl::new(qm);

        let request = Request::new(GetStateRequest { id: 999999 });

        let response = service.get_state(request).await.unwrap();
        let resp = response.into_inner();
        assert_eq!(resp.state, JobState::Unknown as i32);
    }
}
