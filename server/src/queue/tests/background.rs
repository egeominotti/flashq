//! Background tasks tests: timeout detection, cron scheduling.

use super::*;

#[tokio::test]
async fn test_job_timeout_detection() {
    let qm = setup();

    // Push job with 1ms timeout
    let job = qm
        .push(
            "test".to_string(),
            json!({"timeout_test": true}),
            0,
            None,
            None,
            Some(1), // 1ms timeout
            Some(1), // max_attempts = 1 (go to DLQ after timeout)
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
    assert_eq!(dlq_jobs[0].id, job.id);
}

#[tokio::test]
async fn test_job_timeout_retry() {
    let qm = setup();

    // Push job with 1ms timeout and multiple attempts
    let job = qm
        .push(
            "test".to_string(),
            json!({"timeout_retry": true}),
            0,
            None,
            None,
            Some(1), // 1ms timeout
            Some(3), // 3 max attempts
            Some(0), // no backoff
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
    let (queued, processing, _, _) = qm.stats().await;
    assert_eq!(processing, 0, "Job should not be processing");
    assert_eq!(queued, 1, "Job should be back in queue");

    // Pull again and verify it's the same job with incremented attempts
    let pulled_again = qm.pull("test").await;
    assert_eq!(pulled_again.id, job.id);
    assert_eq!(pulled_again.attempts, 1);
}
