use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::mpsc;
use tokio::sync::Notify;
use tracing::{debug, info, warn};

use crate::client::FlashQ;
use crate::errors::Result;
use crate::types::*;

/// Processor function type for the worker.
pub type ProcessorFn =
    Arc<dyn Fn(Job) -> Pin<Box<dyn Future<Output = Result<Value>> + Send>> + Send + Sync>;

const STATE_IDLE: u8 = 0;
const STATE_RUNNING: u8 = 1;
const STATE_STOPPING: u8 = 2;
const STATE_STOPPED: u8 = 3;

type EventHandler = Arc<dyn Fn(WorkerEventData) + Send + Sync>;

/// Event data passed to event handlers.
#[derive(Debug, Clone)]
pub enum WorkerEventData {
    Ready,
    Active {
        job_id: u64,
        worker_id: usize,
    },
    Completed {
        job_id: u64,
        result: Value,
        worker_id: usize,
    },
    Failed {
        job_id: u64,
        error: String,
        worker_id: usize,
    },
    Error {
        error: String,
    },
    Stopping,
    Stopped,
    Drained,
}

/// Worker for processing jobs from queues.
pub struct Worker {
    queues: Vec<String>,
    processor: ProcessorFn,
    client_opts: ClientOptions,
    worker_opts: WorkerOptions,
    state: AtomicU8,
    processing: AtomicU32,
    processed: AtomicU64,
    failed: AtomicU64,
    shutdown: Arc<Notify>,
    events: std::sync::RwLock<Vec<(WorkerEvent, EventHandler)>>,
}

impl Worker {
    /// Create a new worker with a processor function.
    pub fn new<F, Fut>(queues: Vec<String>, processor: F, opts: Option<WorkerOptions>) -> Self
    where
        F: Fn(Job) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Value>> + Send + 'static,
    {
        let worker_opts = opts.unwrap_or_default();
        let client_opts = worker_opts.client_options.clone().unwrap_or_default();

        let processor = Arc::new(
            move |job: Job| -> Pin<Box<dyn Future<Output = Result<Value>> + Send>> {
                Box::pin(processor(job))
            },
        );

        Self {
            queues,
            processor,
            client_opts,
            worker_opts,
            state: AtomicU8::new(STATE_IDLE),
            processing: AtomicU32::new(0),
            processed: AtomicU64::new(0),
            failed: AtomicU64::new(0),
            shutdown: Arc::new(Notify::new()),
            events: std::sync::RwLock::new(Vec::new()),
        }
    }

    /// Register an event handler. Returns self for chaining.
    pub fn on<F>(&self, event: WorkerEvent, handler: F) -> &Self
    where
        F: Fn(WorkerEventData) + Send + Sync + 'static,
    {
        let mut events = self.events.write().unwrap();
        events.push((event, Arc::new(handler)));
        self
    }

