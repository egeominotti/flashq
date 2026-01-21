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

// ==================== CONCURRENT ACK ====================

#[tokio::test]
async fn test_concurrent_ack_multiple_workers() {
    let qm = setup();

    // Push 100 jobs
    for i in 0..100 {
        qm.push("ack-test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    // Pull all jobs first (simulating multiple workers getting jobs)
    let mut job_ids = vec![];
    for _ in 0..100 {
        let pulled = qm.pull("ack-test").await;
        job_ids.push(pulled.id);
    }

    // Verify all are in processing
    let (queued, processing, _, _, _) = qm.stats().await;
    assert_eq!(queued, 0);
    assert_eq!(processing, 100);

    // Concurrent acks from "50 workers" (each acking 2 jobs)
    let mut ack_handles = vec![];
    for chunk in job_ids.chunks(2) {
        let qm_clone = qm.clone();
        let ids = chunk.to_vec();
        ack_handles.push(tokio::spawn(async move {
            for id in ids {
                qm_clone.ack(id, Some(json!({"done": true}))).await.unwrap();
            }
        }));
    }

    for handle in ack_handles {
        handle.await.unwrap();
    }

    // All jobs should be completed
    let (queued2, processing2, _, _, _) = qm.stats().await;
    assert_eq!(queued2, 0, "Queue should be empty");
    assert_eq!(processing2, 0, "Processing should be empty");
}

#[tokio::test]
async fn test_concurrent_fail_multiple_workers() {
    let qm = setup();

    // Push 50 jobs that will fail
    for i in 0..50 {
        qm.push(
            "fail-test".to_string(),
            JobInput {
                data: json!({"i": i}),
                max_attempts: Some(1), // Go to DLQ immediately
                ..Default::default()
            },
        )
        .await
        .unwrap();
    }

    // Pull all jobs
    let mut job_ids = vec![];
    for _ in 0..50 {
        let pulled = qm.pull("fail-test").await;
        job_ids.push(pulled.id);
    }

    // Concurrent fails from multiple workers
    let mut fail_handles = vec![];
    for id in job_ids {
        let qm_clone = qm.clone();
        fail_handles.push(tokio::spawn(async move {
            qm_clone
                .fail(id, Some("worker error".to_string()))
                .await
                .unwrap()
        }));
    }

    for handle in fail_handles {
        handle.await.unwrap();
    }

    // All jobs should be in DLQ (max_attempts=1)
    let dlq = qm.get_dlq("fail-test", None).await;
    assert_eq!(dlq.len(), 50, "All jobs should be in DLQ");

    let (_, processing, _, dlq_count, _) = qm.stats().await;
    assert_eq!(processing, 0, "Processing should be empty");
    assert_eq!(dlq_count, 50, "DLQ count should be 50");
}

#[tokio::test]
async fn test_concurrent_operations_across_queues() {
    let qm = setup();

    // Push to 10 different queues concurrently
    let mut push_handles = vec![];
    for q in 0..10 {
        for i in 0..20 {
            let qm_clone = qm.clone();
            let queue_name = format!("queue-{}", q);
            push_handles.push(tokio::spawn(async move {
                qm_clone
                    .push(queue_name, job(json!({"q": q, "i": i})))
                    .await
                    .unwrap()
            }));
        }
    }

    for handle in push_handles {
        handle.await.unwrap();
    }

    // Should have 200 total jobs across 10 queues
    let queues = qm.list_queues().await;
    assert_eq!(queues.len(), 10, "Should have 10 queues");

    let total: usize = queues.iter().map(|q| q.pending).sum();
    assert_eq!(total, 200, "Should have 200 total jobs");

    // Pull and ack from all queues concurrently
    let mut process_handles = vec![];
    for q in 0..10 {
        let qm_clone = qm.clone();
        let queue_name = format!("queue-{}", q);
        process_handles.push(tokio::spawn(async move {
            for _ in 0..20 {
                let pulled = qm_clone.pull(&queue_name).await;
                qm_clone.ack(pulled.id, None).await.unwrap();
            }
        }));
    }

    for handle in process_handles {
        handle.await.unwrap();
    }

    // All queues should be empty
    let (queued, processing, _, _, _) = qm.stats().await;
    assert_eq!(queued + processing, 0, "All jobs should be processed");
}
