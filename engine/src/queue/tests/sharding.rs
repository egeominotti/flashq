//! Sharding tests.

use super::*;

#[tokio::test]
async fn test_different_queues_different_shards() {
    let qm = setup();

    // Push to many different queues
    for i in 0..100 {
        qm.push(
            format!("queue-{}", i),
            json!({"i": i}),
            0,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // group_id
        )
        .await
        .unwrap();
    }

    let queues = qm.list_queues().await;
    assert_eq!(queues.len(), 100);
}

#[tokio::test]
async fn test_shard_index_consistency() {
    // Same queue name should always map to same shard
    let idx1 = QueueManager::shard_index("test-queue");
    let idx2 = QueueManager::shard_index("test-queue");
    assert_eq!(idx1, idx2);

    // Different queues may map to different shards
    let idx3 = QueueManager::shard_index("another-queue");
    // (idx3 might equal idx1 by coincidence, so no assertion here)
    assert!(idx3 < 32); // Should be within shard range
}
