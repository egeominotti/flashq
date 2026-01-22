//! Batch operation deadlock tests.
//!
//! Tests for deadlocks during batch operations and queue management.

use super::*;

/// Test: concurrent batch pull and ack
#[tokio::test]
async fn test_batch_pull_ack_concurrent() {
    let qm = setup();

    // Pre-populate
    for i in 0..500 {
        qm.push("batch-test".into(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    let ok = run_concurrent(TIMEOUT_SHORT, 8, {
        let qm = qm.clone();
        move |i| {
            let q = qm.clone();
            async move {
                if i < 5 {
                    let jobs = q.pull_batch("batch-test", 50).await;
                    let ids: Vec<u64> = jobs.iter().map(|j| j.id).collect();
                    q.ack_batch(&ids).await;
                } else {
                    for _ in 0..50 {
                        let _ = q.stats().await;
                    }
                }
            }
        }
    })
    .await;

    assert!(ok, "DEADLOCK: batch pull/ack");
}

/// Test: fail operations under load with DLQ reads
#[tokio::test]
async fn test_fail_with_dlq_reads() {
    let qm = setup();

    // Pre-populate with jobs that will fail
    for i in 0..200 {
        qm.push(
            "fail-test".into(),
            JobInput {
                data: json!({"i": i}),
                max_attempts: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    }

    let ok = run_concurrent(TIMEOUT_SHORT, 25, {
        let qm = qm.clone();
        move |i| {
            let q = qm.clone();
            async move {
                match i % 3 {
                    0 => {
                        // Pull and fail
                        for _ in 0..10 {
                            let jobs = q.pull_batch_nowait("fail-test", 5).await;
                            for job in jobs {
                                let _ = q.fail(job.id, Some("test error".into())).await;
                            }
                            tokio::task::yield_now().await;
                        }
                    }
                    1 => {
                        // DLQ reads
                        for _ in 0..50 {
                            let _ = q.get_dlq("fail-test", None).await;
                        }
                    }
                    _ => {
                        // Background tasks
                        for _ in 0..30 {
                            q.check_stalled_jobs();
                            q.check_timed_out_jobs().await;
                            q.cleanup_completed_jobs();
                            tokio::task::yield_now().await;
                        }
                    }
                }
            }
        }
    })
    .await;

    assert!(ok, "DEADLOCK: fail with DLQ reads");
}

/// Test: concurrent queue management (pause/resume/rate limit)
#[tokio::test]
async fn test_queue_management_concurrent() {
    let qm = setup();

    // Create multiple queues
    for q in 0..20 {
        for i in 0..50 {
            qm.push(format!("mgmt-{}", q), job(json!({"i": i})))
                .await
                .unwrap();
        }
    }

    let ok = run_concurrent(TIMEOUT_SHORT, 25, {
        let qm = qm.clone();
        move |i| {
            let q = qm.clone();
            async move {
                match i % 4 {
                    0 => {
                        // Pause/resume
                        for _ in 0..20 {
                            let name = format!("mgmt-{}", i % 10);
                            q.pause(&name).await;
                            q.resume(&name).await;
                            let _ = q.is_paused(&name);
                        }
                    }
                    1 => {
                        // Rate limiting
                        for _ in 0..20 {
                            let name = format!("mgmt-{}", 10 + (i % 10));
                            q.set_rate_limit(name.clone(), 100).await;
                            q.clear_rate_limit(&name).await;
                        }
                    }
                    2 => {
                        // Stats and list
                        for _ in 0..50 {
                            let _ = q.stats().await;
                            let _ = q.list_queues().await;
                        }
                    }
                    _ => {
                        // Background
                        for _ in 0..30 {
                            q.check_dependencies().await;
                            q.shrink_memory_buffers();
                            tokio::task::yield_now().await;
                        }
                    }
                }
            }
        }
    })
    .await;

    assert!(ok, "DEADLOCK: queue management");
}

/// Test: concurrent job state queries
#[tokio::test]
async fn test_job_queries_concurrent() {
    let qm = setup();

    // Create jobs
    let mut job_ids = vec![];
    for i in 0..100 {
        let pushed = qm
            .push("query-test".into(), job(json!({"i": i})))
            .await
            .unwrap();
        job_ids.push(pushed.id);
    }

    // Pull some jobs
    for _ in 0..50 {
        qm.pull("query-test").await;
    }

    let job_ids = std::sync::Arc::new(job_ids);

    let ok = run_concurrent(TIMEOUT_SHORT, 30, {
        let qm = qm.clone();
        let ids = job_ids.clone();
        move |i| {
            let q = qm.clone();
            let ids = ids.clone();
            async move {
                match i % 4 {
                    0 => {
                        // get_job queries
                        for &id in ids.iter().take(20) {
                            let _ = q.get_job(id);
                            let _ = q.get_state(id);
                            tokio::task::yield_now().await;
                        }
                    }
                    1 => {
                        // get_jobs list
                        for _ in 0..20 {
                            let _ = q.get_jobs(None, None, 100, 0);
                            tokio::task::yield_now().await;
                        }
                    }
                    2 => {
                        // Job counts
                        for _ in 0..50 {
                            let _ = q.get_job_counts("query-test");
                            let _ = q.count("query-test");
                            tokio::task::yield_now().await;
                        }
                    }
                    _ => {
                        // Background
                        for _ in 0..30 {
                            q.check_dependencies().await;
                            q.cleanup_stale_index_entries();
                            tokio::task::yield_now().await;
                        }
                    }
                }
            }
        }
    })
    .await;

    assert!(ok, "DEADLOCK: job queries");
}

/// Test: background tasks simulation
#[tokio::test]
async fn test_background_tasks_simulation() {
    let qm = setup();

    // Pre-populate with jobs
    for i in 0..100 {
        qm.push("bg-test".into(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    // Pull some jobs to have jobs in processing
    let mut job_ids = vec![];
    for _ in 0..50 {
        let pulled = qm.pull("bg-test").await;
        job_ids.push(pulled.id);
    }
    let job_ids = std::sync::Arc::new(job_ids);

    let ok = run_concurrent(TIMEOUT_SHORT, 15, {
        let qm = qm.clone();
        let ids = job_ids.clone();
        move |i| {
            let q = qm.clone();
            let ids = ids.clone();
            async move {
                match i % 4 {
                    0 => {
                        // check_timed_out_jobs
                        for _ in 0..50 {
                            q.check_timed_out_jobs().await;
                        }
                    }
                    1 => {
                        // check_dependencies
                        for _ in 0..50 {
                            q.check_dependencies().await;
                        }
                    }
                    2 => {
                        // check_stalled_jobs + cleanup
                        for _ in 0..20 {
                            q.check_stalled_jobs();
                            q.cleanup_completed_jobs();
                            q.cleanup_job_results();
                            q.cleanup_stale_index_entries();
                            q.shrink_memory_buffers();
                        }
                    }
                    _ => {
                        // Client ack operations
                        for &id in ids.iter() {
                            let _ = q.ack(id, Some(json!({"done": true}))).await;
                        }
                    }
                }
            }
        }
    })
    .await;

    assert!(ok, "DEADLOCK: background tasks simulation");
}
