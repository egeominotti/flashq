/// Example 23: Streaming - Partial Results / Chunked Responses
///
/// Demonstrates sending partial results from a processing job.
use std::time::Duration;

use flashq::FlashQ;

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Push a streaming job
    let job_id = client
        .push(
            "stream-demo",
            serde_json::json!({"prompt": "Tell me about Rust"}),
            None,
        )
        .await?;
    println!("Pushed streaming job: {job_id}");

    // Simulate a worker that sends partial results
    let worker_client = FlashQ::new();
    worker_client.connect().await?;

    if let Some(job) = worker_client
        .pull("stream-demo", Some(Duration::from_secs(5)))
        .await?
    {
        println!("Processing job {}...", job.id);

        // Send partial results (like LLM token streaming)
        let chunks = vec![
            "Rust is a ",
            "systems programming ",
            "language focused on ",
            "safety and performance.",
        ];

        for (i, chunk) in chunks.iter().enumerate() {
            worker_client
                .partial(job.id, serde_json::json!({"chunk": chunk}), Some(i as u32))
                .await?;
            println!("  Sent chunk {i}: {chunk}");
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        // Add log entries
        worker_client
            .log(job.id, "Generated 4 chunks", Some("info"))
            .await?;

        // Complete the job
        worker_client
            .ack(
                job.id,
                Some(serde_json::json!({
                    "full_response": "Rust is a systems programming language focused on safety and performance.",
                    "chunks": 4,
                })),
            )
            .await?;
        println!("Job completed");

        // Get logs
        let logs = client.get_logs(job.id).await?;
        println!("\nJob logs:");
        for log in &logs {
            println!("  [{}] {}: {}", log.level, log.timestamp, log.message);
        }
    }

    worker_client.close().await?;
    client.close().await?;
    Ok(())
}
