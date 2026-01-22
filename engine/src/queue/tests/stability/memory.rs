//! Memory growth tests - validate bounded data structures.

use super::*;

/// Test: job_index does not grow unbounded under sustained load.
/// Validates that completed jobs are properly cleaned from the index.
#[tokio::test]
async fn test_job_index_bounded_growth() {
    let qm = setup();
    let jobs_created = Arc::new(AtomicU64::new(0));
    let jobs_completed = Arc::new(AtomicU64::new(0));

    // Sustained push/pull/ack for 2 seconds
    let result = timeout(Duration::from_secs(5), async {
        let mut handles = vec![];

        // 10 producers
        for _ in 0..10 {
            let qm = qm.clone();
            let counter = jobs_created.clone();
            handles.push(tokio::spawn(async move {
                for i in 0..500 {
                    let _ = qm
                        .push(format!("index-test-{}", i % 5), job(json!({"i": i})))
                        .await;
                    counter.fetch_add(1, Ordering::Relaxed);
                }
            }));
        }

        // 10 consumers
        for _ in 0..10 {
            let qm = qm.clone();
            let counter = jobs_completed.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..500 {
                    let jobs = qm.pull_batch_nowait("index-test-0", 5).await;
                    for job in jobs {
                        let _ = qm.ack(job.id, None).await;
                        counter.fetch_add(1, Ordering::Relaxed);
                    }
                    tokio::task::yield_now().await;
                }
            }));
        }

        // Cleanup runner
        let qm_cleanup = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..50 {
                qm_cleanup.cleanup_completed_jobs();
                qm_cleanup.cleanup_stale_index_entries();
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }));

        for h in handles {
            let _ = h.await;
        }
    })
    .await;

    assert!(result.is_ok(), "Test timed out - possible deadlock");

    // Run final cleanup
    qm.cleanup_completed_jobs();
    qm.cleanup_stale_index_entries();

    let index_size = qm.job_index.len();
    let completed = jobs_completed.load(Ordering::Relaxed);

    assert!(
        index_size < 10000,
        "job_index grew unbounded: {} entries after {} completions",
        index_size,
        completed
    );
}

/// Test: completed_jobs set respects MAX_COMPLETED threshold.
#[tokio::test]
async fn test_completed_jobs_bounded() {
    let qm = setup();

    // Complete more jobs than the threshold (50,000)
    for batch in 0..60 {
        let jobs: Vec<_> = (0..1000)
            .map(|i| JobInput::new(json!({"b": batch, "i": i})))
            .collect();
        let ids = qm.push_batch("completed-bound".into(), jobs).await;

        let pulled = qm.pull_batch_nowait("completed-bound", 1000).await;
        for job in pulled {
            let _ = qm.ack(job.id, None).await;
        }

        for id in ids {
            let _ = qm.ack(id, None).await;
        }

        if batch % 10 == 0 {
            qm.cleanup_completed_jobs();
        }
    }

    qm.cleanup_completed_jobs();

    let completed_count = qm.completed_jobs.read().len();
    assert!(
        completed_count <= 50_000,
        "completed_jobs exceeded threshold: {} > 50000",
        completed_count
    );
}

/// Test: job_results respects MAX_RESULTS threshold.
#[tokio::test]
async fn test_job_results_bounded() {
    let qm = setup();

    for batch in 0..15 {
        let jobs: Vec<_> = (0..1000)
            .map(|i| JobInput::new(json!({"b": batch, "i": i})))
            .collect();
        qm.push_batch("results-bound".into(), jobs).await;

        let pulled = qm.pull_batch_nowait("results-bound", 1000).await;
        for job in pulled {
            let _ = qm.ack(job.id, Some(json!({"result": "data"}))).await;
        }

        if batch % 5 == 0 {
            qm.cleanup_job_results();
        }
    }

    qm.cleanup_job_results();

    let results_count = qm.job_results.read().len();
    assert!(
        results_count <= 10_000,
        "job_results exceeded threshold: {} > 10000",
        results_count
    );
}

/// Test: job_waiters are cleaned up on timeout.
#[tokio::test]
async fn test_job_waiters_cleanup_on_timeout() {
    let qm = setup();

    let job = qm.push("waiter-test".into(), job(json!({}))).await.unwrap();

    let mut handles = vec![];
    for _ in 0..10 {
        let qm = qm.clone();
        let job_id = job.id;
        handles.push(tokio::spawn(async move {
            let _ = qm.wait_for_job(job_id, Some(100)).await;
        }));
    }

    for h in handles {
        let _ = h.await;
    }

    tokio::time::sleep(Duration::from_millis(200)).await;

    let waiters_count = qm.job_waiters.read().len();
    assert!(
        waiters_count <= 1,
        "job_waiters not cleaned after timeout: {} entries",
        waiters_count
    );
}

/// Test: subscribers are cleaned when channels close.
#[tokio::test]
async fn test_subscribers_cleanup() {
    let qm = setup();

    for i in 0..100 {
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        qm.subscribe(format!("sub-{}", i), vec!["pushed".to_string()], tx);
    }

    for i in 0..10 {
        let _ = qm.push("sub-0".into(), job(json!({"i": i}))).await;
    }

    for i in 0..100 {
        qm.unsubscribe(&format!("sub-{}", i));
    }

    let subs_count = qm.subscribers.read().len();
    assert_eq!(
        subs_count, 0,
        "subscribers not cleaned after unsubscribe: {} entries",
        subs_count
    );
}

/// Test: debounce_cache expires old entries.
#[tokio::test]
async fn test_debounce_cache_expiry() {
    let qm = setup();

    for i in 0..50 {
        let _ = qm
            .push(
                "debounce-test".into(),
                JobInput {
                    data: json!({"i": i}),
                    debounce_id: Some(format!("event-{}", i)),
                    debounce_ttl: Some(100),
                    ..Default::default()
                },
            )
            .await;
    }

    let initial_size = qm
        .debounce_cache
        .read()
        .values()
        .map(|m| m.len())
        .sum::<usize>();
    assert!(initial_size > 0, "Debounce cache should have entries");

    tokio::time::sleep(Duration::from_millis(200)).await;
    qm.cleanup_debounce_cache();

    let final_size = qm
        .debounce_cache
        .read()
        .values()
        .map(|m| m.len())
        .sum::<usize>();
    assert!(
        final_size < initial_size,
        "Debounce cache not cleaned: {} -> {}",
        initial_size,
        final_size
    );
}
