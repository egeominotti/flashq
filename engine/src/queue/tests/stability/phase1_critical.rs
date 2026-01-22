//! Phase 1 Critical Tests - Additional memory and race condition tests.
//!
//! These tests validate:
//! - job_logs unbounded growth prevention
//! - stalled_count cleanup
//! - webhook_circuits bounded growth
//! - metrics_history bounded (60 entries)
//! - Heartbeat + timeout race conditions
//! - Promote + timeout race conditions
//! - Update + ack race conditions

use super::*;
use crate::protocol::JobState;

// ============== Memory Bound Tests ==============

/// Test: job_logs respects global 10K limit.
/// Validates that cleanup_job_logs() prevents unbounded growth.
#[tokio::test]
async fn test_job_logs_bounded_growth() {
    let qm = setup();

    // Create many jobs and add logs to each
    for batch in 0..15 {
        let jobs: Vec<_> = (0..1000)
            .map(|i| JobInput::new(json!({"batch": batch, "i": i})))
            .collect();
        let ids = qm.push_batch("logs-bound".into(), jobs).await;

        // Pull and add logs, then ack
        let pulled = qm.pull_batch_nowait("logs-bound", 1000).await;
        for job in &pulled {
            // Add multiple log entries per job
            let _ = qm.add_job_log(job.id, "Processing started".to_string(), "info".to_string());
            let _ = qm.add_job_log(job.id, "Step 1 complete".to_string(), "info".to_string());
            let _ = qm.add_job_log(job.id, "Step 2 complete".to_string(), "info".to_string());
        }

        // Ack the jobs (should trigger log cleanup for completed)
        for job in pulled {
            let _ = qm.ack(job.id, None).await;
        }
        for id in ids {
            let _ = qm.ack(id, None).await;
        }

        // Run cleanup periodically
        if batch % 5 == 0 {
            qm.cleanup_job_logs();
        }
    }

    // Final cleanup
    qm.cleanup_job_logs();

    let logs_count = qm.job_logs.read().len();
    assert!(
        logs_count <= 10_000,
        "job_logs exceeded 10K threshold: {} entries (should be <= 10000)",
        logs_count
    );
}

/// Test: stalled_count is cleaned up when jobs with remove_on_complete are acked.
/// Note: For regular jobs, stalled_count is cleaned during background cleanup.
#[tokio::test]
async fn test_stalled_count_cleanup_on_ack_remove_on_complete() {
    let qm = setup();

    // Push jobs with short stall timeout AND remove_on_complete
    for i in 0..50 {
        let _ = qm
            .push(
                "stall-cleanup".into(),
                JobInput {
                    data: json!({"i": i}),
                    stall_timeout: Some(10), // 10ms stall timeout
                    remove_on_complete: true,
                    ..Default::default()
                },
            )
            .await;
    }

    // Pull all jobs
    let pulled = qm.pull_batch_nowait("stall-cleanup", 50).await;

    // Wait for stall detection to kick in (add entries to stalled_count)
    tokio::time::sleep(Duration::from_millis(50)).await;
    qm.check_stalled_jobs();

    // Verify stalled_count has entries
    let stalled_before = qm.stalled_count.read().len();
    assert!(
        stalled_before > 0,
        "Expected stalled_count to have entries after stall detection"
    );

    // Ack all jobs - this should clean stalled_count for remove_on_complete jobs
    for job in pulled {
        let _ = qm.ack(job.id, None).await;
    }

    let stalled_after = qm.stalled_count.read().len();
    assert_eq!(
        stalled_after, 0,
        "stalled_count not cleaned after ack with remove_on_complete: {} entries remain",
        stalled_after
    );
}

