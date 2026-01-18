//! Job tags tests.

use super::*;

#[tokio::test]
async fn test_push_with_tags() {
    let qm = setup();

    let job = qm
        .push(
            "test".to_string(),
            json!({"data": "with tags"}),
            0,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(vec!["urgent".to_string(), "backend".to_string()]),
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None,  // group_id
        )
        .await
        .unwrap();

    assert_eq!(job.tags, vec!["urgent", "backend"]);
}

#[tokio::test]
async fn test_push_with_empty_tags() {
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
            Some(vec![]),
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None,  // group_id
        )
        .await
        .unwrap();

    assert!(job.tags.is_empty());
}

#[tokio::test]
async fn test_tags_preserved_after_pull() {
    let qm = setup();

    let original = qm
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
            Some(vec!["tag1".to_string(), "tag2".to_string()]),
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None,  // group_id
        )
        .await
        .unwrap();

    let pulled = qm.pull("test").await;
    assert_eq!(pulled.id, original.id);
    assert_eq!(pulled.tags, vec!["tag1", "tag2"]);
}

#[tokio::test]
async fn test_get_job_includes_tags() {
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
            Some(vec!["important".to_string()]),
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None,  // group_id
        )
        .await
        .unwrap();

    let (fetched, _) = qm.get_job(job.id);
    assert_eq!(fetched.unwrap().tags, vec!["important"]);
}

#[tokio::test]
async fn test_job_state_with_tags() {
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
            Some(vec!["tag1".to_string(), "tag2".to_string()]),
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None,  // group_id
        )
        .await
        .unwrap();

    // Check state while waiting
    let state = qm.get_state(job.id);
    assert_eq!(state, crate::protocol::JobState::Waiting);

    // Pull and check state while active
    let _pulled = qm.pull("test").await;
    let state = qm.get_state(job.id);
    assert_eq!(state, crate::protocol::JobState::Active);
}
