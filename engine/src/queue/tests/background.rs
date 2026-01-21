//! Background tasks tests: timeout detection, cron scheduling.

use super::*;

#[tokio::test]
async fn test_job_timeout_detection() {
    let qm = setup();

    // Push job with 1ms timeout
    let j = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({"timeout_test": true}),
                timeout: Some(1),      // 1ms timeout
                max_attempts: Some(1), // max_attempts = 1 (go to DLQ after timeout)
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Pull job to start processing
    let _pulled = qm.pull("test").await;

    // Wait for timeout
    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

    // Manually trigger timeout check
    qm.check_timed_out_jobs().await;

    // Job should be in DLQ (max_attempts=1, so after 1 fail goes to DLQ)
    let dlq_jobs = qm.get_dlq("test", Some(10)).await;
    assert_eq!(dlq_jobs.len(), 1);
    assert_eq!(dlq_jobs[0].id, j.id);
}

#[tokio::test]
async fn test_job_timeout_retry() {
    let qm = setup();

    // Push job with 1ms timeout and multiple attempts
    let j = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({"timeout_retry": true}),
                timeout: Some(1),      // 1ms timeout
                max_attempts: Some(3), // 3 max attempts
                backoff: Some(0),      // no backoff
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Pull job
    let _pulled = qm.pull("test").await;

    // Wait for timeout
    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

    // Trigger timeout check
    qm.check_timed_out_jobs().await;

    // Job should be back in queue (attempt 1 of 3)
    let (queued, processing, _, _, _) = qm.stats().await;
    assert_eq!(processing, 0, "Job should not be processing");
    assert_eq!(queued, 1, "Job should be back in queue");

    // Pull again and verify it's the same job with incremented attempts
    let pulled_again = qm.pull("test").await;
    assert_eq!(pulled_again.id, j.id);
    assert_eq!(pulled_again.attempts, 1);
}

// ==================== STALLED JOB DETECTION ====================

#[tokio::test]
async fn test_stalled_job_detection_moves_to_dlq() {
    let qm = setup();

    // Push job with very short stall timeout (1ms)
    let j = qm
        .push(
            "stall-test".to_string(),
            JobInput {
                data: json!({"stall_test": true}),
                stall_timeout: Some(1), // 1ms stall timeout
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Pull job to start processing
    let _pulled = qm.pull("stall-test").await;

    // Wait for stall timeout to expire
    tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;

    // Trigger stall check 3 times (job moves to DLQ after 3 stalls)
    for _ in 0..3 {
        qm.check_stalled_jobs();
        tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
    }

    // Job should be in DLQ after 3 stall detections
    let dlq_jobs = qm.get_dlq("stall-test", Some(10)).await;
    assert_eq!(dlq_jobs.len(), 1, "Job should be in DLQ after 3 stalls");
    assert_eq!(dlq_jobs[0].id, j.id);

    // Processing should be empty
    let (_, processing, _, _, _) = qm.stats().await;
    assert_eq!(processing, 0, "No jobs should be processing");
}

#[tokio::test]
async fn test_stalled_job_heartbeat_prevents_stall() {
    let qm = setup();

    // Push job with short stall timeout
    let _j = qm
        .push(
            "heartbeat-test".to_string(),
            JobInput {
                data: json!({"heartbeat_test": true}),
                stall_timeout: Some(10), // 10ms stall timeout
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Pull job
    let pulled = qm.pull("heartbeat-test").await;

    // Send heartbeat before stall check
    tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
    qm.heartbeat(pulled.id).unwrap();

    // Wait and check for stalls - heartbeat should prevent detection
    tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
    qm.check_stalled_jobs();

    // Job should still be processing (heartbeat reset the timer)
    let (_, processing, _, _, _) = qm.stats().await;
    assert_eq!(
        processing, 1,
        "Job should still be processing after heartbeat"
    );

    // DLQ should be empty
    let dlq_jobs = qm.get_dlq("heartbeat-test", Some(10)).await;
    assert!(dlq_jobs.is_empty(), "DLQ should be empty");
}

#[tokio::test]
async fn test_stalled_job_increments_stall_count() {
    let qm = setup();

    // Push job with very short stall timeout
    let _j = qm
        .push(
            "stall-count-test".to_string(),
            JobInput {
                data: json!({}),
                stall_timeout: Some(1), // 1ms stall timeout
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Pull job
    let pulled = qm.pull("stall-count-test").await;

    // Wait and trigger first stall check
    tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
    qm.check_stalled_jobs();

    // Job should still be processing (only 1 stall, need 3 for DLQ)
    let (_, processing, _, _, _) = qm.stats().await;
    assert_eq!(
        processing, 1,
        "Job should still be processing after 1 stall"
    );

    // Verify stall count incremented via job logs
    let logs = qm.get_job_logs(pulled.id);
    assert!(!logs.is_empty(), "Should have log entry for stall");
    assert!(
        logs[0].message.contains("stall detected"),
        "Log should mention stall"
    );
}
