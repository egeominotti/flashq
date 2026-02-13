/// Example 17: Benchmark - Performance Testing
///
/// Measures push, pull, and ack throughput.
use std::time::{Duration, Instant};

use flashq::{FlashQ, JobPayload, PushOptions};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;
    println!("flashQ Rust SDK Benchmark\n");

    let count = 10_000;

    // Benchmark: batch push
    let batch_size = 1000;
    let start = Instant::now();
    for batch in 0..(count / batch_size) {
        let jobs: Vec<JobPayload> = (0..batch_size)
            .map(|i| JobPayload {
                data: serde_json::json!({"i": batch * batch_size + i}),
                options: PushOptions::default(),
            })
            .collect();
        client.push_batch("bench", jobs).await?;
    }
    let push_elapsed = start.elapsed();
    let push_rate = count as f64 / push_elapsed.as_secs_f64();
    println!(
        "Batch push:  {count} jobs in {:.1}ms ({:.0} jobs/sec)",
        push_elapsed.as_millis(),
        push_rate
    );

    // Benchmark: batch pull + ack
    let start = Instant::now();
    let mut total_pulled = 0;
    while total_pulled < count {
        let batch = (count - total_pulled).min(batch_size);
        let jobs = client
            .pull_batch("bench", batch as u32, Some(Duration::from_secs(5)))
            .await?;
        if jobs.is_empty() {
            break;
        }
        let ids: Vec<u64> = jobs.iter().map(|j| j.id).collect();
        client.ack_batch(ids).await?;
        total_pulled += jobs.len();
    }
    let process_elapsed = start.elapsed();
    let process_rate = total_pulled as f64 / process_elapsed.as_secs_f64();
    println!(
        "Pull + Ack:  {total_pulled} jobs in {:.1}ms ({:.0} jobs/sec)",
        process_elapsed.as_millis(),
        process_rate
    );

    // Stats
    let stats = client.stats().await?;
    println!(
        "\nServer stats: queued={}, processing={}",
        stats.queued, stats.processing
    );

    client.close().await?;
    Ok(())
}
