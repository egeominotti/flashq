/// Example 05: Batch Operations - Push, Pull, and Ack in Batches
///
/// Demonstrates high-throughput batch operations.
use std::time::Duration;

use flashq::{FlashQ, JobPayload, PushOptions};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Batch push 100 jobs
    let jobs: Vec<JobPayload> = (0..100)
        .map(|i| JobPayload {
            data: serde_json::json!({"index": i, "task": format!("batch-{i}")}),
            options: PushOptions::default(),
        })
        .collect();

    let result = client.push_batch("batch-demo", jobs).await?;
    println!("Batch pushed {} jobs", result.ids.len());

    // Batch pull
    let jobs = client
        .pull_batch("batch-demo", 50, Some(Duration::from_secs(5)))
        .await?;
    println!("Batch pulled {} jobs", jobs.len());

    // Batch ack
    let job_ids: Vec<u64> = jobs.iter().map(|j| j.id).collect();
    let acked = client.ack_batch(job_ids).await?;
    println!("Batch acked {} jobs", acked);

    // Pull remaining
    let remaining = client
        .pull_batch("batch-demo", 100, Some(Duration::from_secs(5)))
        .await?;
    println!("Remaining: {} jobs", remaining.len());

    let ids: Vec<u64> = remaining.iter().map(|j| j.id).collect();
    client.ack_batch(ids).await?;

    client.close().await?;
    Ok(())
}
