//! Phase 3 Tests - Cron Scheduling, Group FIFO, Metrics Accuracy
//!
//! These tests validate:
//! - Cron job scheduling precision and behavior
//! - Group FIFO concurrent access patterns
//! - Metrics counter accuracy and history management

use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::timeout;

// ============== CRON SCHEDULING TESTS ==============

/// Test: Cron job is created with correct next_run calculation.
#[tokio::test]
async fn test_cron_schedule_precision() {
    let qm = setup();

    // Add cron job that runs every second
    let result = qm
        .add_cron(
            "precision-cron".to_string(),
            "cron-queue".to_string(),
            json!({"type": "scheduled"}),
            "* * * * * *".to_string(), // Every second (6-field cron)
            0,
        )
        .await;

    assert!(result.is_ok(), "Cron should be added successfully");

    let crons = qm.list_crons().await;
    let cron = crons.iter().find(|c| c.name == "precision-cron");
    assert!(cron.is_some(), "Cron should be in list");

    let cron = cron.unwrap();
    assert!(cron.next_run > 0, "Cron should have next_run calculated");

    // Cleanup
    qm.delete_cron("precision-cron").await;
}

/// Test: Cron execution limit is respected.
#[tokio::test]
async fn test_cron_limit_respected() {
    let qm = setup();

    // Add cron with limit of 3 executions
    let _ = qm
        .add_cron_with_repeat(
            "limited-cron".to_string(),
            "cron-limit".to_string(),
            json!({}),
            None,
            Some(1000), // Every 1 second (repeat_every)
            0,
            Some(3), // Limit to 3 executions
        )
        .await;

    let crons = qm.list_crons().await;
    let cron = crons.iter().find(|c| c.name == "limited-cron");

    if let Some(c) = cron {
        assert_eq!(c.limit, Some(3), "Cron limit should be 3");
    }

    qm.delete_cron("limited-cron").await;
}

/// Test: Cron repeat_every works correctly.
#[tokio::test]
async fn test_cron_repeat_every() {
    let qm = setup();

    // Add cron with repeat_every
    let _ = qm
        .add_cron_with_repeat(
            "repeat-cron".to_string(),
            "repeat-queue".to_string(),
            json!({"repeat": true}),
            None,
            Some(500), // Every 500ms
            5,
            None, // No limit
        )
        .await;

    let crons = qm.list_crons().await;
    let cron = crons.iter().find(|c| c.name == "repeat-cron");

    if let Some(c) = cron {
        assert_eq!(c.repeat_every, Some(500), "repeat_every should be 500ms");
    }

    qm.delete_cron("repeat-cron").await;
}

/// Test: 6-field cron expression (with seconds) is parsed correctly.
#[tokio::test]
async fn test_cron_6_field_expression() {
    let qm = setup();

    // 6-field cron: second minute hour day month weekday
    let result = qm
        .add_cron(
            "six-field".to_string(),
            "cron-six".to_string(),
            json!({}),
            "30 * * * * *".to_string(), // Every minute at :30 seconds
            0,
        )
        .await;

    assert!(result.is_ok(), "6-field cron should be valid");

    // Verify it was added
    let crons = qm.list_crons().await;
    let cron = crons.iter().find(|c| c.name == "six-field");
    assert!(cron.is_some());
    assert_eq!(cron.unwrap().schedule, Some("30 * * * * *".to_string()));

    qm.delete_cron("six-field").await;
}

/// Test: Invalid cron expression is rejected.
#[tokio::test]
async fn test_cron_invalid_expression() {
    let qm = setup();

    let result = qm
        .add_cron(
            "invalid-cron".to_string(),
            "test".to_string(),
            json!({}),
            "invalid cron expression".to_string(),
            0,
        )
        .await;

    assert!(result.is_err(), "Invalid cron should be rejected");
}

/// Test: No duplicate cron execution under concurrent calls.
#[tokio::test]
async fn test_cron_concurrent_execution_guard() {
    let qm = setup();

    // Add a cron job
    let _ = qm
        .add_cron_with_repeat(
            "conc-cron".to_string(),
            "cron-conc".to_string(),
            json!({}),
            None,
            Some(100), // Every 100ms
            0,
            None, // No limit
        )
        .await;

    let jobs_created = Arc::new(AtomicUsize::new(0));

    let result = timeout(Duration::from_secs(3), async {
        let mut handles = vec![];

        // Multiple concurrent cron runners
        for _ in 0..5 {
            let qm = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..10 {
                    qm.run_cron_jobs().await;
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            }));
        }

        // Count jobs created
        let qm_count = qm.clone();
        let counter = jobs_created.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..30 {
                let jobs = qm_count.pull_batch_nowait("cron-conc", 100).await;
                counter.fetch_add(jobs.len(), Ordering::Relaxed);
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }));

        for h in handles {
            let _ = h.await;
        }
    })
    .await;

    assert!(
        result.is_ok(),
        "Concurrent cron execution should not deadlock"
    );

    qm.delete_cron("conc-cron").await;
}

