/// Example 03: Priority - Jobs with Different Priorities
///
/// Higher priority jobs are processed first.
use std::time::Duration;

use flashq::{FlashQ, PushOptions};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Push jobs with different priorities (higher = processed first)
    let priorities = vec![
        ("Low priority", 1),
        ("Medium priority", 5),
        ("High priority", 10),
        ("Critical", 100),
    ];

    for (name, priority) in &priorities {
        let id = client
            .push(
                "priority-demo",
                serde_json::json!({"task": name}),
                Some(PushOptions {
                    priority: Some(*priority),
                    ..Default::default()
                }),
            )
            .await?;
        println!("Pushed '{name}' (priority={priority}): job {id}");
    }

    // Pull jobs - should come in priority order
    println!("\nPulling jobs (highest priority first):");
    for _ in 0..priorities.len() {
        if let Some(job) = client
            .pull("priority-demo", Some(Duration::from_secs(1)))
            .await?
        {
            println!("  Got: {} (priority={})", job.data["task"], job.priority);
            client.ack(job.id, None).await?;
        }
    }

    client.close().await?;
    Ok(())
}
