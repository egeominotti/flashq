//! Cron/repeatable job tests.

use super::*;

#[tokio::test]
async fn test_cron() {
    let qm = setup();

    qm.add_cron(
        "test-cron".to_string(),
        "test".to_string(),
        json!({"cron": true}),
        "*/60".to_string(),
        0,
    )
    .await
    .unwrap();

    let crons = qm.list_crons().await;
    assert_eq!(crons.len(), 1);
    assert_eq!(crons[0].name, "test-cron");
    assert_eq!(crons[0].queue, "test");

    let deleted = qm.delete_cron("test-cron").await;
    assert!(deleted);

    let crons_after = qm.list_crons().await;
    assert!(crons_after.is_empty());
}

#[tokio::test]
async fn test_cron_delete_nonexistent() {
    let qm = setup();
    let deleted = qm.delete_cron("nonexistent").await;
    assert!(!deleted);
}

#[tokio::test]
async fn test_cron_with_priority() {
    let qm = setup();

    qm.add_cron(
        "high-priority-cron".to_string(),
        "test".to_string(),
        json!({}),
        "*/30".to_string(),
        100, // high priority
    )
    .await
    .unwrap();

    let crons = qm.list_crons().await;
    assert_eq!(crons[0].priority, 100);

    qm.delete_cron("high-priority-cron").await;
}

#[tokio::test]
async fn test_cron_invalid_schedule() {
    let qm = setup();

    let result = qm
        .add_cron(
            "invalid-cron".to_string(),
            "test".to_string(),
            json!({}),
            "not a valid cron".to_string(),
            0,
        )
        .await;

    assert!(result.is_err());
}

#[tokio::test]
async fn test_cron_job_scheduling() {
    let qm = setup();

    // Add a cron job - we won't test actual scheduling, just that it's stored correctly
    let _ = qm
        .add_cron(
            "test-cron-scheduling".to_string(),
            "cron-queue".to_string(),
            json!({"scheduled": true}),
            "0 * * * * *".to_string(), // Every minute at :00
            5,
        )
        .await;

    let crons = qm.list_crons().await;
    let cron = crons.iter().find(|c| c.name == "test-cron-scheduling");
    assert!(cron.is_some());
    assert_eq!(cron.unwrap().schedule, Some("0 * * * * *".to_string()));

    qm.delete_cron("test-cron-scheduling").await;
}
