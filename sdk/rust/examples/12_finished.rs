/// Example 12: Finished - Wait for Job Completion
///
/// Demonstrates the finished() method for synchronous workflows.
use std::time::Duration;

use flashq::FlashQ;

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Push a job
    let job_id = client
        .push(
            "sync-demo",
            serde_json::json!({"query": "SELECT * FROM users"}),
            None,
        )
        .await?;
    println!("Pushed job: {job_id}");

    // Spawn a "worker" that processes the job after a delay
    let client2 = FlashQ::new();
    client2.connect().await?;

    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(1)).await;
        if let Some(job) = client2
            .pull("sync-demo", Some(Duration::from_secs(5)))
            .await
            .unwrap()
        {
            client2
                .ack(
                    job.id,
                    Some(serde_json::json!({"rows": 42, "data": [1, 2, 3]})),
                )
                .await
                .unwrap();
        }
    });

    // Wait for the job to complete (blocking)
    println!("Waiting for job to complete...");
    let result = client
        .finished(job_id, Some(Duration::from_secs(10)))
        .await?;
    println!("Job completed! Result: {:?}", result);

    client.close().await?;
    Ok(())
}