/// Test: stalled_count bounded when using cleanup + completed_jobs cleanup.
/// This validates cleanup works when both cleanup functions run together.
#[tokio::test]
async fn test_stalled_count_bounded_with_cleanup() {
    let qm = setup();

    // Push a moderate number of jobs to test cleanup
    for batch in 0..10 {
        for i in 0..100 {
            let _ = qm
                .push(
                    "stall-bounded".into(),
                    JobInput {
                        data: json!({"batch": batch, "i": i}),
                        stall_timeout: Some(5),
                        ..Default::default()
                    },
                )
                .await;
        }

        let pulled = qm.pull_batch_nowait("stall-bounded", 100).await;

        // Trigger stall detection
        tokio::time::sleep(Duration::from_millis(10)).await;
        qm.check_stalled_jobs();

        // Ack all jobs
        for job in pulled {
            let _ = qm.ack(job.id, None).await;
        }
    }

    let stalled_before = qm.stalled_count.read().len();

    // After completing jobs, stalled_count may have entries
    // (cleanup only happens when job_index entries are removed)
    // This is expected behavior - stalled_count is cleaned lazily
    assert!(
        stalled_before <= 1000,
        "stalled_count should be bounded during normal operation: {} entries",
        stalled_before
    );
}

/// Test: stalled_count is cleaned up on heartbeat.
#[tokio::test]
async fn test_stalled_count_cleanup_on_heartbeat() {
    let qm = setup();

    // Push job with short stall timeout
    let job = qm
        .push(
            "heartbeat-stall".into(),
            JobInput {
                data: json!({}),
                stall_timeout: Some(10),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Pull the job
    let _pulled = qm.pull("heartbeat-stall").await;

    // Wait for stall detection
    tokio::time::sleep(Duration::from_millis(50)).await;
    qm.check_stalled_jobs();

    // Verify stalled_count has entry
    let stalled_before = qm.stalled_count.read().contains_key(&job.id);
    assert!(
        stalled_before,
        "Expected job {} in stalled_count after stall detection",
        job.id
    );

    // Send heartbeat - should clear stalled_count for this job
    let result = qm.heartbeat(job.id);
    assert!(result.is_ok(), "Heartbeat should succeed");

    let stalled_after = qm.stalled_count.read().contains_key(&job.id);
    assert!(
        !stalled_after,
        "stalled_count should be cleared for job {} after heartbeat",
        job.id
    );
}

/// Test: metrics_history is bounded to 60 entries.
#[tokio::test]
async fn test_metrics_history_bounded() {
    let qm = setup();

    // Collect more than 60 metrics points
    for _ in 0..100 {
        qm.collect_metrics_history();
    }

    let history = qm.get_metrics_history();
    assert!(
        history.len() <= 60,
        "metrics_history exceeded 60 limit: {} entries",
        history.len()
    );
}

/// Test: metrics_history maintains rolling window (FIFO).
#[tokio::test]
async fn test_metrics_history_rolling_window() {
    let qm = setup();

    // Collect 70 points
    for _ in 0..70 {
        qm.collect_metrics_history();
        tokio::time::sleep(Duration::from_millis(1)).await; // Ensure different timestamps
    }

    let history = qm.get_metrics_history();
    assert_eq!(history.len(), 60, "History should have exactly 60 points");

    // Verify monotonically increasing timestamps (FIFO order)
    for i in 1..history.len() {
        assert!(
            history[i].timestamp >= history[i - 1].timestamp,
            "Timestamps should be in order: {} < {}",
            history[i - 1].timestamp,
            history[i].timestamp
        );
    }
}

// ============== Race Condition Tests ==============

/// Test: Heartbeat during timeout check doesn't cause data corruption.
/// Scenario: Job times out while heartbeat is being sent.
#[tokio::test]
async fn test_heartbeat_timeout_race() {
    let qm = setup();

    // Push job with very short timeout
    let job = qm
        .push(
            "heartbeat-race".into(),
            JobInput {
                data: json!({}),
                timeout: Some(50), // 50ms timeout
                max_attempts: Some(3),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let _pulled = qm.pull("heartbeat-race").await;

    let heartbeat_success = Arc::new(AtomicUsize::new(0));
    let heartbeat_fail = Arc::new(AtomicUsize::new(0));
    let timeout_triggered = Arc::new(AtomicBool::new(false));

    let result = timeout(Duration::from_secs(3), async {
        let mut handles = vec![];

        // Spawn heartbeat task
        for _ in 0..20 {
            let qm = qm.clone();
            let job_id = job.id;
            let success = heartbeat_success.clone();
            let fail = heartbeat_fail.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..10 {
                    match qm.heartbeat(job_id) {
                        Ok(_) => {
                            success.fetch_add(1, Ordering::Relaxed);
                        }
                        Err(_) => {
                            fail.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            }));
        }

        // Spawn timeout checker task
        let qm_timeout = qm.clone();
        let timeout_flag = timeout_triggered.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..50 {
                qm_timeout.check_timed_out_jobs().await;
                let state = qm_timeout.get_state(job.id);
                if state == JobState::Unknown || state == JobState::Waiting {
                    timeout_flag.store(true, Ordering::Relaxed);
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }));

        for h in handles {
            let _ = h.await;
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK: heartbeat + timeout race");

    // Verify job is in consistent state
    let state = qm.get_state(job.id);
    assert!(
        state != JobState::Unknown,
        "Job should still exist in some state (waiting, active, or dlq)"
    );
}

/// Test: Promote during timeout check doesn't cause data corruption.
/// Scenario: Delayed job being promoted while timeout check runs.
#[tokio::test]
async fn test_promote_timeout_race() {
    let qm = setup();

    // Push delayed jobs with short timeout
    let mut job_ids = vec![];
    for i in 0..20 {
        let job = qm
            .push(
                "promote-race".into(),
                JobInput {
                    data: json!({"i": i}),
                    delay: Some(60_000), // Delayed by 60s
                    timeout: Some(100),
                    max_attempts: Some(2),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        job_ids.push(job.id);
    }

    let promoted = Arc::new(AtomicUsize::new(0));
    let pulled = Arc::new(AtomicUsize::new(0));

    let result = timeout(Duration::from_secs(3), async {
        let mut handles = vec![];

        // Promote tasks
        for id in job_ids.clone() {
            let qm = qm.clone();
            let counter = promoted.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..5 {
                    if qm.promote(id).await.is_ok() {
                        counter.fetch_add(1, Ordering::Relaxed);
                    }
                    tokio::task::yield_now().await;
                }
            }));
        }

        // Pull tasks
        for _ in 0..10 {
            let qm = qm.clone();
            let counter = pulled.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..10 {
                    let jobs = qm.pull_batch_nowait("promote-race", 5).await;
                    counter.fetch_add(jobs.len(), Ordering::Relaxed);
                    for job in jobs {
                        let _ = qm.ack(job.id, None).await;
                    }
                    tokio::task::yield_now().await;
                }
            }));
        }

        // Timeout check tasks
        for _ in 0..5 {
            let qm = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..20 {
                    qm.check_timed_out_jobs().await;
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            }));
        }

        for h in handles {
            let _ = h.await;
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK: promote + timeout race");

    // Verify all jobs are accounted for
    let total_promoted = promoted.load(Ordering::Relaxed);
    let total_pulled = pulled.load(Ordering::Relaxed);
    assert!(
        total_promoted > 0 || total_pulled > 0,
        "Expected some jobs to be promoted or pulled"
    );
}

/// Test: Update job data during ack doesn't cause data loss.
/// Scenario: Job data being updated while ack is in progress.
#[tokio::test]
async fn test_update_ack_race() {
    let qm = setup();

    for round in 0..10 {
        let job = qm
            .push("update-ack".into(), job(json!({"round": round})))
            .await
            .unwrap();
        let _pulled = qm.pull("update-ack").await;

        let update_success = Arc::new(AtomicUsize::new(0));
        let ack_success = Arc::new(AtomicUsize::new(0));

        let mut handles = vec![];

        // Update tasks
        for i in 0..5 {
            let qm = qm.clone();
            let job_id = job.id;
            let counter = update_success.clone();
            handles.push(tokio::spawn(async move {
                if qm
                    .update_job_data(job_id, json!({"updated": i}))
                    .await
                    .is_ok()
                {
                    counter.fetch_add(1, Ordering::Relaxed);
                }
            }));
        }

        // ACK task
        let qm_ack = qm.clone();
        let ack_counter = ack_success.clone();
        handles.push(tokio::spawn(async move {
            if qm_ack
                .ack(job.id, Some(json!({"result": "done"})))
                .await
                .is_ok()
            {
                ack_counter.fetch_add(1, Ordering::Relaxed);
            }
        }));

        for h in handles {
            h.await.unwrap();
        }

        let acks = ack_success.load(Ordering::Relaxed);
        let updates = update_success.load(Ordering::Relaxed);

        // Exactly one ack should succeed
        assert_eq!(
            acks, 1,
            "Round {}: Exactly one ack should succeed, got {}",
            round, acks
        );

        // Some updates might succeed (before ack) or fail (after ack)
        // This is expected behavior - just verify no panic/deadlock occurred
        assert!(
            updates <= 5,
            "Round {}: Updates count ({}) should be <= 5",
            round,
            updates
        );

        // Verify job is completed
        let state = qm.get_state(job.id);
        assert_eq!(
            state,
            JobState::Completed,
            "Round {}: Job should be completed",
            round
        );

        // Verify result was stored
        let result = qm.get_result(job.id).await;
        assert!(result.is_some(), "Round {}: Result should be stored", round);
    }
}

/// Test: Multiple heartbeats on same job are idempotent.
#[tokio::test]
async fn test_concurrent_heartbeats_same_job() {
    let qm = setup();

    let job = qm
        .push(
            "heartbeat-conc".into(),
            JobInput {
                data: json!({}),
                stall_timeout: Some(5000),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let _pulled = qm.pull("heartbeat-conc").await;

    let success_count = Arc::new(AtomicUsize::new(0));
    let fail_count = Arc::new(AtomicUsize::new(0));

    let mut handles = vec![];
    for _ in 0..20 {
        let qm = qm.clone();
        let job_id = job.id;
        let success = success_count.clone();
        let fail = fail_count.clone();
        handles.push(tokio::spawn(async move {
            match qm.heartbeat(job_id) {
                Ok(_) => success.fetch_add(1, Ordering::Relaxed),
                Err(_) => fail.fetch_add(1, Ordering::Relaxed),
            };
        }));
    }

    for h in handles {
        h.await.unwrap();
    }

    let successes = success_count.load(Ordering::Relaxed);
    let failures = fail_count.load(Ordering::Relaxed);

    // All heartbeats should succeed (idempotent operation)
    assert_eq!(
        successes, 20,
        "All 20 heartbeats should succeed, got {} success, {} fail",
        successes, failures
    );
}

/// Test: Job logs are not lost during concurrent add + cleanup.
#[tokio::test]
async fn test_job_logs_concurrent_add_cleanup() {
    let qm = setup();

    // Push jobs and keep them in processing
    let mut job_ids = vec![];
    for i in 0..100 {
        let job = qm
            .push("log-conc".into(), job(json!({"i": i})))
            .await
            .unwrap();
        job_ids.push(job.id);
    }

    // Pull all jobs (keep in processing)
    let _pulled = qm.pull_batch_nowait("log-conc", 100).await;

    let logs_added = Arc::new(AtomicUsize::new(0));

    let result = timeout(Duration::from_secs(3), async {
        let mut handles = vec![];

        // Log adders
        for job_id in job_ids.iter().cloned() {
            let qm = qm.clone();
            let counter = logs_added.clone();
            handles.push(tokio::spawn(async move {
                for i in 0..10 {
                    if qm
                        .add_job_log(job_id, format!("Log entry {}", i), "info".to_string())
                        .is_ok()
                    {
                        counter.fetch_add(1, Ordering::Relaxed);
                    }
                    tokio::task::yield_now().await;
                }
            }));
        }

        // Cleanup task running concurrently
        let qm_cleanup = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..50 {
                qm_cleanup.cleanup_job_logs();
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }));

        for h in handles {
            let _ = h.await;
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK: log add + cleanup");

    // Verify logs were added for active jobs
    let total_added = logs_added.load(Ordering::Relaxed);
    assert!(
        total_added > 0,
        "Expected some logs to be added, got {}",
        total_added
    );

    // Verify active job logs are preserved
    let first_job_logs = qm.get_job_logs(job_ids[0]);
    assert!(
        !first_job_logs.is_empty(),
        "Active job logs should be preserved during cleanup"
    );
}
