//! Background task deadlock tests.

use super::*;

/// Test: All 14 background tasks running concurrently don't deadlock.
#[tokio::test]
async fn test_all_background_tasks_concurrent() {
    let qm = setup();

    // Pre-populate with jobs in various states
    for i in 0..100 {
        let _ = qm.push("bg-test".into(), job(json!({"i": i}))).await;
    }
    for _ in 0..50 {
        let pulled = qm.pull_batch_nowait("bg-test", 1).await;
        for job in pulled {
            let _ = qm.ack(job.id, None).await;
        }
    }

    let result = timeout(Duration::from_secs(5), async {
        let mut handles = vec![];

        // Task 1: check_dependencies
        let qm1 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm1.check_dependencies().await;
                tokio::task::yield_now().await;
            }
        }));

        // Task 2: check_timed_out_jobs
        let qm2 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm2.check_timed_out_jobs().await;
                tokio::task::yield_now().await;
            }
        }));

        // Task 3: check_stalled_jobs
        let qm3 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm3.check_stalled_jobs();
                tokio::task::yield_now().await;
            }
        }));

        // Task 4: cleanup_completed_jobs
        let qm4 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm4.cleanup_completed_jobs();
                tokio::task::yield_now().await;
            }
        }));

        // Task 5: cleanup_job_results
        let qm5 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm5.cleanup_job_results();
                tokio::task::yield_now().await;
            }
        }));

        // Task 6: cleanup_stale_index_entries
        let qm6 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm6.cleanup_stale_index_entries();
                tokio::task::yield_now().await;
            }
        }));

        // Task 7: cleanup_debounce_cache
        let qm7 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm7.cleanup_debounce_cache();
                tokio::task::yield_now().await;
            }
        }));

        // Task 8: shrink_memory_buffers
        let qm8 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm8.shrink_memory_buffers();
                tokio::task::yield_now().await;
            }
        }));

        // Task 9: cleanup_job_logs
        let qm9 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm9.cleanup_job_logs();
                tokio::task::yield_now().await;
            }
        }));

        // Task 10: cleanup_completed_retention
        let qm10 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm10.cleanup_completed_retention();
                tokio::task::yield_now().await;
            }
        }));

        // Task 11: run_cron_jobs
        let qm11 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..50 {
                qm11.run_cron_jobs().await;
                tokio::task::yield_now().await;
            }
        }));

        // Task 12: collect_metrics_history
        let qm12 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm12.collect_metrics_history();
                tokio::task::yield_now().await;
            }
        }));

        // Task 13: cleanup_expired_kv
        let qm13 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm13.cleanup_expired_kv();
                tokio::task::yield_now().await;
            }
        }));

        // Concurrent user operations
        let qm14 = qm.clone();
        handles.push(tokio::spawn(async move {
            for i in 0..200 {
                let _ = qm14.push("bg-test".into(), job(json!({"i": i}))).await;
                let _ = qm14.pull_batch_nowait("bg-test", 1).await;
                let _ = qm14.stats().await;
            }
        }));

        for h in handles {
            let _ = h.await;
        }
    })
    .await;

    assert!(
        result.is_ok(),
        "DEADLOCK: background tasks + user operations"
    );
}

/// Test: check_dependencies + ack race condition.
#[tokio::test]
async fn test_check_dependencies_ack_race() {
    let qm = setup();

    let parent = qm
        .push("dep-race".into(), job(json!({"type": "parent"})))
        .await
        .unwrap();
    let _child = qm
        .push(
            "dep-race".into(),
            JobInput {
                data: json!({"type": "child"}),
                depends_on: Some(vec![parent.id]),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let result = timeout(Duration::from_secs(3), async {
        let mut handles = vec![];

        let qm1 = qm.clone();
        let parent_id = parent.id;
        handles.push(tokio::spawn(async move {
            let pulled = qm1.pull("dep-race").await;
            assert_eq!(pulled.id, parent_id);
            tokio::task::yield_now().await;
            qm1.ack(parent_id, None).await.unwrap();
        }));

        let qm2 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm2.check_dependencies().await;
                tokio::task::yield_now().await;
            }
        }));

        for h in handles {
            h.await.unwrap();
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK: check_dependencies + ack");

    qm.check_dependencies().await;
    let (queued, _, _, _, _) = qm.stats().await;
    assert!(
        queued >= 1,
        "Child job should be queued after parent completes"
    );
}

/// Test: cleanup_stale_index + push race condition.
#[tokio::test]
async fn test_cleanup_index_push_race() {
    let qm = setup();

    for i in 0..1000 {
        let _ = qm.push("cleanup-race".into(), job(json!({"i": i}))).await;
        let pulled = qm.pull_batch_nowait("cleanup-race", 1).await;
        for job in pulled {
            let _ = qm.ack(job.id, None).await;
        }
    }

    let result = timeout(Duration::from_secs(3), async {
        let mut handles = vec![];

        let qm1 = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm1.cleanup_stale_index_entries();
                tokio::task::yield_now().await;
            }
        }));

        let qm2 = qm.clone();
        handles.push(tokio::spawn(async move {
            for i in 0..500 {
                let _ = qm2
                    .push("cleanup-race".into(), job(json!({"new": i})))
                    .await;
            }
        }));

        for h in handles {
            h.await.unwrap();
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK: cleanup_stale_index + push");
}
