//! Core operations tests: push, pull, ack, fail, batch.

use super::*;

#[tokio::test]
async fn test_push_and_pull() {
    let qm = setup();

    let job = qm
        .push("test".to_string(), job(json!({"key": "value"})))
        .await
        .unwrap();

    assert!(job.id > 0);
    assert_eq!(job.queue, "test");

    let pulled = qm.pull("test").await;
    assert_eq!(pulled.id, job.id);
}

#[tokio::test]
async fn test_push_with_all_options() {
    let qm = setup();

    let job = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({"payload": "data"}),
                priority: 10,
                delay: Some(0),
                ttl: Some(60000),
                timeout: Some(30000),
                max_attempts: Some(3),
                backoff: Some(1000),
                unique_key: Some("key-1".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(job.priority, 10);
    assert_eq!(job.ttl, 60000);
    assert_eq!(job.timeout, 30000);
    assert_eq!(job.max_attempts, 3);
    assert_eq!(job.backoff, 1000);
    assert_eq!(job.unique_key, Some("key-1".to_string()));
}

#[tokio::test]
async fn test_push_batch() {
    let qm = setup();

    let inputs = vec![
        JobInput::new(json!({"i": 1})),
        JobInput {
            data: json!({"i": 2}),
            priority: 5,
            ..Default::default()
        },
    ];

    let ids = qm.push_batch("test".to_string(), inputs).await;
    assert_eq!(ids.len(), 2);

    // Higher priority job should come first
    let job1 = qm.pull("test").await;
    assert_eq!(job1.priority, 5);

    let job2 = qm.pull("test").await;
    assert_eq!(job2.priority, 0);
}

#[tokio::test]
async fn test_push_batch_large() {
    let qm = setup();

    let inputs: Vec<_> = (0..100)
        .map(|i| JobInput {
            data: json!({"i": i}),
            priority: i,
            ..Default::default()
        })
        .collect();

    let ids = qm.push_batch("test".to_string(), inputs).await;
    assert_eq!(ids.len(), 100);

    // Highest priority first
    let job = qm.pull("test").await;
    assert_eq!(job.priority, 99);
}

#[tokio::test]
async fn test_push_batch_exceeds_limit() {
    let qm = setup();

    // Try to push more than MAX_BATCH_SIZE (1000) jobs
    let inputs: Vec<_> = (0..1001).map(|i| JobInput::new(json!({"i": i}))).collect();

    // Should return empty vec due to batch size limit
    let ids = qm.push_batch("test".to_string(), inputs).await;
    assert!(ids.is_empty(), "Batch exceeding limit should be rejected");
}

#[tokio::test]
async fn test_push_batch_at_limit() {
    let qm = setup();

    // Push exactly MAX_BATCH_SIZE (1000) jobs - should succeed
    let inputs: Vec<_> = (0..1000).map(|i| JobInput::new(json!({"i": i}))).collect();

    let ids = qm.push_batch("test".to_string(), inputs).await;
    assert_eq!(ids.len(), 1000, "Batch at limit should succeed");
}

#[tokio::test]
async fn test_ack() {
    let qm = setup();

    let job = qm.push("test".to_string(), job(json!({}))).await.unwrap();
    let pulled = qm.pull("test").await;

    let result = qm.ack(pulled.id, None).await;
    assert!(result.is_ok());

    // Double ack should fail
    let result2 = qm.ack(job.id, None).await;
    assert!(result2.is_err());
}

#[tokio::test]
async fn test_ack_with_result() {
    let qm = setup();

    let job = qm.push("test".to_string(), job(json!({}))).await.unwrap();
    let pulled = qm.pull("test").await;

    let result_data = json!({"computed": 42, "success": true});
    qm.ack(pulled.id, Some(result_data.clone())).await.unwrap();

    // Check result is stored
    let stored = qm.get_result(job.id).await;
    assert!(stored.is_some());
    assert_eq!(stored.unwrap(), result_data);
}

#[tokio::test]
async fn test_ack_nonexistent_job() {
    let qm = setup();
    let result = qm.ack(999999, None).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_pull_batch() {
    let qm = setup();

    for i in 0..10 {
        qm.push("test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    let jobs = qm.pull_batch("test", 5).await;
    assert_eq!(jobs.len(), 5);

    let (queued, processing, _, _) = qm.stats().await;
    assert_eq!(queued, 5);
    assert_eq!(processing, 5);
}

#[tokio::test]
async fn test_ack_batch() {
    let qm = setup();

    for i in 0..5 {
        qm.push("test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    let jobs = qm.pull_batch("test", 5).await;
    let ids: Vec<u64> = jobs.iter().map(|j| j.id).collect();

    let acked = qm.ack_batch(&ids).await;
    assert_eq!(acked, 5);

    let (_, processing, _, _) = qm.stats().await;
    assert_eq!(processing, 0);
}

// ==================== FAIL AND RETRY ====================

#[tokio::test]
async fn test_fail_and_retry() {
    let qm = setup();

    let job = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({}),
                max_attempts: Some(3),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let pulled = qm.pull("test").await;
    assert_eq!(pulled.attempts, 0);

    // Fail the job
    qm.fail(pulled.id, Some("error".to_string())).await.unwrap();

    // Job should be back in queue with increased attempts
    let repulled = qm.pull("test").await;
    assert_eq!(repulled.id, job.id);
    assert_eq!(repulled.attempts, 1);
}

#[tokio::test]
async fn test_fail_with_backoff() {
    let qm = setup();

    let job = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({}),
                max_attempts: Some(3),
                backoff: Some(100), // 100ms backoff
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let pulled = qm.pull("test").await;
    let started_at = pulled.started_at;
    qm.fail(pulled.id, None).await.unwrap();

    // Job should be delayed due to backoff (exponential: 100ms * 2^0 = 100ms)
    let state = qm.get_state(job.id);
    assert_eq!(state, crate::protocol::JobState::Delayed);

    // Get job and verify run_at is in the future
    let (fetched, _) = qm.get_job(job.id);
    let job_after = fetched.unwrap();
    assert!(
        job_after.run_at > started_at,
        "run_at should be after started_at due to backoff"
    );
    assert_eq!(job_after.attempts, 1, "attempts should be incremented");
}

#[tokio::test]
async fn test_fail_nonexistent_job() {
    let qm = setup();
    let result = qm.fail(999999, None).await;
    assert!(result.is_err());
}
