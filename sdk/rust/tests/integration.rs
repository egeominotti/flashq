/// Integration tests for flashQ Rust SDK.
///
/// These tests require a running flashQ server on localhost:6789.
/// Run with: cargo test -- --ignored
use std::time::Duration;

use flashq::*;

async fn setup() -> FlashQ {
    let client = FlashQ::new();
    client.connect().await.expect("failed to connect");
    client
}

#[tokio::test]
#[ignore = "requires running flashQ server"]
async fn test_push_pull_ack() {
    let client = setup().await;

    let id = client
        .push("test-basic", serde_json::json!({"hello": "world"}), None)
        .await
        .unwrap();
    assert!(id > 0);

    let job = client
        .pull("test-basic", Some(Duration::from_secs(5)))
        .await
        .unwrap();
    assert!(job.is_some());

    let job = job.unwrap();
    assert_eq!(job.id, id);
    assert_eq!(job.data["hello"], "world");

    client.ack(job.id, None).await.unwrap();
    client.close().await.unwrap();
}

#[tokio::test]
#[ignore = "requires running flashQ server"]
async fn test_batch_operations() {
    let client = setup().await;

    let jobs: Vec<JobPayload> = (0..10)
        .map(|i| JobPayload {
            data: serde_json::json!({"i": i}),
            options: PushOptions::default(),
        })
        .collect();

    let result = client.push_batch("test-batch", jobs).await.unwrap();
    assert_eq!(result.ids.len(), 10);

    let pulled = client
        .pull_batch("test-batch", 10, Some(Duration::from_secs(5)))
        .await
        .unwrap();
    assert_eq!(pulled.len(), 10);

    let ids: Vec<u64> = pulled.iter().map(|j| j.id).collect();
    let acked = client.ack_batch(ids).await.unwrap();
    assert_eq!(acked, 10);

    client.close().await.unwrap();
}

#[tokio::test]
#[ignore = "requires running flashQ server"]
async fn test_job_state() {
    let client = setup().await;

    let id = client
        .push("test-state", serde_json::json!({"x": 1}), None)
        .await
        .unwrap();

    let state = client.get_state(id).await.unwrap();
    assert_eq!(state, Some(JobState::Waiting));

    let job = client
        .pull("test-state", Some(Duration::from_secs(5)))
        .await
        .unwrap()
        .unwrap();

    let state = client.get_state(job.id).await.unwrap();
    assert_eq!(state, Some(JobState::Active));

    client.ack(job.id, None).await.unwrap();
    client.close().await.unwrap();
}

#[tokio::test]
#[ignore = "requires running flashQ server"]
async fn test_priority() {
    let client = setup().await;

    client
        .push(
            "test-priority",
            serde_json::json!({"name": "low"}),
            Some(PushOptions {
                priority: Some(1),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    client
        .push(
            "test-priority",
            serde_json::json!({"name": "high"}),
            Some(PushOptions {
                priority: Some(100),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    let job = client
        .pull("test-priority", Some(Duration::from_secs(5)))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(job.data["name"], "high");
    client.ack(job.id, None).await.unwrap();

    let job = client
        .pull("test-priority", Some(Duration::from_secs(5)))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(job.data["name"], "low");
    client.ack(job.id, None).await.unwrap();

    client.close().await.unwrap();
}

#[tokio::test]
#[ignore = "requires running flashQ server"]
async fn test_progress() {
    let client = setup().await;

    let _id = client
        .push("test-progress", serde_json::json!({"task": "upload"}), None)
        .await
        .unwrap();

    let job = client
        .pull("test-progress", Some(Duration::from_secs(5)))
        .await
        .unwrap()
        .unwrap();

    client.progress(job.id, 50, Some("halfway")).await.unwrap();

    let info = client.get_progress(job.id).await.unwrap();
    assert_eq!(info.progress, 50);
    assert_eq!(info.message.as_deref(), Some("halfway"));

    client.ack(job.id, None).await.unwrap();
    client.close().await.unwrap();
}

#[tokio::test]
#[ignore = "requires running flashQ server"]
async fn test_queue_control() {
    let client = setup().await;

    client
        .push("test-control", serde_json::json!({"x": 1}), None)
        .await
        .unwrap();

    client.pause("test-control").await.unwrap();
    assert!(client.is_paused("test-control").await.unwrap());

    client.resume("test-control").await.unwrap();
    assert!(!client.is_paused("test-control").await.unwrap());

    let drained = client.drain("test-control").await.unwrap();
    assert!(drained > 0);

    client.close().await.unwrap();
}

#[tokio::test]
#[ignore = "requires running flashQ server"]
async fn test_stats_and_metrics() {
    let client = setup().await;

    let stats = client.stats().await.unwrap();
    // Just ensure it returns without error
    let _ = stats.queued;

    let metrics = client.metrics().await.unwrap();
    let _ = metrics.total_pushed;

    client.close().await.unwrap();
}

#[tokio::test]
#[ignore = "requires running flashQ server"]
async fn test_cron() {
    let client = setup().await;

    client
        .add_cron(
            "test-cron-rs",
            CronOptions {
                queue: "test-cron-queue".to_string(),
                data: serde_json::json!({"action": "test"}),
                schedule: Some("*/30 * * * * *".to_string()),
                limit: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let crons = client.list_crons().await.unwrap();
    assert!(crons.iter().any(|c| c.name == "test-cron-rs"));

    client.delete_cron("test-cron-rs").await.unwrap();
    client.close().await.unwrap();
}

#[tokio::test]
#[ignore = "requires running flashQ server"]
async fn test_validation() {
    let client = setup().await;

    // Invalid queue name
    let result = client
        .push("invalid queue!", serde_json::json!({}), None)
        .await;
    assert!(result.is_err());
    assert!(matches!(result.unwrap_err(), FlashQError::Validation(_)));

    // Empty queue name
    let result = client.push("", serde_json::json!({}), None).await;
    assert!(result.is_err());

    client.close().await.unwrap();
}

#[tokio::test]
#[ignore = "requires running flashQ server"]
async fn test_ping() {
    let client = setup().await;
    assert!(client.ping().await.unwrap());
    client.close().await.unwrap();
}

#[tokio::test]
#[ignore = "requires running flashQ server"]
async fn test_list_queues() {
    let client = setup().await;

    client
        .push("test-list-q", serde_json::json!({}), None)
        .await
        .unwrap();

    let queues = client.list_queues().await.unwrap();
    assert!(!queues.is_empty());

    client.close().await.unwrap();
}
