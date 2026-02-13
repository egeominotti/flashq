/// Example 16: Concurrency Control - Limit Parallel Processing
///
/// Demonstrates setting concurrency limits on queues.
use flashq::FlashQ;

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Set concurrency limit
    client.set_concurrency("concurrency-demo", 3).await?;
    println!("Set concurrency limit: 3 concurrent jobs");

    // Push 10 jobs
    for i in 0..10 {
        client
            .push("concurrency-demo", serde_json::json!({"task": i}), None)
            .await?;
    }
    println!("Pushed 10 jobs");

    // Check counts
    let counts = client.get_job_counts("concurrency-demo").await?;
    println!(
        "Counts: waiting={}, active={}, delayed={}",
        counts.waiting, counts.active, counts.delayed
    );

    // Clear concurrency limit
    client.clear_concurrency("concurrency-demo").await?;
    println!("Concurrency limit cleared");

    client.close().await?;
    Ok(())
}
