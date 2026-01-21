//! Job tags tests.

use super::*;

#[tokio::test]
async fn test_push_with_tags() {
    let qm = setup();

    let j = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({"data": "with tags"}),
                tags: Some(vec!["urgent".to_string(), "backend".to_string()]),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(j.tags, vec!["urgent", "backend"]);
}

#[tokio::test]
async fn test_push_with_empty_tags() {
    let qm = setup();

    let j = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({}),
                tags: Some(vec![]),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert!(j.tags.is_empty());
}

#[tokio::test]
async fn test_tags_preserved_after_pull() {
    let qm = setup();

    let original = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({}),
                tags: Some(vec!["tag1".to_string(), "tag2".to_string()]),
                ..Default::default()
            },
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

    let j = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({}),
                tags: Some(vec!["important".to_string()]),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let (fetched, _) = qm.get_job(j.id);
    assert_eq!(fetched.unwrap().tags, vec!["important"]);
}

#[tokio::test]
async fn test_job_state_with_tags() {
    let qm = setup();

    let j = qm
        .push(
            "test".to_string(),
            JobInput {
                data: json!({}),
                tags: Some(vec!["tag1".to_string(), "tag2".to_string()]),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Check state while waiting
    let state = qm.get_state(j.id);
    assert_eq!(state, crate::protocol::JobState::Waiting);

    // Pull and check state while active
    let _pulled = qm.pull("test").await;
    let state = qm.get_state(j.id);
    assert_eq!(state, crate::protocol::JobState::Active);
}
