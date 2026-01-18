//! Advanced operations tests: drain, obliterate, clean, change_priority,
//! move_to_delayed, promote, update_job_data, discard, push_flow, purge_dlq, is_paused.

use super::*;

// ==================== DRAIN ====================

#[tokio::test]
async fn test_drain_removes_all_waiting_jobs() {
    let qm = setup();

    // Push 10 jobs
    for i in 0..10 {
        qm.push(
            "drain-test".to_string(),
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
        )
        .await
        .unwrap();
    }

    let (queued, _, _, _) = qm.stats().await;
    assert_eq!(queued, 10);

    // Drain the queue
    let removed = qm.drain("drain-test").await;
    assert_eq!(removed, 10);

    // Queue should be empty
    let (queued_after, _, _, _) = qm.stats().await;
    assert_eq!(queued_after, 0);
}

#[tokio::test]
async fn test_drain_does_not_affect_other_queues() {
    let qm = setup();

    // Push jobs to two different queues
    for i in 0..5 {
        qm.push(
            "queue-a".to_string(),
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
        )
        .await
        .unwrap();
    }
    for i in 0..3 {
        qm.push(
            "queue-b".to_string(),
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
        )
        .await
        .unwrap();
    }

    // Drain only queue-a
    let removed = qm.drain("queue-a").await;
    assert_eq!(removed, 5);

    // queue-b should still have 3 jobs
    let count = qm.count("queue-b");
    assert_eq!(count, 3);
}

#[tokio::test]
async fn test_drain_empty_queue() {
    let qm = setup();

    let removed = qm.drain("nonexistent-queue").await;
    assert_eq!(removed, 0);
}

// ==================== OBLITERATE ====================

#[tokio::test]
async fn test_obliterate_removes_all_queue_data() {
    let qm = setup();

    // Push some jobs
    for i in 0..5 {
        qm.push(
            "obliterate-test".to_string(),
            json!({"i": i}),
            0,
            None,
            None,
            None,
            Some(1), // max_attempts=1 so it goes to DLQ on fail
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
    }

    // Pull and fail one to put it in DLQ
    let pulled = qm.pull("obliterate-test").await;
    qm.fail(pulled.id, Some("test error".to_string()))
        .await
        .unwrap();

    // Verify DLQ has job
    let dlq = qm.get_dlq("obliterate-test", None).await;
    assert_eq!(dlq.len(), 1);

    // Obliterate the queue
    let removed = qm.obliterate("obliterate-test").await;
    assert!(removed >= 5); // At least the 5 jobs we pushed

    // Queue should be completely empty
    let count = qm.count("obliterate-test");
    assert_eq!(count, 0);

    // DLQ should be empty too
    let dlq_after = qm.get_dlq("obliterate-test", None).await;
    assert!(dlq_after.is_empty());
}

// ==================== CLEAN ====================

#[tokio::test]
async fn test_clean_removes_old_failed_jobs() {
    let qm = setup();

    // Push and fail jobs
    for i in 0..5 {
        let job = qm
            .push(
                "clean-test".to_string(),
                json!({"i": i}),
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
            )
            .await
            .unwrap();

        let _ = qm.pull("clean-test").await;
        qm.fail(job.id, None).await.unwrap();
    }

    // Verify DLQ has jobs
    let dlq = qm.get_dlq("clean-test", None).await;
    assert_eq!(dlq.len(), 5);

    // Clean with 0 grace period (removes all)
    let cleaned = qm
        .clean("clean-test", 0, crate::protocol::JobState::Failed, Some(3))
        .await;
    assert_eq!(cleaned, 3); // Limited to 3

    // DLQ should have 2 jobs left
    let dlq_after = qm.get_dlq("clean-test", None).await;
    assert_eq!(dlq_after.len(), 2);
}

// ==================== CHANGE PRIORITY ====================

#[tokio::test]
async fn test_change_priority_waiting_job() {
    let qm = setup();

    let job1 = qm
        .push(
            "priority-test".to_string(),
            json!({"name": "low"}),
            0, // low priority
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
        )
        .await
        .unwrap();

    let job2 = qm
        .push(
            "priority-test".to_string(),
            json!({"name": "high"}),
            10, // high priority
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
        )
        .await
        .unwrap();

    // job2 should be pulled first (higher priority)
    let pulled = qm.pull("priority-test").await;
    assert_eq!(pulled.id, job2.id);
    qm.ack(pulled.id, None).await.unwrap();

    // Now change job1's priority to very high
    qm.change_priority(job1.id, 100).await.unwrap();

    // Push another job with medium priority
    let job3 = qm
        .push(
            "priority-test".to_string(),
            json!({"name": "medium"}),
            50,
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
        )
        .await
        .unwrap();

    // job1 should be pulled first now (priority 100 > 50)
    let pulled = qm.pull("priority-test").await;
    assert_eq!(pulled.id, job1.id);

    // Then job3
    let pulled2 = qm.pull("priority-test").await;
    assert_eq!(pulled2.id, job3.id);
}

#[tokio::test]
async fn test_change_priority_processing_job() {
    let qm = setup();

    let job = qm
        .push(
            "test".to_string(),
            json!({}),
            5,
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
        )
        .await
        .unwrap();

    // Pull job to processing
    let _ = qm.pull("test").await;

    // Change priority while processing
    let result = qm.change_priority(job.id, 100).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_change_priority_nonexistent() {
    let qm = setup();

    let result = qm.change_priority(999999, 100).await;
    assert!(result.is_err());
}

// ==================== MOVE TO DELAYED ====================

#[tokio::test]
async fn test_move_to_delayed() {
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
        )
        .await
        .unwrap();

    // Pull to start processing
    let pulled = qm.pull("test").await;
    assert_eq!(pulled.id, job.id);

    // Move back to delayed
    let result = qm.move_to_delayed(job.id, 60000).await;
    assert!(result.is_ok());

    // Job should now be delayed
    let state = qm.get_state(job.id);
    assert_eq!(state, crate::protocol::JobState::Delayed);

    // Processing count should be 0
    let (_, processing, _, _) = qm.stats().await;
    assert_eq!(processing, 0);
}

#[tokio::test]
async fn test_move_to_delayed_not_processing() {
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
        )
        .await
        .unwrap();

    // Try to move without pulling first
    let result = qm.move_to_delayed(job.id, 60000).await;
    assert!(result.is_err());
}

