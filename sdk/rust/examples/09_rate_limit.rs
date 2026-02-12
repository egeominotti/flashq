/// Example 09: Rate Limiting - Control Job Processing Speed
///
/// Demonstrates setting and clearing rate limits on queues.
use std::time::Duration;

use flashq::FlashQ;

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Set rate limit: 5 jobs per second
    client.set_rate_limit("rate-demo", 5).await?;
    println!("Set rate limit: 5 jobs/sec on 'rate-demo'");

    // Push some jobs
    for i in 0..10 {
        client
            .push("rate-demo", serde_json::json!({"index": i}), None)
            .await?;
    }
    println!("Pushed 10 jobs");

    // Pull jobs - rate limited
    let start = std::time::Instant::now();
    let mut pulled = 0;

    for _ in 0..10 {
        if let Some(job) = client
            .pull("rate-demo", Some(Duration::from_secs(5)))
            .await?
        {
            client.ack(job.id, None).await?;
            pulled += 1;
        }
    }

    let elapsed = start.elapsed();
    println!(
        "Pulled {pulled} jobs in {:.1}s (rate limited)",
        elapsed.as_secs_f64()
    );

    // Clear rate limit
    client.clear_rate_limit("rate-demo").await?;
    println!("Rate limit cleared");

    client.close().await?;
    Ok(())
}
