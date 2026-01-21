//! Job options tests: remove_on_complete, remove_on_fail, stall_timeout,
//! debounce, retention policies, job logs, heartbeat.

use super::*;

// ==================== REMOVE ON COMPLETE ====================

#[tokio::test]
async fn test_remove_on_complete() {
    let qm = setup();

    let j = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({}),
                remove_on_complete: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let pulled = qm.pull("test").await;
    qm.ack(pulled.id, None).await.unwrap();

    // Job should be removed (not in completed)
    let state = qm.get_state(j.id);
    assert_eq!(state, crate::protocol::JobState::Unknown);
}

#[tokio::test]
async fn test_remove_on_complete_false() {
    let qm = setup();

    let j = qm.push("test".to_string(), job(json!({}))).await.unwrap();

    let pulled = qm.pull("test").await;
    qm.ack(pulled.id, None).await.unwrap();

    // Job should still be tracked as completed
    let state = qm.get_state(j.id);
    assert_eq!(state, crate::protocol::JobState::Completed);
}

// ==================== REMOVE ON FAIL ====================

#[tokio::test]
async fn test_remove_on_fail() {
    let qm = setup();

    let j = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({}),
                max_attempts: Some(1),
                remove_on_fail: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let pulled = qm.pull("test").await;
    qm.fail(pulled.id, None).await.unwrap();

    // Job should be removed (not in DLQ)
    let dlq = qm.get_dlq("test", None).await;
    assert!(dlq.is_empty());

    let state = qm.get_state(j.id);
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
            JobInput {
                data: json!({"first": true}),
                debounce_id: Some("event-123".to_string()),
                debounce_ttl: Some(5000), // 5 seconds
                ..Default::default()
            },
        )
        .await;
    assert!(job1.is_ok());

    // Second push with same debounce_id should be rejected
    let job2 = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({"second": true}),
                debounce_id: Some("event-123".to_string()), // same debounce_id
                debounce_ttl: Some(5000),
                ..Default::default()
            },
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
            JobInput {
                data: json!({}),
                debounce_id: Some("event-1".to_string()),
                debounce_ttl: Some(5000),
                ..Default::default()
            },
        )
        .await;
    assert!(job1.is_ok());

    let job2 = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({}),
                debounce_id: Some("event-2".to_string()), // different debounce_id
                debounce_ttl: Some(5000),
                ..Default::default()
            },
        )
        .await;
    assert!(job2.is_ok());
}

// ==================== RETENTION POLICIES ====================

#[tokio::test]
async fn test_keep_completed_count() {
    let qm = setup();

    let j = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({}),
                keep_completed_count: Some(100),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(j.keep_completed_count, 100);
}

#[tokio::test]
async fn test_keep_completed_age() {
    let qm = setup();

    let j = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({}),
                keep_completed_age: Some(86400000), // 24 hours
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(j.keep_completed_age, 86400000);
}

// ==================== JOB LOGS ====================

#[tokio::test]
async fn test_add_job_log() {
    let qm = setup();

    let j = qm.push("test".to_string(), job(json!({}))).await.unwrap();

    // Add logs
    let _ = qm.add_job_log(j.id, "Starting processing".to_string(), "info".to_string());
    let _ = qm.add_job_log(j.id, "Step 1 complete".to_string(), "info".to_string());
    let _ = qm.add_job_log(j.id, "Warning: slow".to_string(), "warn".to_string());

    let logs = qm.get_job_logs(j.id);
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

    let j = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({}),
                stall_timeout: Some(5000), // stall_timeout = 5s
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let pulled = qm.pull("test").await;
    let initial_heartbeat = pulled.last_heartbeat;

    // Small delay
    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

    // Send heartbeat
    let result = qm.heartbeat(j.id);
    assert!(result.is_ok());

    // Verify heartbeat updated
    if let Some(updated_job) = qm.processing_get(j.id) {
        assert!(updated_job.last_heartbeat >= initial_heartbeat);
    }
}

#[tokio::test]
async fn test_heartbeat_not_processing() {
    let qm = setup();

    let j = qm.push("test".to_string(), job(json!({}))).await.unwrap();

    // Don't pull, just try heartbeat
    let result = qm.heartbeat(j.id);
    assert!(result.is_err());
}

// ==================== STALL TIMEOUT ====================

#[tokio::test]
async fn test_stall_timeout_set() {
    let qm = setup();

    let j = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({}),
                stall_timeout: Some(10000), // stall_timeout = 10s
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(j.stall_timeout, 10000);
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

    let j = qm.push("test".to_string(), job(json!({}))).await.unwrap();

    let result = qm.get_children(j.id);
    assert!(result.is_none());
}
