//! Heavy load stress tests for deadlocks under extreme concurrent load.

use super::*;

/// Test: heavy concurrent load - 50 workers pushing/pulling simultaneously
#[tokio::test]
async fn test_heavy_concurrent_workers() {
    let qm = setup();
    let ops = std::sync::Arc::new(OpsCounter::new());

    let ok = run_concurrent(TIMEOUT_STRESS, 58, {
        let qm = qm.clone();
        let ops = ops.clone();
        move |i| {
            let q = qm.clone();
            let ops = ops.clone();
            async move {
                if i < 50 {
                    // Worker: push/pull/ack cycle
                    for j in 0..100 {
                        let queue_name = format!("heavy-{}", i % 10);
                        let pushed = q
                            .push(queue_name.clone(), job(json!({"w": i, "j": j})))
                            .await
                            .unwrap();
                        let pulled = q.pull_batch_nowait(&queue_name, 1).await;
                        let id = if !pulled.is_empty() {
                            pulled[0].id
                        } else {
                            pushed.id
                        };
                        let _ = q.ack(id, None).await;
                        ops.inc();
                    }
                } else if i < 55 {
                    // Monitor: stats
                    for _ in 0..500 {
                        let _ = q.stats().await;
                        let _ = q.memory_stats();
                        tokio::task::yield_now().await;
                    }
                } else {
                    // Background cleanup
                    for _ in 0..200 {
                        q.check_dependencies().await;
                        q.check_timed_out_jobs().await;
                        q.cleanup_completed_jobs();
                        q.shrink_memory_buffers();
                        tokio::task::yield_now().await;
                    }
                }
            }
        }
    })
    .await;

    assert!(
        ok,
        "DEADLOCK: heavy concurrent workers (completed {} ops)",
        ops.get()
    );
}

/// Test: sustained load over time - simulates real production scenario
#[tokio::test]
async fn test_sustained_load() {
    let qm = setup();
    let ops = std::sync::Arc::new(OpsCounter::new());

    let ok = run_concurrent(TIMEOUT_STRESS, 26, {
        let qm = qm.clone();
        let ops = ops.clone();
        move |i| {
            let q = qm.clone();
            let ops = ops.clone();
            async move {
                if i < 10 {
                    // Push stream
                    for j in 0..200 {
                        let _ = q
                            .push(format!("sustained-{}", i), job(json!({"s": i, "j": j})))
                            .await;
                        ops.inc();
                        if j % 10 == 0 {
                            tokio::task::yield_now().await;
                        }
                    }
                } else if i < 20 {
                    // Process stream
                    let stream_id = i - 10;
                    for _ in 0..100 {
                        let jobs = q
                            .pull_batch_nowait(&format!("sustained-{}", stream_id), 5)
                            .await;
                        for job in jobs {
                            let _ = q.ack(job.id, Some(json!({"ok": true}))).await;
                            ops.inc();
                        }
                        tokio::task::yield_now().await;
                    }
                } else if i < 25 {
                    // Monitor (dashboard/API)
                    for _ in 0..300 {
                        let _ = q.stats().await;
                        let _ = q.get_metrics().await;
                        let _ = q.list_queues().await;
                        tokio::task::yield_now().await;
                    }
                } else {
                    // Background runner
                    for _ in 0..100 {
                        q.check_dependencies().await;
                        q.check_timed_out_jobs().await;
                        q.check_stalled_jobs();
                        q.cleanup_completed_jobs();
                        q.cleanup_job_results();
                        q.cleanup_stale_index_entries();
                        q.shrink_memory_buffers();
                        tokio::time::sleep(Duration::from_micros(100)).await;
                    }
                }
            }
        }
    })
    .await;

    assert!(ok, "DEADLOCK: sustained load (completed {} ops)", ops.get());
}

/// Test: extreme concurrent load - maximum parallelism
#[tokio::test]
async fn test_extreme_parallelism() {
    let qm = setup();
    let ops = std::sync::Arc::new(OpsCounter::new());

    let ok = run_concurrent(TIMEOUT_STRESS, 100, {
        let qm = qm.clone();
        let ops = ops.clone();
        move |i| {
            let q = qm.clone();
            let ops = ops.clone();
            async move {
                let queue_name = format!("extreme-{}", i % 20);
                for _ in 0..50 {
                    match i % 5 {
                        0 => {
                            let _ = q.push(queue_name.clone(), job(json!({"t": i}))).await;
                        }
                        1 => {
                            let jobs = q.pull_batch_nowait(&queue_name, 2).await;
                            for job in jobs {
                                let _ = q.ack(job.id, None).await;
                            }
                        }
                        2 => {
                            let _ = q.stats().await;
                            let _ = q.memory_stats();
                        }
                        3 => {
                            q.check_dependencies().await;
                            q.shrink_memory_buffers();
                        }
                        4 => {
                            let _ = q.list_queues().await;
                            let _ = q.get_job_counts(&queue_name);
                        }
                        _ => unreachable!(),
                    }
                    ops.inc();
                    tokio::task::yield_now().await;
                }
            }
        }
    })
    .await;

    let total = ops.get();
    assert!(
        ok,
        "DEADLOCK: extreme parallelism (completed {} ops)",
        total
    );
    assert!(total > 4000, "Should complete >4000 ops, got {}", total);
}

