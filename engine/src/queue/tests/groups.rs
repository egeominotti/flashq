//! Group support tests: FIFO processing within groups.
//!
//! Jobs with the same group_id are processed sequentially (one at a time),
//! while different groups can be processed in parallel.

use super::*;

#[tokio::test]
async fn test_push_with_group_id() {
    let qm = setup();

    let j = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({"task": "group-task"}),
                group_id: Some("group-A".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert!(j.id > 0);
    assert_eq!(j.group_id, Some("group-A".to_string()));
}

#[tokio::test]
async fn test_single_job_per_group_in_batch() {
    let qm = setup();

    // Push 3 jobs in the same group
    let job1 = qm
        .push(
            "orders".to_string(),
            JobInput {
                data: json!({"order": 1}),
                group_id: Some("customer-123".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let _job2 = qm
        .push(
            "orders".to_string(),
            JobInput {
                data: json!({"order": 2}),
                group_id: Some("customer-123".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let _job3 = qm
        .push(
            "orders".to_string(),
            JobInput {
                data: json!({"order": 3}),
                group_id: Some("customer-123".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Even though we request 10 jobs, should only get 1 (group constraint)
    let pulled = qm.pull_batch_nowait("orders", 10).await;
    assert_eq!(
        pulled.len(),
        1,
        "Should pull exactly one job from same group"
    );
    assert_eq!(pulled[0].id, job1.id, "Should get first job");
}

#[tokio::test]
async fn test_different_groups_in_single_batch() {
    let qm = setup();

    // Push jobs in different groups
    let job_a = qm
        .push(
            "orders".to_string(),
            JobInput {
                data: json!({"order": "A1"}),
                group_id: Some("group-A".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let job_b = qm
        .push(
            "orders".to_string(),
            JobInput {
                data: json!({"order": "B1"}),
                group_id: Some("group-B".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Should get both jobs since they're in different groups
    let pulled = qm.pull_batch_nowait("orders", 10).await;
    assert_eq!(
        pulled.len(),
        2,
        "Should pull both jobs from different groups"
    );
    assert!(pulled.iter().any(|j| j.id == job_a.id));
    assert!(pulled.iter().any(|j| j.id == job_b.id));
}

#[tokio::test]
async fn test_group_released_after_ack() {
    let qm = setup();

    // Push 2 jobs in same group
    let job1 = qm
        .push(
            "tasks".to_string(),
            JobInput {
                data: json!({"task": 1}),
                group_id: Some("group-X".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let job2 = qm
        .push(
            "tasks".to_string(),
            JobInput {
                data: json!({"task": 2}),
                group_id: Some("group-X".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Pull first job
    let pulled1 = qm.pull_batch_nowait("tasks", 10).await;
    assert_eq!(pulled1.len(), 1);
    assert_eq!(pulled1[0].id, job1.id);

    // Ack first job - this releases the group
    qm.ack(job1.id, None).await.unwrap();

    // Now second job should be available
    let pulled2 = qm.pull_batch_nowait("tasks", 10).await;
    assert_eq!(pulled2.len(), 1);
    assert_eq!(pulled2[0].id, job2.id);
}

#[tokio::test]
async fn test_group_released_after_fail() {
    let qm = setup();

    // Push 2 jobs in same group (with max_attempts=1 so fail goes to DLQ)
    let job1 = qm
        .push(
            "tasks-fail".to_string(), // Use unique queue name for isolation
            JobInput {
                data: json!({"task": 1}),
                max_attempts: Some(1), // max_attempts=1 - goes to DLQ on first fail
                group_id: Some("group-Y".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let _job2 = qm
        .push(
            "tasks-fail".to_string(),
            JobInput {
                data: json!({"task": 2}),
                max_attempts: Some(1),
                group_id: Some("group-Y".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Pull first job
    let pulled1 = qm.pull_batch_nowait("tasks-fail", 10).await;
    assert_eq!(pulled1.len(), 1);
    assert_eq!(pulled1[0].id, job1.id);

    // Fail first job - this releases the group
    qm.fail(job1.id, Some("test error".to_string()))
        .await
        .unwrap();

    // Now second job should be available (group is released after fail)
    let pulled2 = qm.pull_batch_nowait("tasks-fail", 10).await;
    assert_eq!(
        pulled2.len(),
        1,
        "Should pull second job after first one fails"
    );
    // Check the job data to confirm it's the second job
    let data = pulled2[0].data.as_object().unwrap();
    assert_eq!(data.get("task").unwrap(), 2, "Should be task 2");
}

#[tokio::test]
async fn test_ungrouped_jobs_freely_available() {
    let qm = setup();

    // Push jobs without group_id
    let job1 = qm
        .push("work".to_string(), job(json!({"n": 1})))
        .await
        .unwrap();

    let job2 = qm
        .push("work".to_string(), job(json!({"n": 2})))
        .await
        .unwrap();

    // Both should be pullable (no group restriction)
    let pulled = qm.pull_batch_nowait("work", 10).await;
    assert_eq!(pulled.len(), 2, "Should pull both ungrouped jobs");
    assert!(pulled.iter().any(|j| j.id == job1.id));
    assert!(pulled.iter().any(|j| j.id == job2.id));
}

#[tokio::test]
async fn test_mixed_grouped_and_ungrouped() {
    let qm = setup();

    // Push grouped job
    let grouped = qm
        .push(
            "mixed".to_string(),
            JobInput {
                data: json!({"type": "grouped"}),
                group_id: Some("my-group".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Push ungrouped job
    let ungrouped = qm
        .push("mixed".to_string(), job(json!({"type": "ungrouped"})))
        .await
        .unwrap();

    // Both should be available (one grouped, one ungrouped)
    let pulled = qm.pull_batch_nowait("mixed", 10).await;
    assert_eq!(
        pulled.len(),
        2,
        "Should pull both grouped and ungrouped jobs"
    );
    assert!(pulled.iter().any(|j| j.id == grouped.id));
    assert!(pulled.iter().any(|j| j.id == ungrouped.id));
}

#[tokio::test]
async fn test_group_with_priority() {
    let qm = setup();

    // Push low priority job first (same group)
    let _low = qm
        .push(
            "priority-test".to_string(),
            JobInput {
                data: json!({"priority": "low"}),
                priority: 1, // low priority
                group_id: Some("prio-group".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Push high priority job (same group)
    let high = qm
        .push(
            "priority-test".to_string(),
            JobInput {
                data: json!({"priority": "high"}),
                priority: 10, // high priority
                group_id: Some("prio-group".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // High priority job should be pulled first (only one from group)
    let pulled = qm.pull_batch_nowait("priority-test", 10).await;
    assert_eq!(pulled.len(), 1, "Should pull exactly one job from group");
    assert_eq!(pulled[0].id, high.id, "Higher priority should be first");
}
