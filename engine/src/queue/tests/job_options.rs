//! Job options tests: remove_on_complete, remove_on_fail, stall_timeout,
//! debounce, retention policies, job logs, heartbeat.

use super::*;

// ==================== REMOVE ON COMPLETE ====================

#[tokio::test]
async fn test_remove_on_complete() {
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
            true, // remove_on_complete = true
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

    // Job should be removed (not in completed)
    let state = qm.get_state(job.id);
    assert_eq!(state, crate::protocol::JobState::Unknown);
}

#[tokio::test]
async fn test_remove_on_complete_false() {
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
            false, // remove_on_complete = false
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

    // Job should still be tracked as completed
    let state = qm.get_state(job.id);
    assert_eq!(state, crate::protocol::JobState::Completed);
}

// ==================== REMOVE ON FAIL ====================

#[tokio::test]
async fn test_remove_on_fail() {
    let qm = setup();

    let job = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            None,
            None,
            None,
            Some(1), // max_attempts = 1
            None,
            None,
            None,
            None,
            false,
            false,
            true, // remove_on_fail = true
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
    qm.fail(pulled.id, None).await.unwrap();

    // Job should be removed (not in DLQ)
    let dlq = qm.get_dlq("test", None).await;
    assert!(dlq.is_empty());

    let state = qm.get_state(job.id);
    assert_eq!(state, crate::protocol::JobState::Unknown);
}

// ==================== DEBOUNCE ====================

#[tokio::test]
async fn test_debounce_prevents_duplicate() {
    let qm = setup();

    // First push succeeds
    let job1 = qm
        .push(
            "test".to_string(),
            json!({"first": true}),
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
            Some("event-123".to_string()), // debounce_id
            Some(5000),                    // debounce_ttl = 5 seconds
            None,
            None,
            None,
            None, // group_id
        )
        .await;
    assert!(job1.is_ok());

    // Second push with same debounce_id should be rejected
    let job2 = qm
        .push(
            "test".to_string(),
            json!({"second": true}),
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
            Some("event-123".to_string()), // same debounce_id
            Some(5000),
            None,
            None,
            None,
            None, // group_id
        )
        .await;
    assert!(job2.is_err());
    assert!(job2.unwrap_err().contains("Debounced"));
}

#[tokio::test]
async fn test_debounce_different_ids_allowed() {
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
            None,
            None,
            None,
            false,
            false,
            false,
            None,
            Some("event-1".to_string()),
            Some(5000),
            None,
            None,
            None,
            None, // group_id
        )
        .await;
    assert!(job1.is_ok());

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
            None,
            None,
            None,
            false,
            false,
            false,
            None,
            Some("event-2".to_string()), // different debounce_id
            Some(5000),
            None,
            None,
            None,
            None, // group_id
        )
        .await;
    assert!(job2.is_ok());
}

// ==================== RETENTION POLICIES ====================

#[tokio::test]
async fn test_keep_completed_count() {
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
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            Some(100), // keep_completed_count
            None,      // group_id
        )
        .await
        .unwrap();

    assert_eq!(job.keep_completed_count, 100);
}

#[tokio::test]
async fn test_keep_completed_age() {
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
            false,
            false,
            None,
            None,
            None,
            None,
            Some(86400000), // 24 hours
            None,
            None, // group_id
        )
        .await
        .unwrap();

    assert_eq!(job.keep_completed_age, 86400000);
}

// ==================== JOB LOGS ====================

#[tokio::test]
async fn test_add_job_log() {
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

    // Add logs
    let _ = qm.add_job_log(
        job.id,
        "Starting processing".to_string(),
        "info".to_string(),
    );
    let _ = qm.add_job_log(job.id, "Step 1 complete".to_string(), "info".to_string());
    let _ = qm.add_job_log(job.id, "Warning: slow".to_string(), "warn".to_string());

    let logs = qm.get_job_logs(job.id);
    assert_eq!(logs.len(), 3);
    assert_eq!(logs[0].message, "Starting processing");
    assert_eq!(logs[0].level, "info");
}

#[tokio::test]
async fn test_get_job_logs_empty() {
    let qm = setup();

    let logs = qm.get_job_logs(999999);
    assert!(logs.is_empty());
}

// ==================== HEARTBEAT ====================

#[tokio::test]
async fn test_job_heartbeat() {
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
            false,
            false,
            Some(5000), // stall_timeout = 5s
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
    let initial_heartbeat = pulled.last_heartbeat;

    // Small delay
    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

    // Send heartbeat
    let result = qm.heartbeat(job.id);
    assert!(result.is_ok());

    // Verify heartbeat updated
    if let Some(updated_job) = qm.processing_get(job.id) {
        assert!(updated_job.last_heartbeat >= initial_heartbeat);
    }
}

#[tokio::test]
async fn test_heartbeat_not_processing() {
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

    // Don't pull, just try heartbeat
    let result = qm.heartbeat(job.id);
    assert!(result.is_err());
}

// ==================== STALL TIMEOUT ====================

#[tokio::test]
async fn test_stall_timeout_set() {
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
            false,
            false,
            Some(10000), // stall_timeout = 10s
            None,
            None,
            None,
            None,
            None,
            None, // group_id
        )
        .await
        .unwrap();

    assert_eq!(job.stall_timeout, 10000);
}

// ==================== GET CHILDREN ====================

#[tokio::test]
async fn test_get_children() {
    let qm = setup();

    let children = vec![
        crate::protocol::FlowChild {
            queue: "child-queue".to_string(),
            data: json!({"child": 1}),
            priority: 0,
            delay: None,
        },
        crate::protocol::FlowChild {
            queue: "child-queue".to_string(),
            data: json!({"child": 2}),
            priority: 0,
            delay: None,
        },
    ];

    let (parent_id, _children_ids) = qm
        .push_flow("parent-queue".to_string(), json!({}), children, 0)
        .await
        .unwrap();

    let result = qm.get_children(parent_id);
    assert!(result.is_some());

    let (children_jobs, completed, total) = result.unwrap();
    assert_eq!(total, 2);
    assert_eq!(completed, 0);
    assert_eq!(children_jobs.len(), 2);
}

#[tokio::test]
async fn test_get_children_not_flow() {
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

    let result = qm.get_children(job.id);
    assert!(result.is_none());
}