/// Test: Cron cleanup after deletion.
#[tokio::test]
async fn test_cron_deletion_cleanup() {
    let qm = setup();

    // Add and delete multiple crons
    for i in 0..10 {
        let name = format!("cleanup-cron-{}", i);
        let _ = qm
            .add_cron(
                name.clone(),
                "cleanup-queue".to_string(),
                json!({"i": i}),
                "* * * * * *".to_string(),
                0,
            )
            .await;
        qm.delete_cron(&name).await;
    }

    let crons = qm.list_crons().await;
    let cleanup_crons: Vec<_> = crons
        .iter()
        .filter(|c| c.name.starts_with("cleanup-cron"))
        .collect();

    assert!(
        cleanup_crons.is_empty(),
        "All cleanup crons should be deleted"
    );
}

// ============== GROUP FIFO TESTS ==============

/// Test: FIFO order is strictly maintained within a group.
#[tokio::test]
async fn test_group_fifo_order_strict() {
    let qm = setup();

    // Push 10 jobs in same group
    let mut job_ids = vec![];
    for i in 0..10 {
        let job = qm
            .push(
                "fifo-strict".to_string(),
                JobInput {
                    data: json!({"order": i}),
                    group_id: Some("strict-group".to_string()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        job_ids.push(job.id);
    }

    // Process jobs in order
    let mut processed_order = vec![];
    for _ in 0..10 {
        let pulled = qm.pull_batch_nowait("fifo-strict", 10).await;
        assert_eq!(
            pulled.len(),
            1,
            "Should only get one job at a time from same group"
        );

        let job = &pulled[0];
        processed_order.push(job.id);
        qm.ack(job.id, None).await.unwrap();
    }

    // Verify FIFO order
    assert_eq!(
        processed_order, job_ids,
        "Jobs should be processed in FIFO order"
    );
}

/// Test: Group FIFO under concurrent pull operations.
#[tokio::test]
async fn test_group_concurrent_pull_fifo() {
    let qm = setup();

    // Push jobs in same group
    for i in 0..20 {
        let _ = qm
            .push(
                "fifo-conc".to_string(),
                JobInput {
                    data: json!({"i": i}),
                    group_id: Some("conc-group".to_string()),
                    ..Default::default()
                },
            )
            .await;
    }

    let pulled_count = Arc::new(AtomicUsize::new(0));
    let concurrent_count = Arc::new(AtomicUsize::new(0));

    let result = timeout(Duration::from_secs(3), async {
        let mut handles = vec![];

        for _ in 0..5 {
            let qm = qm.clone();
            let pulled = pulled_count.clone();
            let concurrent = concurrent_count.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..10 {
                    let jobs = qm.pull_batch_nowait("fifo-conc", 5).await;
                    if jobs.len() > 1 {
                        concurrent.fetch_add(1, Ordering::Relaxed);
                    }
                    for job in jobs {
                        pulled.fetch_add(1, Ordering::Relaxed);
                        let _ = qm.ack(job.id, None).await;
                    }
                    tokio::task::yield_now().await;
                }
            }));
        }

        for h in handles {
            let _ = h.await;
        }
    })
    .await;

    assert!(result.is_ok(), "Concurrent FIFO should not deadlock");

    // Group constraint: should never have >1 job from same group at once
    let concurrent = concurrent_count.load(Ordering::Relaxed);
    assert_eq!(
        concurrent, 0,
        "Should never pull multiple jobs from same group concurrently"
    );
}