/// Test: stress all operations simultaneously
#[tokio::test]
async fn test_stress_all_operations() {
    let qm = setup();

    let result = timeout(Duration::from_secs(5), async {
        let mut handles = vec![];

        // Push jobs
        for q in 0..3 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for i in 0..100 {
                    let _ = qm_clone
                        .push(format!("stress-{}", q), job(json!({"i": i})))
                        .await;
                }
            }));
        }

        // Pull and process
        for q in 0..3 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..50 {
                    let jobs = qm_clone
                        .pull_batch_nowait(&format!("stress-{}", q), 5)
                        .await;
                    for job in jobs {
                        let _ = qm_clone.ack(job.id, None).await;
                    }
                    tokio::task::yield_now().await;
                }
            }));
        }

        // Stats + metrics
        let qm_clone = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..200 {
                let _ = qm_clone.stats().await;
                let _ = qm_clone.memory_stats();
            }
        }));

        // Background tasks
        let qm_clone = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..50 {
                qm_clone.check_dependencies().await;
                qm_clone.check_timed_out_jobs().await;
                qm_clone.check_stalled_jobs();
                qm_clone.cleanup_completed_jobs();
                qm_clone.cleanup_job_results();
                qm_clone.shrink_memory_buffers();
                tokio::task::yield_now().await;
            }
        }));

        // Get metrics
        let qm_clone = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                let _ = qm_clone.get_metrics().await;
            }
        }));

        // List queues
        let qm_clone = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                let _ = qm_clone.list_queues().await;
            }
        }));

        for h in handles {
            let _ = h.await;
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK: stress all operations");
}

/// REGRESSION: push_batch lock starvation
/// Bug: holding completed_jobs.read() while iterating 1000 jobs starves writers
#[tokio::test]
async fn test_push_batch_lock_starvation() {
    let qm = setup();

    // Create some completed jobs first
    for i in 0..100 {
        let j = qm
            .push("batch-starvation".into(), job(json!({"i": i})))
            .await
            .unwrap();
        qm.pull("batch-starvation").await;
        let _ = qm.ack(j.id, None).await;
    }

    let ok = run_concurrent(TIMEOUT_STRESS, 15, {
        let qm = qm.clone();
        move |i| {
            let q = qm.clone();
            async move {
                if i < 5 {
                    // Heavy push_batch (1000 jobs)
                    for _ in 0..10 {
                        let jobs: Vec<_> =
                            (0..1000).map(|k| JobInput::new(json!({"k": k}))).collect();
                        let _ = q.push_batch("batch-starvation".into(), jobs).await;
                    }
                } else if i < 10 {
                    // Cleanup wants completed_jobs.write()
                    for _ in 0..500 {
                        q.cleanup_completed_jobs();
                        tokio::task::yield_now().await;
                    }
                } else {
                    // Stats wants completed_jobs.read()
                    for _ in 0..300 {
                        let _ = q.stats().await;
                    }
                }
            }
        }
    })
    .await;

    assert!(ok, "LIVELOCK: push_batch lock starvation");
}

/// REGRESSION: ack_batch lock convoy
/// Bug: acquiring shard lock 100 times per batch instead of once
#[tokio::test]
async fn test_ack_batch_lock_convoy() {
    let qm = setup();

    // Pre-populate
    for i in 0..2000 {
        qm.push("ack-convoy".into(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    let ok = run_concurrent(TIMEOUT_STRESS, 20, {
        let qm = qm.clone();
        move |i| {
            let q = qm.clone();
            async move {
                if i < 10 {
                    // Pull batches (nowait) and ack_batch
                    for _ in 0..20 {
                        let jobs = q.pull_batch_nowait("ack-convoy", 50).await;
                        if !jobs.is_empty() {
                            let ids: Vec<u64> = jobs.iter().map(|j| j.id).collect();
                            q.ack_batch(&ids).await;
                        }
                        tokio::task::yield_now().await;
                    }
                } else if i < 15 {
                    // Concurrent pushes (need shard.write())
                    for j in 0..100 {
                        let _ = q.push("ack-convoy".into(), job(json!({"j": j}))).await;
                    }
                } else {
                    // Stats (need shard.read())
                    for _ in 0..200 {
                        let _ = q.stats().await;
                    }
                }
            }
        }
    })
    .await;

    assert!(ok, "LIVELOCK: ack_batch lock convoy");
}