// ==================== PROMOTE ====================

#[tokio::test]
async fn test_promote_delayed_job() {
    let qm = setup();

    // Push a delayed job
    let job = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            Some(60000), // delayed by 60 seconds
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
        )
        .await
        .unwrap();

    // Job should be delayed
    let state = qm.get_state(job.id);
    assert_eq!(state, crate::protocol::JobState::Delayed);

    // Promote the job
    let result = qm.promote(job.id).await;
    assert!(result.is_ok());

    // Job should now be waiting
    let state_after = qm.get_state(job.id);
    assert_eq!(state_after, crate::protocol::JobState::Waiting);
}

#[tokio::test]
async fn test_promote_not_delayed() {
    let qm = setup();

    // Push a normal job (not delayed)
    let job = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            None, // no delay
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
        )
        .await
        .unwrap();

    // Try to promote - should fail
    let result = qm.promote(job.id).await;
    assert!(result.is_err());
}

// ==================== UPDATE JOB DATA ====================

#[tokio::test]
async fn test_update_job_data_waiting() {
    let qm = setup();

    let job = qm
        .push(
            "test".to_string(),
            json!({"original": true}),
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
        )
        .await
        .unwrap();

    // Update data
    let new_data = json!({"updated": true, "version": 2});
    let result = qm.update_job_data(job.id, new_data.clone()).await;
    assert!(result.is_ok());

    // Pull and verify data was updated
    let pulled = qm.pull("test").await;
    assert_eq!(pulled.data, new_data);
}

#[tokio::test]
async fn test_update_job_data_processing() {
    let qm = setup();

    let job = qm
        .push(
            "test".to_string(),
            json!({"original": true}),
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
        )
        .await
        .unwrap();

    // Pull to start processing
    let _ = qm.pull("test").await;

    // Update data while processing
    let new_data = json!({"updated": true});
    let result = qm.update_job_data(job.id, new_data).await;
    assert!(result.is_ok());
}

// ==================== DISCARD ====================

#[tokio::test]
async fn test_discard_processing_job() {
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
        )
        .await
        .unwrap();

    // Pull to start processing
    let _ = qm.pull("test").await;

    // Discard the job
    let result = qm.discard(job.id).await;
    assert!(result.is_ok());

    // Job should be in DLQ
    let state = qm.get_state(job.id);
    assert_eq!(state, crate::protocol::JobState::Failed);

    let dlq = qm.get_dlq("test", None).await;
    assert_eq!(dlq.len(), 1);
    assert_eq!(dlq[0].id, job.id);
}

#[tokio::test]
async fn test_discard_waiting_job() {
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
        )
        .await
        .unwrap();

    // Discard without pulling
    let result = qm.discard(job.id).await;
    assert!(result.is_ok());

    // Job should be in DLQ
    let dlq = qm.get_dlq("test", None).await;
    assert_eq!(dlq.len(), 1);
    assert_eq!(dlq[0].id, job.id);
}

