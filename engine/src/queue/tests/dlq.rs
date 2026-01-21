//! Dead letter queue tests.

use super::*;

#[tokio::test]
async fn test_dlq() {
    let qm = setup();

    // Job with max_attempts=1 goes to DLQ after first failure
    let job = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({}),
                max_attempts: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let pulled = qm.pull("test").await;
    qm.fail(pulled.id, None).await.unwrap();

    let dlq = qm.get_dlq("test", None).await;
    assert_eq!(dlq.len(), 1);
    assert_eq!(dlq[0].id, job.id);

    // Retry from DLQ
    let retried = qm.retry_dlq("test", None).await;
    assert_eq!(retried, 1);

    let dlq_after = qm.get_dlq("test", None).await;
    assert!(dlq_after.is_empty());
}

#[tokio::test]
async fn test_dlq_retry_single() {
    let qm = setup();

    // Create two jobs that will fail
    let job1 = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({"i": 1}),
                max_attempts: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let job2 = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({"i": 2}),
                max_attempts: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Fail both
    let p1 = qm.pull("test").await;
    qm.fail(p1.id, None).await.unwrap();
    let p2 = qm.pull("test").await;
    qm.fail(p2.id, None).await.unwrap();

    let dlq = qm.get_dlq("test", None).await;
    assert_eq!(dlq.len(), 2);

    // Retry only job1
    let retried = qm.retry_dlq("test", Some(job1.id)).await;
    assert_eq!(retried, 1);

    let dlq_after = qm.get_dlq("test", None).await;
    assert_eq!(dlq_after.len(), 1);
    assert_eq!(dlq_after[0].id, job2.id);
}

#[tokio::test]
async fn test_dlq_with_limit() {
    let qm = setup();

    // Create 10 jobs that will fail
    for i in 0..10 {
        qm.push(
            "test".to_string(),
            JobInput {
                data: json!({"i": i}),
                max_attempts: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    }

    // Fail all
    for _ in 0..10 {
        let p = qm.pull("test").await;
        qm.fail(p.id, None).await.unwrap();
    }

    // Get only 5
    let dlq = qm.get_dlq("test", Some(5)).await;
    assert_eq!(dlq.len(), 5);
}
