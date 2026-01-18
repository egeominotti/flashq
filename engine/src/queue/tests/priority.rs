//! Priority, FIFO/LIFO, delayed jobs, and dependency tests.

use super::*;

// ==================== PRIORITY ====================

#[tokio::test]
async fn test_priority_ordering() {
    let qm = setup();

    // Push jobs with different priorities
    qm.push(
        "test".to_string(),
        json!({"p": 1}),
        1,
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
    qm.push(
        "test".to_string(),
        json!({"p": 3}),
        3,
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
    qm.push(
        "test".to_string(),
        json!({"p": 2}),
        2,
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

    // Should get highest priority first
    let j1 = qm.pull("test").await;
    assert_eq!(j1.priority, 3);

    let j2 = qm.pull("test").await;
    assert_eq!(j2.priority, 2);

    let j3 = qm.pull("test").await;
    assert_eq!(j3.priority, 1);
}

#[tokio::test]
async fn test_priority_negative() {
    let qm = setup();

    qm.push(
        "test".to_string(),
        json!({}),
        -10,
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
    qm.push(
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
    qm.push(
        "test".to_string(),
        json!({}),
        10,
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

    let j1 = qm.pull("test").await;
    assert_eq!(j1.priority, 10);

    let j2 = qm.pull("test").await;
    assert_eq!(j2.priority, 0);

    let j3 = qm.pull("test").await;
    assert_eq!(j3.priority, -10);
}

#[tokio::test]
async fn test_fifo_same_priority() {
    let qm = setup();

    // Jobs with same priority should be FIFO (by created_at)
    let job1 = qm
        .push(
            "test".to_string(),
            json!({"order": 1}),
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
    let job2 = qm
        .push(
            "test".to_string(),
            json!({"order": 2}),
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
    let job3 = qm
        .push(
            "test".to_string(),
            json!({"order": 3}),
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

    let p1 = qm.pull("test").await;
    let p2 = qm.pull("test").await;
    let p3 = qm.pull("test").await;

    assert_eq!(p1.id, job1.id);
    assert_eq!(p2.id, job2.id);
    assert_eq!(p3.id, job3.id);
}

#[tokio::test]
async fn test_lifo_ordering() {
    let qm = setup();

    // Jobs with LIFO flag should be pulled in reverse order (last in, first out)
    let job1 = qm
        .push(
            "test".to_string(),
            json!({"order": 1}),
            0,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            true, // lifo = true
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
            "test".to_string(),
            json!({"order": 2}),
            0,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            true, // lifo = true
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
    let job3 = qm
        .push(
            "test".to_string(),
            json!({"order": 3}),
            0,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            true, // lifo = true
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

    // LIFO: last pushed should be pulled first
    let p1 = qm.pull("test").await;
    let p2 = qm.pull("test").await;
    let p3 = qm.pull("test").await;

    assert_eq!(p1.id, job3.id, "LIFO: job3 should be pulled first");
    assert_eq!(p2.id, job2.id, "LIFO: job2 should be pulled second");
    assert_eq!(p3.id, job1.id, "LIFO: job1 should be pulled last");
}

#[tokio::test]
async fn test_lifo_mixed_with_fifo() {
    let qm = setup();

    // Mix of LIFO and FIFO jobs - LIFO jobs get higher effective priority
    let fifo_job = qm
        .push(
            "test".to_string(),
            json!({"type": "fifo"}),
            0,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            false, // fifo
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
    let lifo_job = qm
        .push(
            "test".to_string(),
            json!({"type": "lifo"}),
            0,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            true, // lifo - should be pulled before fifo
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

    // LIFO job should be pulled first (pushed after but LIFO)
    let p1 = qm.pull("test").await;
    let p2 = qm.pull("test").await;

    assert_eq!(p1.id, lifo_job.id, "LIFO job should be pulled first");
    assert_eq!(p2.id, fifo_job.id, "FIFO job should be pulled second");
}

// ==================== DELAYED JOBS ====================

#[tokio::test]
async fn test_delayed_job() {
    let qm = setup();

    // Job delayed by 100ms
    let job = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            Some(100),
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

    assert!(job.run_at > job.created_at);
}

#[tokio::test]
async fn test_delayed_job_ordering() {
    let qm = setup();

    // Job 1: delayed 200ms
    let _job1 = qm
        .push(
            "test".to_string(),
            json!({"order": 1}),
            0,
            Some(200),
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

    // Job 2: immediate
    let job2 = qm
        .push(
            "test".to_string(),
            json!({"order": 2}),
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

    // Immediate job should be pulled first
    let pulled = qm.pull("test").await;
    assert_eq!(pulled.id, job2.id);
}

// ==================== JOB DEPENDENCIES ====================

#[tokio::test]
async fn test_job_dependencies_single() {
    let qm = setup();

    // Create parent job
    let parent = qm
        .push(
            "test".to_string(),
            json!({"parent": true}),
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

    // Create child job that depends on parent
    let child = qm
        .push(
            "test".to_string(),
            json!({"child": true}),
            0,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(vec![parent.id]),
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

    // Child should not be pullable yet
    let pulled_parent = qm.pull("test").await;
    assert_eq!(pulled_parent.id, parent.id);

    // Complete parent
    qm.ack(parent.id, None).await.unwrap();

    // Now trigger dependency check (normally done by background task)
    qm.check_dependencies().await;

    // Now child should be pullable
    let pulled_child = qm.pull("test").await;
    assert_eq!(pulled_child.id, child.id);
}

#[tokio::test]
async fn test_job_dependencies_multiple() {
    let qm = setup();

    // Create two parent jobs
    let parent1 = qm
        .push(
            "test".to_string(),
            json!({"p": 1}),
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
    let parent2 = qm
        .push(
            "test".to_string(),
            json!({"p": 2}),
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

    // Create child that depends on both
    let _child = qm
        .push(
            "test".to_string(),
            json!({"child": true}),
            0,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(vec![parent1.id, parent2.id]),
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

    // Pull and ack first parent
    let p1 = qm.pull("test").await;
    qm.ack(p1.id, None).await.unwrap();

    qm.check_dependencies().await;

    // Child still waiting (parent2 not done)
    let p2 = qm.pull("test").await;
    assert_eq!(p2.id, parent2.id);

    qm.ack(p2.id, None).await.unwrap();
    qm.check_dependencies().await;

    // Now child should be available
    let (queued, _, _, _) = qm.stats().await;
    assert_eq!(queued, 1); // child is now queued
}
