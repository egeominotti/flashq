/// Example 10: Queue API - BullMQ-Compatible Queue Class
///
/// Demonstrates the higher-level Queue wrapper.
use flashq::{BulkJob, Queue};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let queue = Queue::new("emails");
    queue.connect().await?;

    // Add a single job
    let id = queue
        .add(
            "send-welcome",
            serde_json::json!({"to": "user@example.com", "template": "welcome"}),
            None,
        )
        .await?;
    println!("Added job: {id}");

    // Add bulk jobs
    let ids = queue
        .add_bulk(vec![
            BulkJob {
                name: "send-notification".to_string(),
                data: serde_json::json!({"to": "a@example.com"}),
                options: None,
            },
            BulkJob {
                name: "send-notification".to_string(),
                data: serde_json::json!({"to": "b@example.com"}),
                options: None,
            },
        ])
        .await?;
    println!("Bulk added {} jobs", ids.len());

    // Get job counts
    let counts = queue.get_job_counts().await?;
    println!(
        "Counts: waiting={}, active={}, completed={}, failed={}",
        counts.waiting, counts.active, counts.completed, counts.failed
    );

    // Check count
    let total = queue.count().await?;
    println!("Total waiting+delayed: {total}");

    // Drain the queue
    let drained = queue.drain().await?;
    println!("Drained {drained} jobs");

    queue.close().await?;
    Ok(())
}
