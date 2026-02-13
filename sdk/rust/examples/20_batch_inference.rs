/// Example 20: Batch Inference - ML Model Batch Processing
///
/// Demonstrates processing ML inference jobs in batches.
use std::time::Duration;

use flashq::{FlashQ, JobPayload, PushOptions};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Push a batch of inference requests
    let samples: Vec<JobPayload> = (0..20)
        .map(|i| JobPayload {
            data: serde_json::json!({
                "image_url": format!("https://storage.example.com/images/{i}.jpg"),
                "model": "yolov8",
                "confidence_threshold": 0.5,
            }),
            options: PushOptions {
                timeout: Some(30000),
                max_attempts: Some(2),
                tags: Some(vec!["inference".to_string(), "batch-1".to_string()]),
                ..Default::default()
            },
        })
        .collect();

    let result = client.push_batch("ml-inference", samples).await?;
    println!("Pushed {} inference jobs", result.ids.len());

    // Process in batches of 5
    let mut processed = 0;
    while processed < 20 {
        let jobs = client
            .pull_batch("ml-inference", 5, Some(Duration::from_secs(5)))
            .await?;
        if jobs.is_empty() {
            break;
        }

        // Simulate batch inference
        println!("Processing batch of {} images...", jobs.len());
        tokio::time::sleep(Duration::from_millis(200)).await;

        for job in &jobs {
            client
                .ack(
                    job.id,
                    Some(serde_json::json!({
                        "detections": [
                            {"class": "person", "confidence": 0.95},
                            {"class": "car", "confidence": 0.87},
                        ],
                    })),
                )
                .await?;
        }
        processed += jobs.len();
        println!("  Processed {processed}/20");
    }

    client.close().await?;
    Ok(())
}
