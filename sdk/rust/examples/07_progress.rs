/// Example 07: Progress Tracking
///
/// Demonstrates updating and reading job progress.
use std::time::Duration;

use flashq::FlashQ;

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Push a job
    let id = client
        .push(
            "progress-demo",
            serde_json::json!({"file": "large-upload.zip", "size_mb": 500}),
            None,
        )
        .await?;
    println!("Pushed job: {id}");

    // Pull and process with progress updates
    if let Some(job) = client
        .pull("progress-demo", Some(Duration::from_secs(5)))
        .await?
    {
        println!("Processing file upload...");

        for pct in (0..=100).step_by(25) {
            client
                .progress(job.id, pct, Some(&format!("Uploading... {pct}%")))
                .await?;

            let info = client.get_progress(job.id).await?;
            println!("  Progress: {}% - {:?}", info.progress, info.message);

            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        client
            .ack(job.id, Some(serde_json::json!({"uploaded": true})))
            .await?;
        println!("Upload complete!");
    }

    client.close().await?;
    Ok(())
}
