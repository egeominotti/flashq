/// Example 21: RAG Pipeline - Retrieval-Augmented Generation
///
/// Demonstrates a RAG workflow using job dependencies.
use std::time::Duration;

use flashq::{FlashQ, FlowChild};

#[tokio::main]
async fn main() -> flashq::Result<()> {
    let client = FlashQ::new();
    client.connect().await?;

    // RAG pipeline: embed query -> search vectors -> generate answer
    let flow = client
        .push_flow(
            "rag-answer",
            serde_json::json!({
                "action": "generate-answer",
                "query": "What is flashQ?",
            }),
            vec![
                FlowChild {
                    queue: "rag-embed".to_string(),
                    data: serde_json::json!({
                        "text": "What is flashQ?",
                        "model": "text-embedding-3-small",
                    }),
                    priority: Some(10),
                    delay: None,
                },
                FlowChild {
                    queue: "rag-search".to_string(),
                    data: serde_json::json!({
                        "query": "What is flashQ?",
                        "top_k": 5,
                    }),
                    priority: Some(5),
                    delay: None,
                },
            ],
            None,
        )
        .await?;
    println!("RAG pipeline created: parent={}", flow.parent_id);

    // Process embedding step
    if let Some(job) = client
        .pull("rag-embed", Some(Duration::from_secs(5)))
        .await?
    {
        println!("Embedding query: {}", job.data["text"]);
        client
            .ack(
                job.id,
                Some(serde_json::json!({"embedding": [0.1, 0.2, 0.3]})),
            )
            .await?;
    }

    // Process search step
    if let Some(job) = client
        .pull("rag-search", Some(Duration::from_secs(5)))
        .await?
    {
        println!("Searching vectors for: {}", job.data["query"]);
        client
            .ack(
                job.id,
                Some(serde_json::json!({
                    "results": [
                        {"text": "flashQ is a high-performance job queue", "score": 0.95},
                        {"text": "Built with Rust for maximum speed", "score": 0.87},
                    ]
                })),
            )
            .await?;
    }

    // Check parent is ready for processing
    tokio::time::sleep(Duration::from_millis(500)).await;
    let state = client.get_state(flow.parent_id).await?;
    println!("Pipeline state: {:?}", state);

    client.close().await?;
    Ok(())
}
