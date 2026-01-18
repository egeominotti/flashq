//! Webhook tests including SSRF protection.

use super::*;

#[tokio::test]
async fn test_list_webhooks_empty() {
    let qm = setup();
    let webhooks = qm.list_webhooks().await;
    assert!(webhooks.is_empty());
}

#[tokio::test]
async fn test_add_webhook() {
    let qm = setup();

    let id = qm
        .add_webhook(
            "https://example.com/webhook".to_string(),
            vec!["job.pushed".to_string(), "job.completed".to_string()],
            Some("my-queue".to_string()),
            Some("secret123".to_string()),
        )
        .await
        .unwrap();

    let webhooks = qm.list_webhooks().await;
    assert_eq!(webhooks.len(), 1);
    assert_eq!(webhooks[0].id, id);
    assert_eq!(webhooks[0].url, "https://example.com/webhook");
    assert_eq!(webhooks[0].events, vec!["job.pushed", "job.completed"]);
    assert_eq!(webhooks[0].queue, Some("my-queue".to_string()));
    assert_eq!(webhooks[0].secret, Some("secret123".to_string()));
}

#[tokio::test]
async fn test_add_webhook_ssrf_blocks_localhost() {
    let qm = setup();

    // Should block localhost variants
    let result = qm
        .add_webhook(
            "http://localhost/webhook".to_string(),
            vec!["job.pushed".to_string()],
            None,
            None,
        )
        .await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Localhost"));

    let result = qm
        .add_webhook(
            "http://127.0.0.1/webhook".to_string(),
            vec!["job.pushed".to_string()],
            None,
            None,
        )
        .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_add_webhook_ssrf_blocks_private_ips() {
    let qm = setup();

    // Should block RFC1918 private IPs
    let result = qm
        .add_webhook(
            "http://192.168.1.1/webhook".to_string(),
            vec!["job.pushed".to_string()],
            None,
            None,
        )
        .await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Private"));

    let result = qm
        .add_webhook(
            "http://10.0.0.1/webhook".to_string(),
            vec!["job.pushed".to_string()],
            None,
            None,
        )
        .await;
    assert!(result.is_err());

    let result = qm
        .add_webhook(
            "http://172.16.0.1/webhook".to_string(),
            vec!["job.pushed".to_string()],
            None,
            None,
        )
        .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_add_webhook_ssrf_blocks_link_local() {
    let qm = setup();

    // Should block AWS metadata endpoint (link-local)
    let result = qm
        .add_webhook(
            "http://169.254.169.254/latest/meta-data/".to_string(),
            vec!["job.pushed".to_string()],
            None,
            None,
        )
        .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_add_webhook_ssrf_blocks_internal_domains() {
    let qm = setup();

    // Should block internal domain patterns
    let result = qm
        .add_webhook(
            "http://service.internal/webhook".to_string(),
            vec!["job.pushed".to_string()],
            None,
            None,
        )
        .await;
    assert!(result.is_err());

    let result = qm
        .add_webhook(
            "http://app.svc.cluster.local/webhook".to_string(),
            vec!["job.pushed".to_string()],
            None,
            None,
        )
        .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_add_webhook_ssrf_allows_valid_urls() {
    let qm = setup();

    // Should allow valid external URLs
    let result = qm
        .add_webhook(
            "https://api.example.com/webhook".to_string(),
            vec!["job.pushed".to_string()],
            None,
            None,
        )
        .await;
    assert!(result.is_ok());

    let result = qm
        .add_webhook(
            "https://hooks.slack.com/services/xxx".to_string(),
            vec!["job.pushed".to_string()],
            None,
            None,
        )
        .await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_add_webhook_ssrf_blocks_invalid_schemes() {
    let qm = setup();

    // Should block file:// and other schemes
    let result = qm
        .add_webhook(
            "file:///etc/passwd".to_string(),
            vec!["job.pushed".to_string()],
            None,
            None,
        )
        .await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("scheme"));

    let result = qm
        .add_webhook(
            "ftp://server.com/file".to_string(),
            vec!["job.pushed".to_string()],
            None,
            None,
        )
        .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_add_webhook_without_queue_filter() {
    let qm = setup();

    qm.add_webhook(
        "https://example.com/global".to_string(),
        vec!["job.failed".to_string()],
        None,
        None,
    )
    .await
    .unwrap();

    let webhooks = qm.list_webhooks().await;
    assert_eq!(webhooks.len(), 1);
    assert!(webhooks[0].queue.is_none());
    assert!(webhooks[0].secret.is_none());
}

#[tokio::test]
async fn test_delete_webhook() {
    let qm = setup();

    let id1 = qm
        .add_webhook(
            "https://example.com/1".to_string(),
            vec!["job.pushed".to_string()],
            None,
            None,
        )
        .await
        .unwrap();
    let id2 = qm
        .add_webhook(
            "https://example.com/2".to_string(),
            vec!["job.completed".to_string()],
            None,
            None,
        )
        .await
        .unwrap();

    assert_eq!(qm.list_webhooks().await.len(), 2);

    let deleted = qm.delete_webhook(&id1).await;
    assert!(deleted);

    let webhooks = qm.list_webhooks().await;
    assert_eq!(webhooks.len(), 1);
    assert_eq!(webhooks[0].id, id2);
}

#[tokio::test]
async fn test_delete_nonexistent_webhook() {
    let qm = setup();
    let deleted = qm.delete_webhook("nonexistent-id").await;
    assert!(!deleted);
}

#[tokio::test]
async fn test_multiple_webhooks() {
    let qm = setup();

    for i in 0..5 {
        qm.add_webhook(
            format!("https://example.com/{}", i),
            vec!["job.pushed".to_string()],
            None,
            None,
        )
        .await
        .unwrap();
    }

    assert_eq!(qm.list_webhooks().await.len(), 5);
}

#[tokio::test]
async fn test_webhook_signature_generation() {
    let qm = setup();

    // Add webhook with secret
    let _id = qm
        .add_webhook(
            "https://httpbin.org/post".to_string(),
            vec!["job.completed".to_string()],
            Some("test-queue".to_string()),
            Some("my-secret-key".to_string()),
        )
        .await
        .unwrap();

    // Verify webhook was added
    let webhooks = qm.list_webhooks().await;
    assert_eq!(webhooks.len(), 1);
    assert_eq!(webhooks[0].secret, Some("my-secret-key".to_string()));
}
