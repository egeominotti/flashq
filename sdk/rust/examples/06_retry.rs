/// Example 06: Retry & Dead Letter Queue
///
/// Demonstrates job retry with exponential backoff and DLQ.
use std::time::Duration;

use flashq::{FlashQ, PushOptions};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Push job with retry config
    let id = client
        .push(
            "retry-demo",
            serde_json::json!({"action": "process-payment"}),
            Some(PushOptions {
                max_attempts: Some(3),
                backoff: Some(1000), // 1s base, exponential: 1s, 2s, 4s
                ..Default::default()
            }),
        )
        .await?;
    println!("Pushed job with 3 max attempts: {id}");

    // Simulate failures
    for attempt in 1..=3 {
        if let Some(job) = client
            .pull("retry-demo", Some(Duration::from_secs(10)))
            .await?
        {
            println!(
                "Attempt {}: job {} (attempts={})",
                attempt, job.id, job.attempts
            );
            client.fail(job.id, Some("payment gateway timeout")).await?;
            println!("  Failed job (will retry with backoff)");
        }
    }

    // Check DLQ
    tokio::time::sleep(Duration::from_millis(500)).await;
    let dlq_jobs = client.get_dlq("retry-demo", None).await?;
    println!("\nDLQ has {} jobs", dlq_jobs.len());

    // Retry from DLQ
    if !dlq_jobs.is_empty() {
        let retried = client.retry_dlq("retry-demo", None).await?;
        println!("Retried {} jobs from DLQ", retried);
    }

    client.close().await?;
    Ok(())
}
