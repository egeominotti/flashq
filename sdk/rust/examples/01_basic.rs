/// Example 01: Basic Operations - Push, Pull, Ack
///
/// Demonstrates fundamental queue operations:
/// - Connecting to flashQ server
/// - Pushing a job to a queue
/// - Pulling a job from the queue
/// - Acknowledging job completion
use std::time::Duration;

use flashq::FlashQ;

#[tokio::main]
async fn main() -> flashq::Result<()> {
    // Create client with default options
    let client = FlashQ::new();

    // Connect to server
    client.connect().await?;
    println!("Connected to flashQ server");

    // Push a job
    let job_id = client
        .push(
            "emails",
            serde_json::json!({
                "to": "user@example.com",
                "subject": "Welcome!",
                "body": "Hello from flashQ",
            }),
            None,
        )
        .await?;
    println!("Pushed job: {job_id}");

    // Pull the job (blocking)
    let job = client.pull("emails", Some(Duration::from_secs(5))).await?;
    if let Some(job) = job {
        println!("Pulled job {}: {:?}", job.id, job.data);

        // Process the job (simulate work)
        println!("Processing email...");
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Acknowledge completion with result
        client
            .ack(job.id, Some(serde_json::json!({"sent": true})))
            .await?;
        println!("Acknowledged job");

        // Get the result
        let result = client.get_result(job.id).await?;
        println!("Job result: {:?}", result);
    }

    client.close().await?;
    println!("\nDone!");
    Ok(())
}
