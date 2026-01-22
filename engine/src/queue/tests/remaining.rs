//! Remaining function coverage tests.

use super::*;
use tokio::time::{timeout, Duration};

// ==================== PAUSED QUEUE PULL ====================

#[tokio::test]
async fn test_paused_queue_pull_returns_empty() {
    let qm = setup();

    // Push a job
    qm.push("test".to_string(), job(json!({}))).await.unwrap();

    // Pause the queue
    qm.pause("test").await;

    // Try to pull with timeout - should not return the job
    let result = timeout(Duration::from_millis(100), qm.pull("test")).await;

    // The pull should timeout since queue is paused
    assert!(result.is_err());

    // Resume and verify we can pull
    qm.resume("test").await;
    let j = qm.pull("test").await;
    assert!(j.id > 0);
}

#[tokio::test]
async fn test_paused_queue_pull_batch_blocks() {
    let qm = setup();

    // Push jobs
    for i in 0..5 {
        qm.push("test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    // Pause the queue
    qm.pause("test").await;

    // Pull batch should block - test with timeout
    let result = timeout(Duration::from_millis(200), qm.pull_batch("test", 5)).await;

    // Should timeout since queue is paused
    assert!(result.is_err());

    // Resume the queue
    qm.resume("test").await;

    // Now should get jobs immediately
    let jobs = qm.pull_batch("test", 5).await;
    assert_eq!(jobs.len(), 5);
}

// ==================== GET RESULT ====================

#[tokio::test]
async fn test_get_result_after_ack() {
    let qm = setup();

    let j = qm.push("test".to_string(), job(json!({}))).await.unwrap();

    let pulled = qm.pull("test").await;
    qm.ack(pulled.id, Some(json!({"output": "success"})))
        .await
        .unwrap();

    let result = qm.get_result(j.id).await;
    assert!(result.is_some());
    assert_eq!(result.unwrap()["output"], "success");
}

#[tokio::test]
async fn test_get_result_not_found() {
    let qm = setup();
    let result = qm.get_result(999999).await;
    assert!(result.is_none());
}

// ==================== SUBSCRIBE / UNSUBSCRIBE ====================

#[tokio::test]
async fn test_subscribe_and_unsubscribe() {
    let qm = setup();

    // Create a channel for subscription
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();

    // Subscribe to a queue with events
    qm.subscribe(
        "test".to_string(),
        vec!["push".to_string(), "ack".to_string()],
        tx,
    );

    // Unsubscribe
    qm.unsubscribe("test");

    // Should not error
}

// ==================== SHUTDOWN ====================

#[tokio::test]
async fn test_shutdown_flag() {
    let qm = setup();

    assert!(!qm.is_shutdown());

    qm.shutdown();

    assert!(qm.is_shutdown());
}

// ==================== MANAGER INFO METHODS ====================

#[tokio::test]
async fn test_is_leader_default() {
    let qm = setup();
    // Without cluster, always leader
    assert!(qm.is_leader());
}

#[tokio::test]
async fn test_is_cluster_enabled_default() {
    let qm = setup();
    // Without cluster config, not enabled
    assert!(!qm.is_cluster_enabled());
}

#[tokio::test]
async fn test_is_distributed_pull_default() {
    let qm = setup();
    assert!(!qm.is_distributed_pull());
}

#[tokio::test]
async fn test_node_id_default() {
    let qm = setup();
    // Without cluster, no node id
    assert!(qm.node_id().is_none());
}

#[tokio::test]
async fn test_cluster_disabled() {
    let qm = setup();
    // Cluster is always disabled in single-node mode
    assert!(!qm.is_cluster_enabled());
}

#[tokio::test]
async fn test_auth_token_count() {
    let qm = setup();
    assert_eq!(qm.auth_token_count(), 0);

    qm.set_auth_tokens(vec!["a".to_string(), "b".to_string(), "c".to_string()]);
    assert_eq!(qm.auth_token_count(), 3);
}

#[tokio::test]
async fn test_is_sqlite_connected() {
    let qm = setup();
    assert!(!qm.is_sqlite_connected());
}

#[tokio::test]
async fn test_is_sync_persistence() {
    let qm = setup();
    assert!(!qm.is_sync_persistence());
}

#[tokio::test]
async fn test_is_snapshot_mode() {
    let qm = setup();
    assert!(!qm.is_snapshot_mode());
}

#[tokio::test]
async fn test_snapshot_change_count() {
    let qm = setup();
    // Without persistence, should be 0
    let count = qm.snapshot_change_count();
    assert_eq!(count, 0);
}

// ==================== PROCESSING COUNT ====================

#[tokio::test]
async fn test_processing_count() {
    let qm = setup();

    assert_eq!(qm.processing_count(), 0);

    // Push and pull
    qm.push("test".to_string(), job(json!({}))).await.unwrap();

    let j = qm.pull("test").await;
    assert_eq!(qm.processing_count(), 1);

    qm.ack(j.id, None).await.unwrap();
    assert_eq!(qm.processing_count(), 0);
}

// ==================== SHARD INDEX ====================

#[tokio::test]
async fn test_shard_index_consistency() {
    use crate::queue::QueueManager;

    let idx1 = QueueManager::shard_index("test-queue");
    let idx2 = QueueManager::shard_index("test-queue");
    assert_eq!(idx1, idx2);

    // Different queues may have different shards
    let idx3 = QueueManager::shard_index("other-queue");
    // Just verify it's in valid range
    assert!(idx3 < 32);
}

#[tokio::test]
async fn test_processing_shard_index() {
    use crate::queue::QueueManager;

    let idx1 = QueueManager::processing_shard_index(12345);
    let idx2 = QueueManager::processing_shard_index(12345);
    assert_eq!(idx1, idx2);

    // Verify valid range
    assert!(idx1 < 32);
}

// ==================== NEXT JOB ID ====================

#[tokio::test]
async fn test_next_job_id_increments() {
    let qm = setup();

    let id1 = qm.next_job_id().await;
    let id2 = qm.next_job_id().await;
    let id3 = qm.next_job_id().await;

    assert!(id2 > id1);
    assert!(id3 > id2);
}

#[tokio::test]
async fn test_next_job_ids_batch() {
    let qm = setup();

    let ids = qm.next_job_ids(5).await;
    assert_eq!(ids.len(), 5);

    // All should be unique and in order
    for i in 1..ids.len() {
        assert!(ids[i] > ids[i - 1]);
    }
}

// ==================== GET JOB BY CUSTOM ID ====================

#[tokio::test]
async fn test_get_job_by_custom_id() {
    let qm = setup();

    let j = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({"custom": true}),
                job_id: Some("my-custom-id-123".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let found = qm.get_job_by_custom_id("my-custom-id-123");
    assert!(found.is_some());
    let (found_job, _state) = found.unwrap();
    assert_eq!(found_job.id, j.id);
}

#[tokio::test]
async fn test_get_job_by_custom_id_not_found() {
    let qm = setup();
    let found = qm.get_job_by_custom_id("nonexistent-id");
    assert!(found.is_none());
}

// ==================== GET JOB BY INTERNAL ID ====================

#[tokio::test]
async fn test_get_job_by_internal_id() {
    let qm = setup();

    let j = qm.push("test".to_string(), job(json!({}))).await.unwrap();

    let found = qm.get_job_by_internal_id(j.id);
    assert!(found.is_some());
    assert_eq!(found.unwrap().id, j.id);
}

#[tokio::test]
async fn test_get_job_by_internal_id_not_found() {
    let qm = setup();
    let found = qm.get_job_by_internal_id(999999);
    assert!(found.is_none());
}

// ==================== COLLECT METRICS HISTORY ====================

#[tokio::test]
async fn test_collect_metrics_history_accumulates() {
    let qm = setup();

    // Push some jobs to generate metrics
    for i in 0..3 {
        qm.push("test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    // Collect multiple times
    qm.collect_metrics_history();
    qm.collect_metrics_history();
    qm.collect_metrics_history();

    let history = qm.get_metrics_history();
    assert_eq!(history.len(), 3);

    // Each point should have timestamp
    for point in &history {
        assert!(point.timestamp > 0);
    }
}

// ==================== NOW_MS ====================

#[tokio::test]
async fn test_now_ms() {
    use crate::queue::types::now_ms;

    let t1 = now_ms();
    tokio::time::sleep(Duration::from_millis(10)).await;
    let t2 = now_ms();

    // t2 should be slightly larger than t1
    assert!(t2 >= t1);
}
