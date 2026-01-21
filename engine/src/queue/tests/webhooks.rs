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

// ==================== CIRCUIT BREAKER ====================

#[test]
fn test_circuit_breaker_opens_after_failures() {
    use crate::queue::types::{CircuitBreakerEntry, CircuitState};

    let mut circuit = CircuitBreakerEntry::default();
    assert_eq!(circuit.state, CircuitState::Closed);

    // Record 5 failures (default threshold)
    for i in 0..5 {
        circuit.record_failure(i as u64 * 1000, 5);
    }

    // Circuit should be open after 5 failures
    assert_eq!(circuit.state, CircuitState::Open);
    assert_eq!(circuit.failures, 5);
}

#[test]
fn test_circuit_breaker_blocks_when_open() {
    use crate::queue::types::{CircuitBreakerEntry, CircuitState};

    let mut circuit = CircuitBreakerEntry::default();

    // Open the circuit
    for i in 0..5 {
        circuit.record_failure(i as u64 * 1000, 5);
    }
    assert_eq!(circuit.state, CircuitState::Open);

    // Should not allow requests when open (before recovery timeout)
    let now = 10_000; // 10 seconds after last failure
    let recovery_timeout = 30_000; // 30 seconds
    assert!(
        !circuit.should_allow(now, recovery_timeout),
        "Circuit should block requests when open"
    );
}

#[test]
fn test_circuit_breaker_half_open_after_recovery_timeout() {
    use crate::queue::types::{CircuitBreakerEntry, CircuitState};

    let mut circuit = CircuitBreakerEntry::default();

    // Open the circuit at time 0
    for _ in 0..5 {
        circuit.record_failure(0, 5);
    }
    assert_eq!(circuit.state, CircuitState::Open);

    // After recovery timeout, should transition to half-open
    let recovery_timeout = 30_000;
    let now = 35_000; // 35 seconds later

    // try_half_open should succeed
    let transitioned = circuit.try_half_open(now, recovery_timeout);
    assert!(transitioned, "Should transition to half-open");
    assert_eq!(circuit.state, CircuitState::HalfOpen);

    // Should allow requests in half-open state
    assert!(
        circuit.should_allow(now, recovery_timeout),
        "Should allow requests in half-open"
    );
}

#[test]
fn test_circuit_breaker_closes_after_successes_in_half_open() {
    use crate::queue::types::{CircuitBreakerEntry, CircuitState};

    let mut circuit = CircuitBreakerEntry::default();

    // Open and transition to half-open
    for _ in 0..5 {
        circuit.record_failure(0, 5);
    }
    circuit.try_half_open(35_000, 30_000);
    assert_eq!(circuit.state, CircuitState::HalfOpen);

    // Record 2 successes (required to close)
    circuit.record_success();
    assert_eq!(
        circuit.state,
        CircuitState::HalfOpen,
        "Still half-open after 1 success"
    );

    circuit.record_success();
    assert_eq!(
        circuit.state,
        CircuitState::Closed,
        "Should be closed after 2 successes"
    );
    assert_eq!(circuit.failures, 0, "Failures should be reset");
}

#[test]
fn test_circuit_breaker_reopens_on_failure_in_half_open() {
    use crate::queue::types::{CircuitBreakerEntry, CircuitState};

    let mut circuit = CircuitBreakerEntry::default();

    // Open and transition to half-open
    for _ in 0..5 {
        circuit.record_failure(0, 5);
    }
    circuit.try_half_open(35_000, 30_000);
    assert_eq!(circuit.state, CircuitState::HalfOpen);

    // A single failure in half-open should reopen
    circuit.record_failure(40_000, 5);
    assert_eq!(
        circuit.state,
        CircuitState::Open,
        "Should reopen after failure in half-open"
    );
}

#[test]
fn test_circuit_breaker_success_resets_failures() {
    use crate::queue::types::{CircuitBreakerEntry, CircuitState};

    let mut circuit = CircuitBreakerEntry::default();

    // Record some failures (but less than threshold)
    circuit.record_failure(0, 5);
    circuit.record_failure(1000, 5);
    circuit.record_failure(2000, 5);
    assert_eq!(circuit.failures, 3);
    assert_eq!(circuit.state, CircuitState::Closed);

    // A success should reset failures
    circuit.record_success();
    assert_eq!(circuit.failures, 0, "Failures should be reset on success");
    assert_eq!(circuit.state, CircuitState::Closed);
}
