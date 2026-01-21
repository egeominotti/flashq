//! Concurrent operations tests.

use super::*;

#[tokio::test]
async fn test_concurrent_push() {
    let qm = setup();

    let mut handles = vec![];
    for i in 0..100 {
        let qm_clone = qm.clone();
        handles.push(tokio::spawn(async move {
            qm_clone
                .push("test".to_string(), job(json!({"i": i})))
                .await
                .unwrap()
        }));
    }

    for handle in handles {
        handle.await.unwrap();
    }

    let (queued, _, _, _, _) = qm.stats().await;
    assert_eq!(queued, 100);
}

#[tokio::test]
async fn test_concurrent_push_pull() {
    let qm = setup();

    // Pre-populate
    for i in 0..50 {
        qm.push("test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    let mut push_handles = vec![];
    let mut pull_handles = vec![];

    // Concurrent pushes
    for i in 50..100 {
        let qm_clone = qm.clone();
        push_handles.push(tokio::spawn(async move {
            qm_clone
                .push("test".to_string(), job(json!({"i": i})))
                .await
                .unwrap()
        }));
    }

    // Concurrent pulls
    for _ in 0..50 {
        let qm_clone = qm.clone();
        pull_handles.push(tokio::spawn(async move { qm_clone.pull("test").await }));
    }

    for handle in push_handles {
        handle.await.unwrap();
    }
    for handle in pull_handles {
        handle.await.unwrap();
    }

    let (queued, processing, _, _, _) = qm.stats().await;
    assert_eq!(queued + processing, 100);
}
