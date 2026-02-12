/// Example 22: Groups - FIFO Processing within Groups
///
/// Demonstrates group_id for ordered processing within a group.
use std::time::Duration;

use flashq::{FlashQ, PushOptions};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Push jobs with different group IDs
    // Jobs within same group are processed in FIFO order
    for tenant in &["tenant-a", "tenant-b"] {
        for i in 0..3 {
            client
                .push(
                    "groups-demo",
                    serde_json::json!({
                        "tenant": tenant,
                        "order": i,
                        "action": format!("process-{i}"),
                    }),
                    Some(PushOptions {
                        group_id: Some(tenant.to_string()),
                        ..Default::default()
                    }),
                )
                .await?;
        }
        println!("Pushed 3 jobs for {tenant}");
    }

    // Pull and process
    println!("\nProcessing jobs:");
    for _ in 0..6 {
        if let Some(job) = client
            .pull("groups-demo", Some(Duration::from_secs(5)))
            .await?
        {
            println!(
                "  Job {}: tenant={} order={} group={:?}",
                job.id, job.data["tenant"], job.data["order"], job.group_id
            );
            client.ack(job.id, None).await?;
        }
    }

    client.close().await?;
    Ok(())
}
