//! Worker registration tests.

use super::*;

#[tokio::test]
async fn test_list_workers_empty() {
    let qm = setup();
    let workers = qm.list_workers().await;
    assert!(workers.is_empty());
}

#[tokio::test]
async fn test_worker_heartbeat_creates_worker() {
    let qm = setup();

    qm.worker_heartbeat(
        "worker-1".to_string(),
        vec!["queue-a".to_string(), "queue-b".to_string()],
        4,
        0,
    )
    .await;

    let workers = qm.list_workers().await;
    assert_eq!(workers.len(), 1);
    assert_eq!(workers[0].id, "worker-1");
    assert_eq!(workers[0].queues, vec!["queue-a", "queue-b"]);
    assert_eq!(workers[0].concurrency, 4);
}

#[tokio::test]
async fn test_worker_heartbeat_updates_existing() {
    let qm = setup();

    // First heartbeat
    qm.worker_heartbeat("worker-1".to_string(), vec!["queue-a".to_string()], 2, 0)
        .await;

    // Second heartbeat with different settings
    qm.worker_heartbeat(
        "worker-1".to_string(),
        vec!["queue-a".to_string(), "queue-b".to_string()],
        4,
        0,
    )
    .await;

    let workers = qm.list_workers().await;
    assert_eq!(workers.len(), 1);
    assert_eq!(workers[0].queues.len(), 2);
    assert_eq!(workers[0].concurrency, 4);
}

#[tokio::test]
async fn test_multiple_workers() {
    let qm = setup();

    qm.worker_heartbeat("worker-1".to_string(), vec!["queue-a".to_string()], 2, 0)
        .await;
    qm.worker_heartbeat("worker-2".to_string(), vec!["queue-b".to_string()], 4, 0)
        .await;
    qm.worker_heartbeat(
        "worker-3".to_string(),
        vec!["queue-a".to_string(), "queue-b".to_string()],
        8,
        0,
    )
    .await;

    let workers = qm.list_workers().await;
    assert_eq!(workers.len(), 3);
}