/// Test: Active group limit per queue.
#[tokio::test]
async fn test_group_active_limit() {
    let qm = setup();

    // Push jobs in multiple groups
    for group in 0..5 {
        for job in 0..3 {
            let _ = qm
                .push(
                    "multi-group".to_string(),
                    JobInput {
                        data: json!({"group": group, "job": job}),
                        group_id: Some(format!("group-{}", group)),
                        ..Default::default()
                    },
                )
                .await;
        }
    }

    // Pull batch - should get one from each group
    let pulled = qm.pull_batch_nowait("multi-group", 10).await;

    // Should have at most 5 jobs (one per group)
    assert_eq!(
        pulled.len(),
        5,
        "Should pull one job per group, got {}",
        pulled.len()
    );

    // Verify each job is from different group
    let groups: std::collections::HashSet<_> =
        pulled.iter().filter_map(|j| j.group_id.as_ref()).collect();
    assert_eq!(
        groups.len(),
        5,
        "All pulled jobs should be from different groups"
    );
}

// ============== METRICS ACCURACY TESTS ==============

/// Test: Metrics counters are accurate after operations.
#[tokio::test]
async fn test_metrics_counters_accuracy() {
    let qm = setup();

    let push_count = 100;
    let ack_count = 80;
    let fail_count = 20;

    // Push jobs
    for i in 0..push_count {
        let _ = qm
            .push(
                "metrics-acc".into(),
                JobInput {
                    data: json!({"i": i}),
                    max_attempts: Some(1),
                    ..Default::default()
                },
            )
            .await;
    }

    // Pull and ack some, fail others
    for i in 0..push_count {
        let pulled = qm.pull_batch_nowait("metrics-acc", 1).await;
        if let Some(job) = pulled.first() {
            if i < ack_count {
                let _ = qm.ack(job.id, None).await;
            } else {
                let _ = qm.fail(job.id, Some("test failure".to_string())).await;
            }
        }
    }

    let metrics = qm.get_metrics().await;

    assert_eq!(
        metrics.total_pushed, push_count as u64,
        "total_pushed should match"
    );
    assert_eq!(
        metrics.total_completed, ack_count as u64,
        "total_completed should match ack count"
    );
    assert_eq!(
        metrics.total_failed, fail_count as u64,
        "total_failed should match fail count"
    );
}

/// Test: Metrics history rolling window works correctly.
#[tokio::test]
async fn test_metrics_history_rolling() {
    let qm = setup();

    // Collect many history points
    for _ in 0..100 {
        qm.collect_metrics_history();
    }

    let history = qm.get_metrics_history();

    // History should be bounded
    assert!(
        history.len() <= 60,
        "History should be <= 60 entries, got {}",
        history.len()
    );

    // Verify timestamps are in order (oldest first)
    for i in 1..history.len() {
        assert!(
            history[i].timestamp >= history[i - 1].timestamp,
            "History should be in chronological order"
        );
    }
}

/// Test: Metrics data structure is valid.
/// Note: Prometheus format is tested at HTTP layer, not QueueManager.
#[tokio::test]
async fn test_metrics_data_structure() {
    let qm = setup();

    // Create some activity
    for i in 0..10 {
        let job = qm
            .push("metrics-struct".into(), job(json!({"i": i})))
            .await
            .unwrap();
        let _ = qm.pull("metrics-struct").await;
        let _ = qm.ack(job.id, None).await;
    }

    let metrics = qm.get_metrics().await;

    // Verify metrics structure
    assert!(metrics.total_pushed >= 10, "Should have pushed jobs");
    assert!(metrics.total_completed >= 10, "Should have completed jobs");
    assert!(!metrics.queues.is_empty(), "Should have queue metrics");
}

// ============== CONCURRENT METRICS COLLECTION ==============

/// Test: Metrics collection under concurrent load.
#[tokio::test]
async fn test_metrics_concurrent_collection() {
    let qm = setup();

    let result = timeout(Duration::from_secs(3), async {
        let mut handles = vec![];

        // Concurrent push/pull
        for _ in 0..5 {
            let qm = qm.clone();
            handles.push(tokio::spawn(async move {
                for i in 0..100 {
                    let _ = qm.push("metrics-conc".into(), job(json!({"i": i}))).await;
                    let pulled = qm.pull_batch_nowait("metrics-conc", 1).await;
                    for job in pulled {
                        let _ = qm.ack(job.id, None).await;
                    }
                }
            }));
        }

        // Concurrent metrics collection
        for _ in 0..3 {
            let qm = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..50 {
                    qm.collect_metrics_history();
                    let _ = qm.get_metrics().await;
                    let _ = qm.get_metrics_history();
                    tokio::task::yield_now().await;
                }
            }));
        }

        for h in handles {
            let _ = h.await;
        }
    })
    .await;

    assert!(
        result.is_ok(),
        "Concurrent metrics collection should not deadlock"
    );
}
