/// Example 13: Job Options - All Push Options Demonstrated
///
/// Shows all available push options for job creation.
use flashq::{FlashQ, PushOptions};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Push with all options
    let id = client
        .push(
            "options-demo",
            serde_json::json!({"action": "full-featured-job"}),
            Some(PushOptions {
                priority: Some(10),
                delay: Some(0),
                ttl: Some(60000),     // 60s TTL
                timeout: Some(30000), // 30s processing timeout
                max_attempts: Some(3),
                backoff: Some(1000), // 1s exponential backoff
                unique_key: Some("unique-123".to_string()),
                tags: Some(vec!["important".to_string(), "v2".to_string()]),
                lifo: Some(false),
                remove_on_complete: Some(false),
                remove_on_fail: Some(false),
                stall_timeout: Some(30000), // 30s stall detection
                job_id: Some("custom-id-123".to_string()),
                keep_completed_age: Some(86400000), // 24h retention
                keep_completed_count: Some(100),
                group_id: Some("group-a".to_string()),
                ..Default::default()
            }),
        )
        .await?;
    println!("Pushed job with all options: {id}");

    // Get job to see all fields
    if let Some(jws) = client.get_job(id).await? {
        let job = &jws.job;
        println!("Job details:");
        println!("  ID: {}", job.id);
        println!("  Queue: {}", job.queue);
        println!("  Priority: {}", job.priority);
        println!("  Max attempts: {}", job.max_attempts);
        println!("  Tags: {:?}", job.tags);
        println!("  Custom ID: {:?}", job.custom_id);
        println!("  Group ID: {:?}", job.group_id);
        println!("  State: {:?}", jws.state);
    }

    client.close().await?;
    Ok(())
}
