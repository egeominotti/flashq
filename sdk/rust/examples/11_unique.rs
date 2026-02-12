/// Example 11: Unique Jobs - Deduplication by Key
///
/// Demonstrates using unique_key to prevent duplicate jobs.
use flashq::{FlashQ, PushOptions};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Push with unique key
    let id1 = client
        .push(
            "unique-demo",
            serde_json::json!({"email": "user@example.com"}),
            Some(PushOptions {
                unique_key: Some("email:user@example.com".to_string()),
                ..Default::default()
            }),
        )
        .await?;
    println!("First push: job {id1}");

    // Push again with same unique key - should be deduplicated
    let result = client
        .push(
            "unique-demo",
            serde_json::json!({"email": "user@example.com"}),
            Some(PushOptions {
                unique_key: Some("email:user@example.com".to_string()),
                ..Default::default()
            }),
        )
        .await;

    match result {
        Ok(id2) => println!("Second push: job {id2} (same ID means deduplicated)"),
        Err(e) => println!("Second push rejected (duplicate): {e}"),
    }

    // Push with custom job ID for idempotency
    let id3 = client
        .push(
            "unique-demo",
            serde_json::json!({"order": "ORD-123"}),
            Some(PushOptions {
                job_id: Some("order-123".to_string()),
                ..Default::default()
            }),
        )
        .await?;
    println!("Custom ID push: job {id3}");

    // Lookup by custom ID
    let found = client.get_job_by_custom_id("order-123").await?;
    if let Some(jws) = found {
        println!(
            "Found by custom ID: job {} state={:?}",
            jws.job.id, jws.state
        );
    }

    client.close().await?;
    Ok(())
}
