//! Cleanup and index consistency tests.

use super::*;

#[tokio::test]
async fn test_cleanup_completed_jobs_removes_from_index() {
    let qm = setup();

    // Push and complete many jobs
    for i in 0..100 {
        let _job = qm
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
                None, // group_id
            )
            .await
            .unwrap();
        let pulled = qm.pull("test").await;
        qm.ack(pulled.id, None).await.unwrap();
    }

    // Verify jobs are in completed_jobs
    let completed_count = qm.completed_jobs.read().len();
    assert_eq!(completed_count, 100);

    // Verify job_index has entries for completed jobs
    let index_count = qm.job_index.len();
    assert!(index_count >= 100);
}

#[tokio::test]
async fn test_cleanup_completed_jobs_threshold() {
    let qm = setup();

    // Push and complete many jobs
    for i in 0..100 {
        let job = qm
            .push(
                "cleanup-test".to_string(),
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
                None, // group_id
            )
            .await
            .unwrap();
        qm.pull("cleanup-test").await;
        qm.ack(job.id, None).await.unwrap();
    }

    // Completed jobs should be tracked
    let completed_count = qm.completed_jobs.read().len();
    assert_eq!(completed_count, 100);
}

// ==================== INDEX CONSISTENCY TESTS ====================

#[tokio::test]
async fn test_job_index_consistency_after_operations() {
    use crate::queue::types::JobLocation;
    let qm = setup();

    // Push job
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
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // group_id
        )
        .await
        .unwrap();

    // Check index shows Queue location
    let loc = qm.job_index.get(&job.id).map(|r| *r);
    assert!(matches!(loc, Some(JobLocation::Queue { .. })));

    // Pull job
    let _pulled = qm.pull("test").await;

    // Check index shows Processing location
    let loc = qm.job_index.get(&job.id).map(|r| *r);
    assert!(matches!(loc, Some(JobLocation::Processing)));

    // Ack job
    qm.ack(job.id, None).await.unwrap();

    // Check index shows Completed location
    let loc = qm.job_index.get(&job.id).map(|r| *r);
    assert!(matches!(loc, Some(JobLocation::Completed)));
}

#[tokio::test]
async fn test_job_index_consistency_after_fail_to_dlq() {
    use crate::queue::types::JobLocation;
    let qm = setup();

    // Push job with max_attempts=1
    let job = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            None,
            None,
            None,
            Some(1),
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
            None, // group_id
        )
        .await
        .unwrap();

    let _pulled = qm.pull("test").await;
    qm.fail(job.id, None).await.unwrap();

    // Check index shows DLQ location
    let loc = qm.job_index.get(&job.id).map(|r| *r);
    assert!(matches!(loc, Some(JobLocation::Dlq { .. })));
}