// ==================== PUSH FLOW ====================

#[tokio::test]
async fn test_push_flow_basic() {
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

    let result = qm
        .push_flow(
            "parent-queue".to_string(),
            json!({"parent": true}),
            children,
            0,
        )
        .await;

    assert!(result.is_ok());
    let (parent_id, children_ids) = result.unwrap();
    assert!(parent_id > 0);
    assert_eq!(children_ids.len(), 2);

    // Parent should be waiting for children
    let state = qm.get_state(parent_id);
    assert_eq!(state, crate::protocol::JobState::WaitingParent);

    // Children should be ready
    for child_id in &children_ids {
        let state = qm.get_state(*child_id);
        assert_eq!(state, crate::protocol::JobState::Waiting);
    }
}

#[tokio::test]
async fn test_push_flow_parent_ready_after_children_complete() {
    let qm = setup();

    let children = vec![crate::protocol::FlowChild {
        queue: "child-queue".to_string(),
        data: json!({"child": 1}),
        priority: 0,
        delay: None,
    }];

    let (parent_id, children_ids) = qm
        .push_flow("parent-queue".to_string(), json!({}), children, 0)
        .await
        .unwrap();

    // Pull and ack child
    let child = qm.pull("child-queue").await;
    assert_eq!(child.id, children_ids[0]);
    qm.ack(child.id, None).await.unwrap();

    // Parent should now be ready
    let state = qm.get_state(parent_id);
    assert_eq!(state, crate::protocol::JobState::Waiting);

    // Can pull parent
    let parent = qm.pull("parent-queue").await;
    assert_eq!(parent.id, parent_id);
}

#[tokio::test]
async fn test_push_flow_empty_children() {
    let qm = setup();

    let result = qm
        .push_flow("parent-queue".to_string(), json!({}), vec![], 0)
        .await;

    assert!(result.is_err());
}

// ==================== PURGE DLQ ====================

#[tokio::test]
async fn test_purge_dlq() {
    let qm = setup();

    // Create jobs and fail them
    for i in 0..5 {
        let job = qm
            .push(
                "purge-test".to_string(),
                json!({"i": i}),
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
            )
            .await
            .unwrap();
        let _ = qm.pull("purge-test").await;
        qm.fail(job.id, None).await.unwrap();
    }

    let dlq = qm.get_dlq("purge-test", None).await;
    assert_eq!(dlq.len(), 5);

    // Purge DLQ
    let purged = qm.purge_dlq("purge-test").await;
    assert_eq!(purged, 5);

    // DLQ should be empty
    let dlq_after = qm.get_dlq("purge-test", None).await;
    assert!(dlq_after.is_empty());
}

// ==================== IS PAUSED ====================

#[tokio::test]
async fn test_is_paused() {
    let qm = setup();

    // Initially not paused
    assert!(!qm.is_paused("test-queue"));

    // Pause
    qm.pause("test-queue").await;
    assert!(qm.is_paused("test-queue"));

    // Resume
    qm.resume("test-queue").await;
    assert!(!qm.is_paused("test-queue"));
}

// ==================== COUNT ====================

#[tokio::test]
async fn test_count() {
    let qm = setup();

    // Empty queue
    assert_eq!(qm.count("test"), 0);

    // Push jobs
    for i in 0..7 {
        qm.push(
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
        )
        .await
        .unwrap();
    }

    assert_eq!(qm.count("test"), 7);

    // Pull some
    qm.pull("test").await;
    qm.pull("test").await;

    // Count doesn't include processing
    assert_eq!(qm.count("test"), 5);
}

// ==================== GET JOB COUNTS ====================

#[tokio::test]
async fn test_get_job_counts() {
    let qm = setup();

    // Push 5 waiting jobs
    for i in 0..5 {
        qm.push(
            "counts-test".to_string(),
            json!({"i": i}),
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
        )
        .await
        .unwrap();
    }

    // Push 2 delayed jobs
    for i in 0..2 {
        qm.push(
            "counts-test".to_string(),
            json!({"delayed": i}),
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
    }

    // Pull 2 to processing
    qm.pull("counts-test").await;
    qm.pull("counts-test").await;

    // Fail 1 to DLQ
    let to_fail = qm.pull("counts-test").await;
    qm.fail(to_fail.id, None).await.unwrap();

    let (waiting, active, delayed, _completed, failed) = qm.get_job_counts("counts-test");

    assert_eq!(waiting, 2); // 5 - 3 pulled
    assert_eq!(active, 2); // 2 in processing
    assert_eq!(delayed, 2); // 2 delayed
    assert_eq!(failed, 1); // 1 in DLQ
}
