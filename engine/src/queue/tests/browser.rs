//! Job browser tests: list_jobs, get_jobs, get_jobs_batch.

use super::*;

#[tokio::test]
async fn test_list_jobs_empty() {
    let qm = setup();
    let jobs = qm.list_jobs(None, None, 100, 0);
    assert!(jobs.is_empty());
}

#[tokio::test]
async fn test_list_jobs_all() {
    let qm = setup();

    // Push jobs to different queues
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
            None, // group_id
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
            None, // group_id
        )
        .await
        .unwrap();
    }

    let jobs = qm.list_jobs(None, None, 100, 0);
    assert_eq!(jobs.len(), 8);
}

#[tokio::test]
async fn test_list_jobs_filter_by_queue() {
    let qm = setup();

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
            None, // group_id
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
            None, // group_id
        )
        .await
        .unwrap();
    }

    let jobs = qm.list_jobs(Some("queue-a"), None, 100, 0);
    assert_eq!(jobs.len(), 5);

    let jobs_b = qm.list_jobs(Some("queue-b"), None, 100, 0);
    assert_eq!(jobs_b.len(), 3);
}

#[tokio::test]
async fn test_list_jobs_filter_by_state() {
    let qm = setup();

    // Push waiting jobs
    for i in 0..3 {
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
            None, // group_id
        )
        .await
        .unwrap();
    }

    // Push delayed jobs
    for i in 0..2 {
        qm.push(
            "test".to_string(),
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
            None, // group_id
        )
        .await
        .unwrap();
    }

    // Filter by waiting
    let waiting = qm.list_jobs(None, Some(crate::protocol::JobState::Waiting), 100, 0);
    assert_eq!(waiting.len(), 3);

    // Filter by delayed
    let delayed = qm.list_jobs(None, Some(crate::protocol::JobState::Delayed), 100, 0);
    assert_eq!(delayed.len(), 2);
}

#[tokio::test]
async fn test_list_jobs_pagination() {
    let qm = setup();

    for i in 0..10 {
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
            None, // group_id
        )
        .await
        .unwrap();
    }

    // Get first page
    let page1 = qm.list_jobs(None, None, 3, 0);
    assert_eq!(page1.len(), 3);

    // Get second page
    let page2 = qm.list_jobs(None, None, 3, 3);
    assert_eq!(page2.len(), 3);

    // Get last page
    let page3 = qm.list_jobs(None, None, 3, 6);
    assert_eq!(page3.len(), 3);

    // Get remaining
    let page4 = qm.list_jobs(None, None, 3, 9);
    assert_eq!(page4.len(), 1);
}

#[tokio::test]
async fn test_get_jobs_with_filtering() {
    let qm = setup();

    for i in 0..5 {
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
            None, // group_id
        )
        .await
        .unwrap();
    }

    let (jobs, total) = qm.get_jobs(Some("test"), None, 10, 0);
    assert_eq!(jobs.len(), 5);
    assert_eq!(total, 5);
}

#[tokio::test]
async fn test_get_jobs_batch() {
    let qm = setup();

    let mut ids = vec![];
    for i in 0..5 {
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
                None, // group_id
            )
            .await
            .unwrap();
        ids.push(job.id);
    }

    let batch = qm.get_jobs_batch(&ids).await;
    assert_eq!(batch.len(), 5);
}

#[tokio::test]
async fn test_get_jobs_batch_with_missing() {
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

    // Include some non-existent IDs
    let ids = vec![job.id, 999999, 888888];
    let batch = qm.get_jobs_batch(&ids).await;
    assert_eq!(batch.len(), 1); // Only the real job
}
