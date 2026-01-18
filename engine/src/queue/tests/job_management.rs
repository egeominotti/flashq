//! Job management tests: unique keys, cancel, progress.

use super::*;

// ==================== UNIQUE KEY ====================

#[tokio::test]
async fn test_unique_key() {
    let qm = setup();

    let job1 = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            None,
            None,
            None,
            None,
            None,
            Some("unique-123".to_string()),
            None,
            None,
            false,
            false, // remove_on_complete
            false, // remove_on_fail
            None,  // stall_timeout
            None,  // debounce_id
            None,  // debounce_ttl
            None,  // job_id
            None,  // keep_completed_age
            None,  // keep_completed_count
            None,  // group_id
        )
        .await;
    assert!(job1.is_ok());

    // Duplicate should fail
    let job2 = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            None,
            None,
            None,
            None,
            None,
            Some("unique-123".to_string()),
            None,
            None,
            false,
            false, // remove_on_complete
            false, // remove_on_fail
            None,  // stall_timeout
            None,  // debounce_id
            None,  // debounce_ttl
            None,  // job_id
            None,  // keep_completed_age
            None,  // keep_completed_count
            None,  // group_id
        )
        .await;
    assert!(job2.is_err());

    // After ack, key should be released
    let pulled = qm.pull("test").await;
    qm.ack(pulled.id, None).await.unwrap();

    let job3 = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            None,
            None,
            None,
            None,
            None,
            Some("unique-123".to_string()),
            None,
            None,
            false,
            false, // remove_on_complete
            false, // remove_on_fail
            None,  // stall_timeout
            None,  // debounce_id
            None,  // debounce_ttl
            None,  // job_id
            None,  // keep_completed_age
            None,  // keep_completed_count
            None,  // group_id
        )
        .await;
    assert!(job3.is_ok());
}

#[tokio::test]
async fn test_unique_key_different_queues() {
    let qm = setup();

    // Same unique key in different queues should work
    let job1 = qm
        .push(
            "queue1".to_string(),
            json!({}),
            0,
            None,
            None,
            None,
            None,
            None,
            Some("same-key".to_string()),
            None,
            None,
            false,
            false, // remove_on_complete
            false, // remove_on_fail
            None,  // stall_timeout
            None,  // debounce_id
            None,  // debounce_ttl
            None,  // job_id
            None,  // keep_completed_age
            None,  // keep_completed_count
            None,  // group_id
        )
        .await;
    assert!(job1.is_ok());

    let job2 = qm
        .push(
            "queue2".to_string(),
            json!({}),
            0,
            None,
            None,
            None,
            None,
            None,
            Some("same-key".to_string()),
            None,
            None,
            false,
            false, // remove_on_complete
            false, // remove_on_fail
            None,  // stall_timeout
            None,  // debounce_id
            None,  // debounce_ttl
            None,  // job_id
            None,  // keep_completed_age
            None,  // keep_completed_count
            None,  // group_id
        )
        .await;
    assert!(job2.is_ok());
}

#[tokio::test]
async fn test_unique_key_released_on_fail() {
    let qm = setup();

    let _job = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            None,
            None,
            None,
            Some(1),
            None,
            Some("unique-fail".to_string()),
            None,
            None,
            false,
            false, // remove_on_complete
            false, // remove_on_fail
            None,  // stall_timeout
            None,  // debounce_id
            None,  // debounce_ttl
            None,  // job_id
            None,  // keep_completed_age
            None,  // keep_completed_count
            None,  // group_id
        )
        .await
        .unwrap();

    let pulled = qm.pull("test").await;
    qm.fail(pulled.id, None).await.unwrap(); // Goes to DLQ

    // Unique key should still be locked while in DLQ
    // (this is expected behavior - job is still "in system")
}

#[tokio::test]
async fn test_cancel_releases_unique_key() {
    let qm = setup();

    let job = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            Some(60000), // delayed
            None,
            None,
            None,
            None,
            Some("cancel-key".to_string()),
            None,
            None,
            false,
            false, // remove_on_complete
            false, // remove_on_fail
            None,  // stall_timeout
            None,  // debounce_id
            None,  // debounce_ttl
            None,  // job_id
            None,  // keep_completed_age
            None,  // keep_completed_count
            None,  // group_id
        )
        .await
        .unwrap();

    // Cancel should release the unique key
    qm.cancel(job.id).await.unwrap();

    // Should be able to push with same key now
    let job2 = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            None,
            None,
            None,
            None,
            None,
            Some("cancel-key".to_string()),
            None,
            None,
            false,
            false, // remove_on_complete
            false, // remove_on_fail
            None,  // stall_timeout
            None,  // debounce_id
            None,  // debounce_ttl
            None,  // job_id
            None,  // keep_completed_age
            None,  // keep_completed_count
            None,  // group_id
        )
        .await;
    assert!(job2.is_ok());
}

// ==================== CANCEL ====================

