/// Example 02: Worker - Automatic Job Processing
///
/// Demonstrates the Worker pattern for continuous job processing.
use std::time::Duration;

use flashq::types::WorkerEvent;
use flashq::{FlashQ, Worker, WorkerEventData, WorkerOptions};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    // Push some jobs first
    let client = FlashQ::new();
    client.connect().await?;

    for i in 0..5 {
        client
            .push(
                "tasks",
                serde_json::json!({"task": format!("task-{i}"), "value": i}),
                None,
            )
            .await?;
    }
    println!("Pushed 5 jobs");
    client.close().await?;

    // Create a worker
    let worker = Worker::new(
        vec!["tasks".to_string()],
        |job| async move {
            println!("Processing job {}: {:?}", job.id, job.data);
            tokio::time::sleep(Duration::from_millis(100)).await;
            Ok(serde_json::json!({"processed": true}))
        },
        Some(WorkerOptions {
            concurrency: 2,
            ..Default::default()
        }),
    );

    // Register event handlers
    worker.on(WorkerEvent::Completed, |event| {
        if let WorkerEventData::Completed { job_id, .. } = event {
            println!("Job {job_id} completed");
        }
    });

    worker.on(WorkerEvent::Failed, |event| {
        if let WorkerEventData::Failed { job_id, error, .. } = event {
            println!("Job {job_id} failed: {error}");
        }
    });

    // Start worker (runs until stopped)
    println!("Starting worker...");

    // Stop after 3 seconds
    let shutdown = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
    });

    tokio::select! {
        result = worker.start() => {
            if let Err(e) = result {
                eprintln!("Worker error: {e}");
            }
        }
        _ = shutdown => {
            worker.stop();
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    println!(
        "Processed: {}, Failed: {}",
        worker.processed(),
        worker.failed()
    );
    Ok(())
}
