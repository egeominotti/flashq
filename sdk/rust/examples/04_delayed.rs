/// Example 04: Delayed Jobs - Schedule Jobs for Future Execution
///
/// Demonstrates pushing jobs with a delay.
use std::time::Duration;

use flashq::{FlashQ, PushOptions};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Push a delayed job (2 seconds)
    let id = client
        .push(
            "scheduled",
            serde_json::json!({"action": "send-reminder"}),
            Some(PushOptions {
                delay: Some(2000), // 2 seconds
                ..Default::default()
            }),
        )
        .await?;
    println!("Pushed delayed job: {id}");

    // Check state - should be "delayed"
    let state = client.get_state(id).await?;
    println!("State right after push: {:?}", state);

    // Try to pull immediately - should get nothing
    let job = client
        .pull("scheduled", Some(Duration::from_secs(1)))
        .await?;
    println!("Pull before delay: {:?}", job.is_some());

    // Wait for the delay
    println!("Waiting 2 seconds for job to become ready...");
    tokio::time::sleep(Duration::from_secs(2)).await;

    // Now pull should work
    if let Some(job) = client
        .pull("scheduled", Some(Duration::from_secs(3)))
        .await?
    {
        println!("Pulled delayed job {}: {:?}", job.id, job.data);
        client.ack(job.id, None).await?;
    }

    client.close().await?;
    Ok(())
}
