/// Example 19: AI Workflow - ML Pipeline with Dependencies
///
/// Demonstrates a real-world AI/ML pipeline using job flows.
use std::time::Duration;

use flashq::{FlashQ, FlowChild, PushOptions};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Step 1: Push embedding generation jobs
    let flow = client
        .push_flow(
            "ai-pipeline",
            serde_json::json!({
                "action": "generate-embeddings-report",
                "model": "text-embedding-3-large",
            }),
            vec![
                FlowChild {
                    queue: "ai-embeddings".to_string(),
                    data: serde_json::json!({
                        "text": "The quick brown fox jumps over the lazy dog",
                        "model": "text-embedding-3-large",
                    }),
                    priority: Some(10),
                    delay: None,
                },
                FlowChild {
                    queue: "ai-embeddings".to_string(),
                    data: serde_json::json!({
                        "text": "Machine learning is transforming industries",
                        "model": "text-embedding-3-large",
                    }),
                    priority: Some(10),
                    delay: None,
                },
            ],
            Some(PushOptions {
                timeout: Some(60000),
                max_attempts: Some(2),
                ..Default::default()
            }),
        )
        .await?;

    println!("AI Pipeline created:");
    println!("  Parent job: {}", flow.parent_id);
    println!("  Embedding jobs: {:?}", flow.children_ids);

    // Simulate processing embedding jobs
    for _ in 0..2 {
        if let Some(job) = client
            .pull("ai-embeddings", Some(Duration::from_secs(5)))
            .await?
        {
            println!("Generating embedding for: {}", job.data["text"]);

            // Update progress
            client
                .progress(job.id, 50, Some("Computing vectors..."))
                .await?;
            tokio::time::sleep(Duration::from_millis(100)).await;
            client.progress(job.id, 100, Some("Done")).await?;

            // Ack with "embedding" result
            client
                .ack(
                    job.id,
                    Some(serde_json::json!({
                        "embedding": [0.1, 0.2, 0.3, 0.4],
                        "dimensions": 4,
                    })),
                )
                .await?;
        }
    }

    // Check pipeline state
    tokio::time::sleep(Duration::from_millis(500)).await;
    let state = client.get_state(flow.parent_id).await?;
    println!("\nPipeline state: {:?}", state);

    client.close().await?;
    Ok(())
}
