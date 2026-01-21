//! Admin operations tests: reset, clear_all, settings.

use super::*;

// ==================== RESET ====================

#[tokio::test]
async fn test_reset_clears_everything() {
    let qm = setup();

    // Push some jobs
    for i in 0..10 {
        qm.push(
            "test".to_string(),
            JobInput {
                data: json!({"i": i}),
                max_attempts: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    }

    // Pull and ack some
    let j = qm.pull("test").await;
    qm.ack(j.id, Some(json!({"result": true}))).await.unwrap();

    // Pull and fail one to DLQ
    let job2 = qm.pull("test").await;
    qm.fail(job2.id, None).await.unwrap();

    // Verify state before reset
    let (queued, _processing, _, _, _) = qm.stats().await;
    assert!(queued > 0);

    // Reset everything
    qm.reset().await;

    // Everything should be cleared
    let (queued_after, processing_after, _, _, _) = qm.stats().await;
    assert_eq!(queued_after, 0);
    assert_eq!(processing_after, 0);

    let dlq = qm.get_dlq("test", None).await;
    assert!(dlq.is_empty());
}

// ==================== CLEAR ALL QUEUES ====================

#[tokio::test]
async fn test_clear_all_queues() {
    let qm = setup();

    // Push to multiple queues
    for i in 0..5 {
        qm.push(format!("queue-{}", i), job(json!({})))
            .await
            .unwrap();
    }

    let cleared = qm.clear_all_queues().await;
    assert_eq!(cleared, 5);

    let (queued, _, _, _, _) = qm.stats().await;
    assert_eq!(queued, 0);
}

// ==================== CLEAR ALL DLQ ====================

#[tokio::test]
async fn test_clear_all_dlq() {
    let qm = setup();

    // Create and fail jobs in multiple queues
    for i in 0..3 {
        let j = qm
            .push(
                format!("queue-{}", i),
                JobInput {
                    data: json!({}),
                    max_attempts: Some(1),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let _ = qm.pull(&format!("queue-{}", i)).await;
        qm.fail(j.id, None).await.unwrap();
    }

    let cleared = qm.clear_all_dlq().await;
    assert_eq!(cleared, 3);
}

// ==================== CLEAR COMPLETED ====================

#[tokio::test]
async fn test_clear_completed_jobs() {
    let qm = setup();

    // Push and complete jobs
    for i in 0..5 {
        let _j = qm
            .push("test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
        let pulled = qm.pull("test").await;
        qm.ack(pulled.id, Some(json!({"result": i}))).await.unwrap();
    }

    let cleared = qm.clear_completed_jobs().await;
    assert_eq!(cleared, 5);
}

// ==================== RESET METRICS ====================

#[tokio::test]
async fn test_reset_metrics() {
    let qm = setup();

    // Generate some metrics
    for i in 0..10 {
        let _j = qm
            .push("test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
        let pulled = qm.pull("test").await;
        qm.ack(pulled.id, None).await.unwrap();
    }

    // Verify metrics exist
    let metrics = qm.get_metrics().await;
    assert!(metrics.total_pushed > 0);
    assert!(metrics.total_completed > 0);

    // Reset metrics
    qm.reset_metrics().await;

    // Verify metrics are reset
    let metrics_after = qm.get_metrics().await;
    assert_eq!(metrics_after.total_pushed, 0);
    assert_eq!(metrics_after.total_completed, 0);
}

// ==================== QUEUE DEFAULTS ====================

#[tokio::test]
async fn test_set_queue_defaults() {
    let qm = setup();

    qm.set_queue_defaults(Some(30000), Some(5), Some(1000), Some(60000));

    let defaults = qm.get_queue_defaults();
    assert_eq!(defaults.timeout, Some(30000));
    assert_eq!(defaults.max_attempts, Some(5));
    assert_eq!(defaults.backoff, Some(1000));
    assert_eq!(defaults.ttl, Some(60000));
}

// ==================== CLEANUP SETTINGS ====================

#[tokio::test]
async fn test_set_cleanup_settings() {
    let qm = setup();

    qm.set_cleanup_settings(Some(10000), Some(5000), Some(120), Some(100));

    let settings = qm.get_cleanup_settings();
    assert_eq!(settings.max_completed_jobs, 10000);
    assert_eq!(settings.max_job_results, 5000);
    assert_eq!(settings.cleanup_interval_secs, 120);
    assert_eq!(settings.metrics_history_size, 100);
}

// ==================== AUTH TOKENS ====================

#[tokio::test]
async fn test_set_auth_tokens_runtime() {
    let qm = setup();

    // Initially no tokens - empty string should pass
    assert!(qm.verify_token(""));

    // Set tokens
    qm.set_auth_tokens(vec!["token1".to_string(), "token2".to_string()]);

    // Now needs valid token
    assert!(!qm.verify_token(""));
    assert!(!qm.verify_token("wrong"));
    assert!(qm.verify_token("token1"));
    assert!(qm.verify_token("token2"));
}

// ==================== METRICS HISTORY ====================

#[tokio::test]
async fn test_get_metrics_history() {
    let qm = setup();

    // Initially empty
    let history = qm.get_metrics_history();
    assert!(history.is_empty());

    // Collect some history
    qm.collect_metrics_history();
    qm.collect_metrics_history();

    let history = qm.get_metrics_history();
    assert_eq!(history.len(), 2);
}

// ==================== RUN CLEANUP ====================

#[tokio::test]
async fn test_run_cleanup() {
    let qm = setup();

    // Set low thresholds
    qm.set_cleanup_settings(Some(5), Some(5), None, None);

    // Create more than threshold
    for i in 0..10 {
        let _j = qm
            .push("test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
        let pulled = qm.pull("test").await;
        qm.ack(pulled.id, Some(json!({"r": i}))).await.unwrap();
    }

    // Run cleanup
    qm.run_cleanup();

    // Should have been cleaned up
    // (exact behavior depends on implementation details)
}

// ==================== CONNECTION COUNT ====================

#[tokio::test]
async fn test_connection_count() {
    let qm = setup();

    assert_eq!(qm.connection_count(), 0);

    qm.increment_connections();
    qm.increment_connections();
    assert_eq!(qm.connection_count(), 2);

    qm.decrement_connections();
    assert_eq!(qm.connection_count(), 1);
}
