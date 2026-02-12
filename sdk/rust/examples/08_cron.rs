/// Example 08: Cron Jobs - Scheduled Repeating Jobs
///
/// Demonstrates creating and managing cron jobs.
use flashq::{CronOptions, FlashQ};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Add a cron job (every 10 seconds)
    client
        .add_cron(
            "cleanup-job",
            CronOptions {
                queue: "maintenance".to_string(),
                data: serde_json::json!({"action": "cleanup-temp-files"}),
                schedule: Some("*/10 * * * * *".to_string()), // Every 10 seconds
                limit: Some(5),                               // Max 5 executions
                ..Default::default()
            },
        )
        .await?;
    println!("Added cron job: cleanup-job");

    // Add another with repeat_every
    client
        .add_cron(
            "health-check",
            CronOptions {
                queue: "monitoring".to_string(),
                data: serde_json::json!({"action": "health-check"}),
                repeat_every: Some(30000), // Every 30 seconds
                ..Default::default()
            },
        )
        .await?;
    println!("Added cron job: health-check");

    // List cron jobs
    let crons = client.list_crons().await?;
    println!("\nActive cron jobs:");
    for cron in &crons {
        println!(
            "  {} -> queue={}, schedule={:?}, executions={}",
            cron.name, cron.queue, cron.schedule, cron.executions
        );
    }

    // Delete a cron
    client.delete_cron("health-check").await?;
    println!("\nDeleted health-check cron");

    client.close().await?;
    Ok(())
}
