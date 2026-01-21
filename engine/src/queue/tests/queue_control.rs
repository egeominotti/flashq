//! Queue control tests: pause/resume, rate limiting, concurrency.

use super::*;

// ==================== PAUSE/RESUME ====================

#[tokio::test]
async fn test_pause_resume() {
    let qm = setup();

    // Need to push a job first so the queue appears in list_queues
    qm.push("test".to_string(), job(json!({"x": 1})))
        .await
        .unwrap();

    qm.pause("test").await;

    // Verify paused via list_queues
    let queues = qm.list_queues().await;
    let test_queue = queues.iter().find(|q| q.name == "test");
    assert!(test_queue.is_some());
    assert!(test_queue.unwrap().paused);

    qm.resume("test").await;

    // Verify resumed via list_queues
    let queues = qm.list_queues().await;
    let test_queue = queues.iter().find(|q| q.name == "test");
    assert!(!test_queue.unwrap().paused);
}

// ==================== RATE LIMITING ====================

#[tokio::test]
async fn test_rate_limit() {
    let qm = setup();

    qm.set_rate_limit("test".to_string(), 100).await;

    // Check via list_queues that rate limit is set
    qm.push("test".to_string(), job(json!({}))).await.unwrap();

    let queues = qm.list_queues().await;
    let test_queue = queues.iter().find(|q| q.name == "test");
    assert!(test_queue.is_some());
    assert_eq!(test_queue.unwrap().rate_limit, Some(100));

    qm.clear_rate_limit("test").await;

    let queues2 = qm.list_queues().await;
    let test_queue2 = queues2.iter().find(|q| q.name == "test");
    assert_eq!(test_queue2.unwrap().rate_limit, None);
}

// ==================== CONCURRENCY LIMIT ====================

#[tokio::test]
async fn test_concurrency_limit() {
    let qm = setup();

    qm.set_concurrency("test".to_string(), 2).await;

    // Push 3 jobs
    for i in 0..3 {
        qm.push("test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    // Check via list_queues
    let queues = qm.list_queues().await;
    let test_queue = queues.iter().find(|q| q.name == "test");
    assert_eq!(test_queue.unwrap().concurrency_limit, Some(2));

    // Clear limit
    qm.clear_concurrency("test").await;
}
