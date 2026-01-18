//! Authentication tests.

use super::*;

#[tokio::test]
async fn test_auth_token_verification() {
    let qm = QueueManager::with_auth_tokens(false, vec!["secret-token".to_string()]);

    assert!(qm.verify_token("secret-token"));
    assert!(!qm.verify_token("wrong-token"));
}

#[tokio::test]
async fn test_auth_empty_tokens_allows_all() {
    let qm = QueueManager::new(false);

    // With no tokens configured, any token should be accepted
    assert!(qm.verify_token("any-token"));
    assert!(qm.verify_token(""));
}

#[tokio::test]
async fn test_auth_multiple_tokens() {
    let qm = QueueManager::with_auth_tokens(
        false,
        vec![
            "token1".to_string(),
            "token2".to_string(),
            "token3".to_string(),
        ],
    );

    assert!(qm.verify_token("token1"));
    assert!(qm.verify_token("token2"));
    assert!(qm.verify_token("token3"));
    assert!(!qm.verify_token("token4"));
}