    /// Start the worker.
    pub async fn start(&self) -> Result<()> {
        if self.state.load(Ordering::SeqCst) == STATE_RUNNING {
            return Ok(());
        }

        self.state.store(STATE_RUNNING, Ordering::SeqCst);
        self.emit(WorkerEvent::Ready, WorkerEventData::Ready);
        info!(
            "worker started with {} queues, concurrency={}",
            self.queues.len(),
            self.worker_opts.concurrency
        );

        let client = FlashQ::with_options(self.client_opts.clone());
        client.connect().await?;

        let (tx, rx) = mpsc::channel::<Job>(self.worker_opts.concurrency * 2);
        let rx = Arc::new(tokio::sync::Mutex::new(rx));

        // Puller tasks
        let num_pullers = (self.worker_opts.concurrency / 2).clamp(1, 4);
        let mut puller_handles = Vec::new();

        for puller_id in 0..num_pullers {
            let client_ref = &client as *const FlashQ as usize;
            let tx = tx.clone();
            let queues = self.queues.clone();
            let state_ptr = &self.state as *const AtomicU8 as usize;

            let handle = tokio::spawn(async move {
                let client = unsafe { &*(client_ref as *const FlashQ) };
                let state = unsafe { &*(state_ptr as *const AtomicU8) };
                let mut queue_idx = puller_id;

                loop {
                    if state.load(Ordering::SeqCst) != STATE_RUNNING {
                        break;
                    }

                    let queue = &queues[queue_idx % queues.len()];
                    queue_idx += 1;

                    match client.pull(queue, Some(Duration::from_secs(5))).await {
                        Ok(Some(job)) => {
                            if tx.send(job).await.is_err() {
                                break;
                            }
                        }
                        Ok(None) => {}
                        Err(e) => {
                            debug!("puller {puller_id} error: {e}");
                            tokio::time::sleep(Duration::from_millis(500)).await;
                        }
                    }
                }
                debug!("puller {puller_id} stopped");
            });
            puller_handles.push(handle);
        }
        drop(tx);

        // Processor tasks
        let mut processor_handles = Vec::new();

        for worker_id in 0..self.worker_opts.concurrency {
            let rx = rx.clone();
            let processor = self.processor.clone();
            let client_ref = &client as *const FlashQ as usize;
            let processing_ptr = &self.processing as *const AtomicU32 as usize;
            let processed_ptr = &self.processed as *const AtomicU64 as usize;
            let failed_ptr = &self.failed as *const AtomicU64 as usize;
            let events = self.events.read().unwrap().clone();

            let handle = tokio::spawn(async move {
                let client = unsafe { &*(client_ref as *const FlashQ) };
                let processing = unsafe { &*(processing_ptr as *const AtomicU32) };
                let processed = unsafe { &*(processed_ptr as *const AtomicU64) };
                let failed = unsafe { &*(failed_ptr as *const AtomicU64) };

                loop {
                    let job = {
                        let mut rx = rx.lock().await;
                        rx.recv().await
                    };

                    let job = match job {
                        Some(j) => j,
                        None => break,
                    };

                    let job_id = job.id;
                    processing.fetch_add(1, Ordering::Relaxed);

                    emit_event(
                        &events,
                        WorkerEvent::Active,
                        WorkerEventData::Active { job_id, worker_id },
                    );

                    match processor(job).await {
                        Ok(result) => {
                            if let Err(e) = client.ack(job_id, Some(result.clone())).await {
                                warn!("ack failed for job {job_id}: {e}");
                            }
                            processed.fetch_add(1, Ordering::Relaxed);
                            emit_event(
                                &events,
                                WorkerEvent::Completed,
                                WorkerEventData::Completed {
                                    job_id,
                                    result,
                                    worker_id,
                                },
                            );
                        }
                        Err(e) => {
                            let err_msg = e.to_string();
                            if let Err(fail_err) = client.fail(job_id, Some(&err_msg)).await {
                                warn!("fail call failed for job {job_id}: {fail_err}");
                            }
                            failed.fetch_add(1, Ordering::Relaxed);
                            emit_event(
                                &events,
                                WorkerEvent::Failed,
                                WorkerEventData::Failed {
                                    job_id,
                                    error: err_msg,
                                    worker_id,
                                },
                            );
                        }
                    }

                    processing.fetch_sub(1, Ordering::Relaxed);
                }
                debug!("processor {worker_id} stopped");
            });
            processor_handles.push(handle);
        }

        // Wait for shutdown signal
        self.shutdown.notified().await;
        self.emit(WorkerEvent::Stopping, WorkerEventData::Stopping);
        self.state.store(STATE_STOPPING, Ordering::SeqCst);

        // Abort pullers
        for h in puller_handles {
            h.abort();
        }

        // Wait for processors to drain
        let timeout = self.worker_opts.close_timeout;
        let _ = tokio::time::timeout(timeout, async {
            for h in processor_handles {
                let _ = h.await;
            }
        })
        .await;

        let _ = client.close().await;
        self.state.store(STATE_STOPPED, Ordering::SeqCst);
        self.emit(WorkerEvent::Stopped, WorkerEventData::Stopped);
        info!(
            "worker stopped (processed={}, failed={})",
            self.processed(),
            self.failed()
        );

        Ok(())
    }

    /// Stop the worker.
    pub fn stop(&self) {
        self.shutdown.notify_one();
    }

    /// Get current processing count.
    pub fn processing(&self) -> u32 {
        self.processing.load(Ordering::Relaxed)
    }

    /// Get total processed count.
    pub fn processed(&self) -> u64 {
        self.processed.load(Ordering::Relaxed)
    }

    /// Get total failed count.
    pub fn failed(&self) -> u64 {
        self.failed.load(Ordering::Relaxed)
    }

    /// Check if the worker is running.
    pub fn is_running(&self) -> bool {
        self.state.load(Ordering::SeqCst) == STATE_RUNNING
    }

    fn emit(&self, event: WorkerEvent, data: WorkerEventData) {
        let events = self.events.read().unwrap();
        emit_event(&events, event, data);
    }
}

fn emit_event(events: &[(WorkerEvent, EventHandler)], event: WorkerEvent, data: WorkerEventData) {
    for (ev, handler) in events {
        if *ev == event {
            handler(data.clone());
        }
    }
}
