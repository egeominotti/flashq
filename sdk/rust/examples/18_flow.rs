/// Example 18: Flows - Parent-Child Job Dependencies
///
/// Demonstrates job workflows where parent waits for children.
use std::time::Duration;

use flashq::{FlashQ, FlowChild};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // Create a flow: parent depends on 3 children
    let flow = client
        .push_flow(
            "flow-parent",
            serde_json::json!({"action": "generate-report"}),
            vec![
                FlowChild {
                    queue: "flow-child".to_string(),
                    data: serde_json::json!({"step": "fetch-data"}),
                    priority: Some(5),
                    delay: None,
                },
                FlowChild {
                    queue: "flow-child".to_string(),
                    data: serde_json::json!({"step": "process-data"}),
                    priority: None,
                    delay: None,
                },
                FlowChild {
                    queue: "flow-child".to_string(),
                    data: serde_json::json!({"step": "format-output"}),
                    priority: None,
                    delay: None,
                },
            ],
            None,
        )
        .await?;

    println!("Created flow:");
    println!("  Parent: {}", flow.parent_id);
    println!("  Children: {:?}", flow.children_ids);

    // Check parent state (should be waiting-children)
    let parent_state = client.get_state(flow.parent_id).await?;
    println!("  Parent state: {:?}", parent_state);

    // Process children
    for _ in 0..3 {
        if let Some(job) = client
            .pull("flow-child", Some(Duration::from_secs(5)))
            .await?
        {
            println!("Processing child {}: {:?}", job.id, job.data["step"]);
            client
                .ack(job.id, Some(serde_json::json!({"done": true})))
                .await?;
        }
    }

    // Check parent state again (should be waiting now)
    tokio::time::sleep(Duration::from_millis(500)).await;
    let parent_state = client.get_state(flow.parent_id).await?;
    println!("Parent state after children complete: {:?}", parent_state);

    // Get children IDs
    let children = client.get_children(flow.parent_id).await?;
    println!("Children IDs: {:?}", children);

    client.close().await?;
    Ok(())
}
