/// Example 15: Queue Control - Pause, Resume, Drain, Obliterate
///
/// Demonstrates queue lifecycle management.
use flashq::FlashQ;

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Push some jobs
    for i in 0..5 {
        client
            .push("control-demo", serde_json::json!({"i": i}), None)
            .await?;
    }
    println!("Pushed 5 jobs");

    // Pause queue
    client.pause("control-demo").await?;
    let paused = client.is_paused("control-demo").await?;
    println!("Queue paused: {paused}");

    // Resume queue
    client.resume("control-demo").await?;
    let paused = client.is_paused("control-demo").await?;
    println!("Queue paused after resume: {paused}");

    // List queues
    let queues = client.list_queues().await?;
    println!("\nAll queues:");
    for q in &queues {
        println!(
            "  {} - pending={} processing={} paused={}",
            q.name, q.pending, q.processing, q.paused
        );
    }

    // Drain waiting jobs
    let drained = client.drain("control-demo").await?;
    println!("\nDrained {drained} jobs");

    // Push more and obliterate
    client
        .push("control-demo", serde_json::json!({"temp": true}), None)
        .await?;
    client.obliterate("control-demo").await?;
    println!("Queue obliterated");

    client.close().await?;
    Ok(())
}
