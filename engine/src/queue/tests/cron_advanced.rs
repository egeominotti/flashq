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
