//! Advanced cron tests: add_cron_with_repeat.

use super::*;

#[tokio::test]
async fn test_cron_with_repeat_interval() {
    let qm = setup();

    // Add cron with repeat interval instead of cron expression
    let result = qm
        .add_cron_with_repeat(
            "repeat-job".to_string(),
            "test".to_string(),
            json!({"repeat": true}),
            None,        // no cron schedule
            Some(60000), // repeat every 60 seconds
            5,           // priority
            Some(100),   // limit to 100 runs
        )
        .await;

    assert!(result.is_ok());

    let crons = qm.list_crons().await;
    let cron = crons.iter().find(|c| c.name == "repeat-job");
    assert!(cron.is_some());

    let cron = cron.unwrap();
    assert_eq!(cron.repeat_every, Some(60000));
    assert_eq!(cron.limit, Some(100));
    assert_eq!(cron.priority, 5);

    qm.delete_cron("repeat-job").await;
}

#[tokio::test]
async fn test_cron_with_both_schedule_and_repeat() {
    let qm = setup();

    // Can have both cron schedule and repeat interval
    let result = qm
        .add_cron_with_repeat(
            "hybrid-job".to_string(),
            "test".to_string(),
            json!({}),
            Some("0 * * * * *".to_string()), // every minute
            Some(30000),                     // also repeat every 30s
            0,
            None,
        )
        .await;

    assert!(result.is_ok());

    let crons = qm.list_crons().await;
    let cron = crons.iter().find(|c| c.name == "hybrid-job");
    assert!(cron.is_some());

    let cron = cron.unwrap();
    assert_eq!(cron.schedule, Some("0 * * * * *".to_string()));
    assert_eq!(cron.repeat_every, Some(30000));

    qm.delete_cron("hybrid-job").await;
}

#[tokio::test]
async fn test_cron_without_repeat_or_schedule_fails() {
    let qm = setup();

    // Must have at least one: schedule or repeat_every
    let result = qm
        .add_cron_with_repeat(
            "invalid-job".to_string(),
            "test".to_string(),
            json!({}),
            None, // no schedule
            None, // no repeat
            0,
            None,
        )
        .await;

    assert!(result.is_err());
}

#[tokio::test]
async fn test_cron_list_multiple() {
    let qm = setup();

    // Add multiple cron jobs
    qm.add_cron(
        "cron-1".to_string(),
        "queue-a".to_string(),
        json!({}),
        "*/30".to_string(),
        0,
    )
    .await
    .unwrap();

    qm.add_cron(
        "cron-2".to_string(),
        "queue-b".to_string(),
        json!({}),
        "*/60".to_string(),
        10,
    )
    .await
    .unwrap();

    qm.add_cron_with_repeat(
        "repeat-1".to_string(),
        "queue-c".to_string(),
        json!({}),
        None,
        Some(5000),
        5,
        None,
    )
    .await
    .unwrap();

    let crons = qm.list_crons().await;
    assert_eq!(crons.len(), 3);

    // Cleanup
    qm.delete_cron("cron-1").await;
    qm.delete_cron("cron-2").await;
    qm.delete_cron("repeat-1").await;
}

#[tokio::test]
async fn test_cron_duplicate_name_replaces() {
    let qm = setup();

    // Add cron
    qm.add_cron(
        "same-name".to_string(),
        "queue-a".to_string(),
        json!({"version": 1}),
        "*/30".to_string(),
        0,
    )
    .await
    .unwrap();

    // Add another with same name - should replace
    qm.add_cron(
        "same-name".to_string(),
        "queue-b".to_string(), // different queue
        json!({"version": 2}),
        "*/60".to_string(),
        10,
    )
    .await
    .unwrap();

    let crons = qm.list_crons().await;
    // Should only have one
    let matching: Vec<_> = crons.iter().filter(|c| c.name == "same-name").collect();
    assert_eq!(matching.len(), 1);
    assert_eq!(matching[0].queue, "queue-b"); // Updated to new queue

    qm.delete_cron("same-name").await;
}

// ==================== CRON EXECUTION ====================

#[tokio::test]
async fn test_cron_job_execution_creates_job() {
    let qm = setup();

    // Add cron with very short repeat interval (1ms) - will be due immediately
    qm.add_cron_with_repeat(
        "fast-cron".to_string(),
        "cron-queue".to_string(),
        json!({"from_cron": true}),
        None,
        Some(1), // 1ms repeat - will be due immediately
        5,       // priority
        None,
    )
    .await
    .unwrap();

    // Wait a tiny bit to ensure cron is due
    tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;

    // Run cron jobs manually
    qm.run_cron_jobs().await;

    // A job should have been created in the queue
    let (queued, _, _, _, _) = qm.stats().await;
    assert!(queued >= 1, "Cron should have created at least 1 job");

    // Pull the job and verify it's from cron
    let pulled = qm.pull("cron-queue").await;
    assert_eq!(pulled.priority, 5, "Job should have cron priority");
    assert_eq!(
        *pulled.data,
        json!({"from_cron": true}),
        "Job data should match cron data"
    );

    // Cleanup
    qm.delete_cron("fast-cron").await;
}

#[tokio::test]
async fn test_cron_job_respects_execution_limit() {
    let qm = setup();

    // Add cron with limit of 2 executions
    qm.add_cron_with_repeat(
        "limited-cron".to_string(),
        "limited-queue".to_string(),
        json!({}),
        None,
        Some(1), // 1ms repeat
        0,
        Some(2), // Only 2 executions
    )
    .await
    .unwrap();

    // Run cron multiple times
    for _ in 0..5 {
        tokio::time::sleep(tokio::time::Duration::from_millis(2)).await;
        qm.run_cron_jobs().await;
    }

    // Should have created exactly 2 jobs (limited)
    let (queued, _, _, _, _) = qm.stats().await;
    assert_eq!(queued, 2, "Should have created exactly 2 jobs due to limit");

    // Cron should be removed after reaching limit
    let crons = qm.list_crons().await;
    let still_exists = crons.iter().any(|c| c.name == "limited-cron");
    assert!(!still_exists, "Cron should be removed after reaching limit");
}
