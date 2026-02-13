/// Example 14: Events - Worker Event Handlers
///
/// Demonstrates all worker event types.
use std::time::Duration;

use flashq::types::WorkerEvent;
use flashq::{FlashQ, Worker, WorkerEventData, WorkerOptions};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    for i in 0..3 {
        client
            .push("events-demo", serde_json::json!({"task": i}), None)
            .await?;
    }
    client.close().await?;

    let worker = Worker::new(
        vec!["events-demo".to_string()],
        |job| async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            if job.data["task"] == 1 {
                return Err(flashq::FlashQError::Server("simulated failure".into()));
            }
            Ok(serde_json::json!({"done": true}))
        },
        Some(WorkerOptions {
            concurrency: 1,
            ..Default::default()
        }),
    );

    worker.on(WorkerEvent::Ready, |_| {
        println!("[EVENT] Worker ready");
    });
    worker.on(WorkerEvent::Active, |event| {
        if let WorkerEventData::Active { job_id, worker_id } = event {
            println!("[EVENT] Active: job={job_id} worker={worker_id}");
        }
    });
    worker.on(WorkerEvent::Completed, |event| {
        if let WorkerEventData::Completed {
            job_id, worker_id, ..
        } = event
        {
            println!("[EVENT] Completed: job={job_id} worker={worker_id}");
        }
    });
    worker.on(WorkerEvent::Failed, |event| {
        if let WorkerEventData::Failed { job_id, error, .. } = event {
            println!("[EVENT] Failed: job={job_id} error={error}");
        }
    });
    worker.on(WorkerEvent::Stopping, |_| {
        println!("[EVENT] Worker stopping...");
    });
    worker.on(WorkerEvent::Stopped, |_| {
        println!("[EVENT] Worker stopped");
    });

    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        worker.stop();
    });

    // Note: worker.start() blocks until stopped
    // In a real app, you'd run this in a separate task

    Ok(())
}