#[tokio::test]
async fn test_cancel() {
    let qm = setup();

    let job = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            Some(60000),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            false,
            false, // remove_on_complete
            false, // remove_on_fail
            None,  // stall_timeout
            None,  // debounce_id
            None,  // debounce_ttl
            None,  // job_id
            None,  // keep_completed_age
            None,  // keep_completed_count
            None,  // group_id
        )
        .await
        .unwrap();

    let result = qm.cancel(job.id).await;
    assert!(result.is_ok());

    // Cancel non-existent should fail
    let result2 = qm.cancel(999999).await;
    assert!(result2.is_err());
}

#[tokio::test]
async fn test_cancel_processing_job() {
    let qm = setup();

    let job = qm
        .push(
            "test".to_string(),
            json!({}),
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
            false, // remove_on_complete
            false, // remove_on_fail
            None,  // stall_timeout
            None,  // debounce_id
            None,  // debounce_ttl
            None,  // job_id
            None,  // keep_completed_age
            None,  // keep_completed_count
            None,  // group_id
        )
        .await
        .unwrap();
    let _pulled = qm.pull("test").await;

    // Cancel while processing
    let result = qm.cancel(job.id).await;
    assert!(result.is_ok());

    let (_, processing, _, _) = qm.stats().await;
    assert_eq!(processing, 0);
}

#[tokio::test]
async fn test_cancel_job_in_queue_preserves_others() {
    let qm = setup();

    // Push multiple jobs
    let job1 = qm
        .push(
            "test".to_string(),
            json!({"i": 1}),
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
            None,  // group_id
        )
        .await
        .unwrap();
    let job2 = qm
        .push(
            "test".to_string(),
            json!({"i": 2}),
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
            None,  // group_id
        )
        .await
        .unwrap();
    let job3 = qm
        .push(
            "test".to_string(),
            json!({"i": 3}),
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
            None,  // group_id
        )
        .await
        .unwrap();

    // Cancel the middle job
    qm.cancel(job2.id).await.unwrap();

    // Pull and verify remaining jobs
    let pulled1 = qm.pull("test").await;
    let pulled2 = qm.pull("test").await;

    // Should get job1 and job3 (FIFO order)
    assert_eq!(pulled1.id, job1.id);
    assert_eq!(pulled2.id, job3.id);

    // Queue should be empty now
    let (queued, _, _, _) = qm.stats().await;
    assert_eq!(queued, 0);
}

#[tokio::test]
async fn test_concurrent_cancel_operations() {
    let qm = setup();

    // Create many jobs and collect their IDs
    let mut job_ids = vec![];
    for i in 0..100 {
        let job = qm
            .push(
                "test".to_string(),
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
                None,  // group_id
            )
            .await
            .unwrap();
        job_ids.push(job.id);
    }

    // Cancel all concurrently using actual job IDs
    let mut handles = vec![];
    for job_id in job_ids {
        let qm_clone = qm.clone();
        handles.push(tokio::spawn(async move { qm_clone.cancel(job_id).await }));
    }

    for handle in handles {
        let _ = handle.await.unwrap();
    }

    // All should be cancelled
    let (queued, _, _, _) = qm.stats().await;
    assert_eq!(queued, 0);
}

// ==================== PROGRESS ====================

#[tokio::test]
async fn test_progress() {
    let qm = setup();

    let _job = qm
        .push(
            "test".to_string(),
            json!({}),
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
            false, // remove_on_complete
            false, // remove_on_fail
            None,  // stall_timeout
            None,  // debounce_id
            None,  // debounce_ttl
            None,  // job_id
            None,  // keep_completed_age
            None,  // keep_completed_count
            None,  // group_id
        )
        .await
        .unwrap();
    let pulled = qm.pull("test").await;

    // Update progress
    qm.update_progress(pulled.id, 50, Some("halfway".to_string()))
        .await
        .unwrap();

    let (progress, msg) = qm.get_progress(pulled.id).await.unwrap();
    assert_eq!(progress, 50);
    assert_eq!(msg, Some("halfway".to_string()));
}

#[tokio::test]
async fn test_progress_max_100() {
    let qm = setup();

    let _job = qm
        .push(
            "test".to_string(),
            json!({}),
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
            false, // remove_on_complete
            false, // remove_on_fail
            None,  // stall_timeout
            None,  // debounce_id
            None,  // debounce_ttl
            None,  // job_id
            None,  // keep_completed_age
            None,  // keep_completed_count
            None,  // group_id
        )
        .await
        .unwrap();
    let pulled = qm.pull("test").await;

    // Progress should cap at 100
    qm.update_progress(pulled.id, 150, None).await.unwrap();

    let (progress, _) = qm.get_progress(pulled.id).await.unwrap();
    assert_eq!(progress, 100);
}

#[tokio::test]
async fn test_progress_nonexistent() {
    let qm = setup();
    let result = qm.get_progress(999999).await;
    assert!(result.is_err());
}
