//! Stats, metrics, and queue listing tests.

use super::*;

#[tokio::test]
async fn test_stats() {
    let qm = setup();

    // Push some jobs
    for i in 0..5 {
        qm.push("test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    let (queued, processing, delayed, dlq, _) = qm.stats().await;
    assert_eq!(queued, 5);
    assert_eq!(processing, 0);
    assert_eq!(delayed, 0);
    assert_eq!(dlq, 0);

    // Pull one
    let _ = qm.pull("test").await;

    let (queued2, processing2, _, _, _) = qm.stats().await;
    assert_eq!(queued2, 4);
    assert_eq!(processing2, 1);
}

#[tokio::test]
async fn test_metrics() {
    let qm = setup();

    // Push and complete some jobs
    for _ in 0..5 {
        qm.push("test".to_string(), job(json!({}))).await.unwrap();
        let pulled = qm.pull("test").await;
        qm.ack(pulled.id, None).await.unwrap();
    }

    let metrics = qm.get_metrics().await;
    assert_eq!(metrics.total_pushed, 5);
    assert_eq!(metrics.total_completed, 5);
}

#[tokio::test]
async fn test_list_queues() {
    let qm = setup();

    // Push to create queues
    qm.push("queue1".to_string(), job(json!({}))).await.unwrap();
    qm.push("queue2".to_string(), job(json!({}))).await.unwrap();
    qm.push("queue2".to_string(), job(json!({}))).await.unwrap();

    let queues = qm.list_queues().await;
    assert!(queues.len() >= 2);

    let q2 = queues.iter().find(|q| q.name == "queue2");
    assert!(q2.is_some());
    assert_eq!(q2.unwrap().pending, 2);
}

#[tokio::test]
async fn test_metrics_throughput_calculation() {
    let qm = setup();

    // Push jobs to trigger throughput calculation
    for _ in 0..10 {
        qm.push("metrics-test".to_string(), job(json!({})))
            .await
            .unwrap();
    }

    let metrics = qm.get_metrics().await;
    assert_eq!(metrics.total_pushed, 10);
}

#[tokio::test]
async fn test_global_metrics_atomic_operations() {
    use crate::queue::types::GlobalMetrics;
    use std::sync::atomic::Ordering;

    let metrics = GlobalMetrics::default();

    // Test increment operations
    metrics.total_pushed.fetch_add(5, Ordering::Relaxed);
    metrics.total_completed.fetch_add(3, Ordering::Relaxed);
    metrics.total_failed.fetch_add(2, Ordering::Relaxed);

    assert_eq!(metrics.total_pushed.load(Ordering::Relaxed), 5);
    assert_eq!(metrics.total_completed.load(Ordering::Relaxed), 3);
    assert_eq!(metrics.total_failed.load(Ordering::Relaxed), 2);
}
