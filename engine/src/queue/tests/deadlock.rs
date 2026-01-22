//! Deadlock detection tests.
//!
//! These tests verify that concurrent operations don't cause deadlocks.
//! Each test uses a timeout to detect potential deadlocks.
//!
//! IMPORTANT: These tests are critical for production stability.
//! Any deadlock would cause the entire server to hang.

use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::time::timeout;

/// Timeout for deadlock detection tests (2 seconds should be plenty for in-memory operations)
const DEADLOCK_TIMEOUT: Duration = Duration::from_secs(2);

/// Extended timeout for stress tests
const STRESS_TIMEOUT: Duration = Duration::from_secs(10);

// ==================== DEADLOCK DETECTION TESTS ====================

/// Test: concurrent stats() + check_dependencies() + ack()
/// This was a known deadlock scenario due to lock ordering:
/// - check_dependencies: shard.write() -> completed_jobs.read()
/// - stats: completed_jobs.read() -> shard.read()
/// - ack: processing.write() -> shard.write() -> completed_jobs.write()
#[tokio::test]
async fn test_deadlock_stats_check_dependencies_ack() {
    let qm = setup();

    // Create jobs with dependencies to trigger check_dependencies
    let parent_job = qm
        .push("deadlock-test".to_string(), job(json!({"type": "parent"})))
        .await
        .unwrap();
    let parent_id = parent_job.id;

    let _child_job = qm
        .push(
            "deadlock-test".to_string(),
            JobInput {
                data: json!({"type": "child"}),
                depends_on: Some(vec![parent_id]),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    // Pull the parent job
    let pulled_job = qm.pull("deadlock-test").await;
    assert_eq!(pulled_job.id, parent_id);

    // Run concurrent operations that could deadlock
    let result = timeout(DEADLOCK_TIMEOUT, async {
        let mut handles = vec![];

        // Spawn stats() calls
        for _ in 0..10 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..100 {
                    let _ = qm_clone.stats().await;
                }
            }));
        }

        // Spawn check_dependencies() calls (via background task simulation)
        for _ in 0..5 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..100 {
                    qm_clone.check_dependencies().await;
                }
            }));
        }

        // Spawn ack() call
        let qm_clone = qm.clone();
        handles.push(tokio::spawn(async move {
            let _ = qm_clone
                .ack(parent_id, Some(json!({"result": "done"})))
                .await;
        }));

        for handle in handles {
            handle.await.unwrap();
        }
    })
    .await;

    assert!(
        result.is_ok(),
        "DEADLOCK DETECTED: stats + check_dependencies + ack"
    );
}

/// Test: concurrent push + pull + ack + stats across multiple queues
#[tokio::test]
async fn test_deadlock_mixed_operations_multi_queue() {
    let qm = setup();

    let result = timeout(DEADLOCK_TIMEOUT, async {
        let mut handles = vec![];

        // Push operations on multiple queues
        for q in 0..5 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for i in 0..50 {
                    qm_clone
                        .push(format!("queue-{}", q), job(json!({"i": i})))
                        .await
                        .unwrap();
                }
            }));
        }

        // Stats operations
        for _ in 0..3 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..200 {
                    let _ = qm_clone.stats().await;
                }
            }));
        }

        // Memory stats operations
        for _ in 0..3 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..100 {
                    let _ = qm_clone.memory_stats();
                }
            }));
        }

        for handle in handles {
            handle.await.unwrap();
        }
    })
    .await;

    assert!(
        result.is_ok(),
        "DEADLOCK DETECTED: mixed operations across queues"
    );

    // Verify jobs were pushed
    let (queued, _, _, _, _) = qm.stats().await;
    assert_eq!(queued, 250, "Should have 250 jobs (5 queues * 50 jobs)");
}

/// Test: concurrent background tasks simulation
#[tokio::test]
async fn test_deadlock_background_tasks() {
    let qm = setup();

    // Pre-populate with jobs
    for i in 0..100 {
        qm.push("bg-test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    // Pull some jobs to have jobs in processing
    let mut job_ids = vec![];
    for _ in 0..50 {
        let pulled = qm.pull("bg-test").await;
        job_ids.push(pulled.id);
    }

    let result = timeout(DEADLOCK_TIMEOUT, async {
        let mut handles = vec![];

        // Simulate check_timed_out_jobs (runs every 500ms in production)
        for _ in 0..3 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..50 {
                    qm_clone.check_timed_out_jobs().await;
                }
            }));
        }

        // Simulate check_dependencies (runs every 500ms in production)
        for _ in 0..3 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..50 {
                    qm_clone.check_dependencies().await;
                }
            }));
        }

        // Simulate check_stalled_jobs (runs every 10s in production)
        for _ in 0..2 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..20 {
                    qm_clone.check_stalled_jobs();
                }
            }));
        }

        // Simulate cleanup tasks (runs every 10s in production)
        for _ in 0..2 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..20 {
                    qm_clone.cleanup_completed_jobs();
                    qm_clone.cleanup_job_results();
                    qm_clone.cleanup_stale_index_entries();
                    qm_clone.shrink_memory_buffers();
                }
            }));
        }

        // Concurrent client operations
        for id in job_ids.clone() {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                let _ = qm_clone.ack(id, Some(json!({"done": true}))).await;
            }));
        }

        for handle in handles {
            let _ = handle.await;
        }
    })
    .await;

    assert!(
        result.is_ok(),
        "DEADLOCK DETECTED: background tasks simulation"
    );
}

/// Test: concurrent shrink_memory_buffers during heavy load
/// This specifically tests the try_write() pattern in shrink_memory_buffers
#[tokio::test]
async fn test_deadlock_shrink_during_heavy_load() {
    let qm = setup();

    let result = timeout(DEADLOCK_TIMEOUT, async {
        let mut handles = vec![];

        // Heavy push load
        for _ in 0..10 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for i in 0..100 {
                    qm_clone
                        .push("shrink-test".to_string(), job(json!({"i": i})))
                        .await
                        .unwrap();
                }
            }));
        }

        // Concurrent shrink operations
        for _ in 0..5 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..200 {
                    qm_clone.shrink_memory_buffers();
                    tokio::task::yield_now().await;
                }
            }));
        }

        // Stats during shrink
        for _ in 0..3 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..100 {
                    let _ = qm_clone.stats().await;
                }
            }));
        }

        for handle in handles {
            let _ = handle.await;
        }
    })
    .await;

    assert!(
        result.is_ok(),
        "DEADLOCK DETECTED: shrink during heavy load"
    );
}

/// Test: rapid push/pull/ack cycle with background tasks
#[tokio::test]
async fn test_deadlock_rapid_lifecycle() {
    let qm = setup();

    let result = timeout(Duration::from_secs(5), async {
        let mut handles = vec![];

        // Rapid push/pull/ack cycles
        for worker_id in 0..10 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for i in 0..50 {
                    let queue_name = format!("rapid-{}", worker_id);

                    // Push
                    let pushed_job = qm_clone
                        .push(
                            queue_name.clone(),
                            job(json!({"worker": worker_id, "i": i})),
                        )
                        .await
                        .unwrap();

                    // Pull (use pull_batch_nowait to avoid blocking)
                    let pulled = qm_clone.pull_batch_nowait(&queue_name, 1).await;
                    if !pulled.is_empty() {
                        // Ack
                        let _ = qm_clone.ack(pulled[0].id, None).await;
                    } else {
                        // Job might be pulled by someone else or not ready yet
                        // Try to ack by ID we pushed
                        let _ = qm_clone.ack(pushed_job.id, None).await;
                    }
                }
            }));
        }

        // Background tasks running concurrently
        let qm_clone = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm_clone.check_dependencies().await;
                qm_clone.check_timed_out_jobs().await;
                qm_clone.cleanup_completed_jobs();
                qm_clone.shrink_memory_buffers();
                tokio::task::yield_now().await;
            }
        }));

        for handle in handles {
            let _ = handle.await;
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK DETECTED: rapid lifecycle");
}

/// Test: concurrent batch operations
#[tokio::test]
async fn test_deadlock_batch_operations() {
    let qm = setup();

    // Pre-populate
    for i in 0..500 {
        qm.push("batch-test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    let result = timeout(DEADLOCK_TIMEOUT, async {
        let mut handles = vec![];

        // Concurrent batch pulls
        for _ in 0..5 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                let jobs = qm_clone.pull_batch("batch-test", 50).await;
                let ids: Vec<u64> = jobs.iter().map(|j| j.id).collect();
                // Batch ack
                qm_clone.ack_batch(&ids).await;
            }));
        }

        // Stats during batch operations
        for _ in 0..3 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..50 {
                    let _ = qm_clone.stats().await;
                }
            }));
        }

        for handle in handles {
            let _ = handle.await;
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK DETECTED: batch operations");
}

/// Test: stress test with all operations
#[tokio::test]
async fn test_deadlock_stress_all_operations() {
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

        // Stats
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

        for handle in handles {
            let _ = handle.await;
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK DETECTED: stress all operations");
}

// ==================== HEAVY LOAD TESTS ====================

/// Test: heavy concurrent load - 50 workers pushing/pulling simultaneously
#[tokio::test]
async fn test_deadlock_heavy_concurrent_workers() {
    let qm = setup();
    let ops_counter = std::sync::Arc::new(AtomicUsize::new(0));

    let result = timeout(STRESS_TIMEOUT, async {
        let mut handles = vec![];

        // 50 concurrent workers
        for worker_id in 0..50 {
            let qm_clone = qm.clone();
            let counter = ops_counter.clone();
            handles.push(tokio::spawn(async move {
                for i in 0..100 {
                    // Push
                    let pushed = qm_clone
                        .push(
                            format!("heavy-{}", worker_id % 10),
                            job(json!({"worker": worker_id, "i": i})),
                        )
                        .await
                        .unwrap();

                    // Pull
                    let pulled = qm_clone
                        .pull_batch_nowait(&format!("heavy-{}", worker_id % 10), 1)
                        .await;

                    // Ack
                    if !pulled.is_empty() {
                        let _ = qm_clone.ack(pulled[0].id, None).await;
                    } else {
                        let _ = qm_clone.ack(pushed.id, None).await;
                    }

                    counter.fetch_add(1, Ordering::Relaxed);
                }
            }));
        }

        // Background monitoring
        for _ in 0..5 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..500 {
                    let _ = qm_clone.stats().await;
                    let _ = qm_clone.memory_stats();
                    tokio::task::yield_now().await;
                }
            }));
        }

        // Background cleanup
        for _ in 0..3 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..200 {
                    qm_clone.check_dependencies().await;
                    qm_clone.check_timed_out_jobs().await;
                    qm_clone.cleanup_completed_jobs();
                    qm_clone.shrink_memory_buffers();
                    tokio::task::yield_now().await;
                }
            }));
        }

        for handle in handles {
            let _ = handle.await;
        }
    })
    .await;

    assert!(
        result.is_ok(),
        "DEADLOCK DETECTED: heavy concurrent workers (completed {} ops)",
        ops_counter.load(Ordering::Relaxed)
    );
}

/// Test: sustained load over time - simulates real production scenario
#[tokio::test]
async fn test_deadlock_sustained_load() {
    let qm = setup();
    let total_ops = std::sync::Arc::new(AtomicUsize::new(0));

    let result = timeout(STRESS_TIMEOUT, async {
        let mut handles = vec![];

        // Continuous push stream
        for stream_id in 0..10 {
            let qm_clone = qm.clone();
            let counter = total_ops.clone();
            handles.push(tokio::spawn(async move {
                for i in 0..200 {
                    let _ = qm_clone
                        .push(
                            format!("sustained-{}", stream_id),
                            job(json!({"stream": stream_id, "seq": i})),
                        )
                        .await;
                    counter.fetch_add(1, Ordering::Relaxed);
                    // Simulate realistic push rate
                    if i % 10 == 0 {
                        tokio::task::yield_now().await;
                    }
                }
            }));
        }

        // Continuous process stream
        for stream_id in 0..10 {
            let qm_clone = qm.clone();
            let counter = total_ops.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..100 {
                    let jobs = qm_clone
                        .pull_batch_nowait(&format!("sustained-{}", stream_id), 5)
                        .await;
                    for job in jobs {
                        let _ = qm_clone.ack(job.id, Some(json!({"processed": true}))).await;
                        counter.fetch_add(1, Ordering::Relaxed);
                    }
                    tokio::task::yield_now().await;
                }
            }));
        }

        // Continuous monitoring (simulating dashboard/API calls)
        for _ in 0..5 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..300 {
                    let _ = qm_clone.stats().await;
                    let _ = qm_clone.get_metrics().await;
                    let _ = qm_clone.list_queues().await;
                    tokio::task::yield_now().await;
                }
            }));
        }

        // Background tasks (simulating actual background runner)
        let qm_clone = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                // Simulate background task cycle
                qm_clone.check_dependencies().await;
                qm_clone.check_timed_out_jobs().await;
                qm_clone.check_stalled_jobs();
                qm_clone.cleanup_completed_jobs();
                qm_clone.cleanup_job_results();
                qm_clone.cleanup_stale_index_entries();
                qm_clone.shrink_memory_buffers();
                tokio::time::sleep(Duration::from_micros(100)).await;
            }
        }));

        for handle in handles {
            let _ = handle.await;
        }
    })
    .await;

    assert!(
        result.is_ok(),
        "DEADLOCK DETECTED: sustained load (completed {} ops)",
        total_ops.load(Ordering::Relaxed)
    );
}

/// Test: fail operations under load
#[tokio::test]
async fn test_deadlock_fail_operations() {
    let qm = setup();

    // Pre-populate with jobs that will fail
    for i in 0..200 {
        qm.push(
            "fail-load-test".to_string(),
            JobInput {
                data: json!({"i": i}),
                max_attempts: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    }

    let result = timeout(DEADLOCK_TIMEOUT, async {
        let mut handles = vec![];

        // Pull and fail concurrently
        for _ in 0..20 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..10 {
                    let jobs = qm_clone.pull_batch_nowait("fail-load-test", 5).await;
                    for job in jobs {
                        let _ = qm_clone.fail(job.id, Some("test error".to_string())).await;
                    }
                    tokio::task::yield_now().await;
                }
            }));
        }

        // Concurrent DLQ reads
        for _ in 0..5 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..50 {
                    let _ = qm_clone.get_dlq("fail-load-test", None).await;
                }
            }));
        }

        // Background tasks
        let qm_clone = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                qm_clone.check_stalled_jobs();
                qm_clone.check_timed_out_jobs().await;
                qm_clone.cleanup_completed_jobs();
                tokio::task::yield_now().await;
            }
        }));

        for handle in handles {
            let _ = handle.await;
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK DETECTED: fail operations");
}

/// Test: concurrent queue management operations
#[tokio::test]
async fn test_deadlock_queue_management() {
    let qm = setup();

    // Create multiple queues
    for q in 0..20 {
        for i in 0..50 {
            qm.push(format!("mgmt-{}", q), job(json!({"i": i})))
                .await
                .unwrap();
        }
    }

    let result = timeout(DEADLOCK_TIMEOUT, async {
        let mut handles = vec![];

        // Pause/resume operations
        for q in 0..10 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..20 {
                    qm_clone.pause(&format!("mgmt-{}", q)).await;
                    qm_clone.resume(&format!("mgmt-{}", q)).await;
                    let _ = qm_clone.is_paused(&format!("mgmt-{}", q));
                }
            }));
        }

        // Rate limit operations
        for q in 10..20 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..20 {
                    qm_clone.set_rate_limit(format!("mgmt-{}", q), 100).await;
                    qm_clone.clear_rate_limit(&format!("mgmt-{}", q)).await;
                }
            }));
        }

        // Concurrent stats
        for _ in 0..5 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..100 {
                    let _ = qm_clone.stats().await;
                    let _ = qm_clone.list_queues().await;
                }
            }));
        }

        // Background tasks
        let qm_clone = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..50 {
                qm_clone.check_dependencies().await;
                qm_clone.shrink_memory_buffers();
                tokio::task::yield_now().await;
            }
        }));

        for handle in handles {
            let _ = handle.await;
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK DETECTED: queue management");
}

/// Test: concurrent job state queries
#[tokio::test]
async fn test_deadlock_job_queries() {
    let qm = setup();

    // Create jobs
    let mut job_ids = vec![];
    for i in 0..100 {
        let pushed = qm
            .push("query-test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
        job_ids.push(pushed.id);
    }

    // Pull some jobs
    for _ in 0..50 {
        qm.pull("query-test").await;
    }

    let result = timeout(DEADLOCK_TIMEOUT, async {
        let mut handles = vec![];

        // Concurrent get_job queries
        for id in job_ids.clone() {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..10 {
                    let _ = qm_clone.get_job(id);
                    let _ = qm_clone.get_state(id);
                    tokio::task::yield_now().await;
                }
            }));
        }

        // Concurrent get_jobs list
        for _ in 0..10 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..20 {
                    let _ = qm_clone.get_jobs(None, None, 100, 0);
                    tokio::task::yield_now().await;
                }
            }));
        }

        // Concurrent job counts
        for _ in 0..10 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..50 {
                    let _ = qm_clone.get_job_counts("query-test");
                    let _ = qm_clone.count("query-test");
                    tokio::task::yield_now().await;
                }
            }));
        }

        // Background operations
        let qm_clone = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..50 {
                qm_clone.check_dependencies().await;
                qm_clone.cleanup_stale_index_entries();
                tokio::task::yield_now().await;
            }
        }));

        for handle in handles {
            let _ = handle.await;
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK DETECTED: job queries");
}

/// Test: extreme concurrent load - maximum parallelism
#[tokio::test]
async fn test_deadlock_extreme_parallelism() {
    let qm = setup();
    let completed = std::sync::Arc::new(AtomicUsize::new(0));

    let result = timeout(STRESS_TIMEOUT, async {
        let mut handles = vec![];

        // 100 concurrent tasks all doing different operations
        for task_id in 0..100 {
            let qm_clone = qm.clone();
            let counter = completed.clone();
            handles.push(tokio::spawn(async move {
                let queue_name = format!("extreme-{}", task_id % 20);

                for _ in 0..50 {
                    // Mix of operations based on task_id
                    match task_id % 5 {
                        0 => {
                            // Push only
                            let _ = qm_clone
                                .push(queue_name.clone(), job(json!({"task": task_id})))
                                .await;
                        }
                        1 => {
                            // Pull and ack
                            let jobs = qm_clone.pull_batch_nowait(&queue_name, 2).await;
                            for job in jobs {
                                let _ = qm_clone.ack(job.id, None).await;
                            }
                        }
                        2 => {
                            // Stats and metrics
                            let _ = qm_clone.stats().await;
                            let _ = qm_clone.memory_stats();
                        }
                        3 => {
                            // Background task ops
                            qm_clone.check_dependencies().await;
                            qm_clone.shrink_memory_buffers();
                        }
                        4 => {
                            // Queue management
                            let _ = qm_clone.list_queues().await;
                            let _ = qm_clone.get_job_counts(&queue_name);
                        }
                        _ => unreachable!(),
                    }
                    counter.fetch_add(1, Ordering::Relaxed);
                    tokio::task::yield_now().await;
                }
            }));
        }

        for handle in handles {
            let _ = handle.await;
        }
    })
    .await;

    let total = completed.load(Ordering::Relaxed);
    assert!(
        result.is_ok(),
        "DEADLOCK DETECTED: extreme parallelism (completed {} ops)",
        total
    );
    assert!(
        total > 4000,
        "Should complete at least 4000 operations, got {}",
        total
    );
}

/// Test: lock ordering with all cleanup functions
#[tokio::test]
async fn test_deadlock_all_cleanup_concurrent() {
    let qm = setup();

    // Pre-populate
    for i in 0..500 {
        qm.push("cleanup-test".to_string(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    // Process some jobs to create completed jobs
    for _ in 0..200 {
        let job = qm.pull("cleanup-test").await;
        let _ = qm.ack(job.id, Some(json!({"result": "ok"}))).await;
    }

    let result = timeout(DEADLOCK_TIMEOUT, async {
        let mut handles = vec![];

        // All cleanup functions running concurrently
        for _ in 0..10 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..50 {
                    qm_clone.cleanup_completed_jobs();
                    tokio::task::yield_now().await;
                }
            }));

            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..50 {
                    qm_clone.cleanup_job_results();
                    tokio::task::yield_now().await;
                }
            }));

            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..50 {
                    qm_clone.cleanup_stale_index_entries();
                    tokio::task::yield_now().await;
                }
            }));

            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..50 {
                    qm_clone.shrink_memory_buffers();
                    tokio::task::yield_now().await;
                }
            }));

            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..50 {
                    qm_clone.check_dependencies().await;
                    tokio::task::yield_now().await;
                }
            }));
        }

        // Concurrent client operations
        for _ in 0..10 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..30 {
                    let jobs = qm_clone.pull_batch_nowait("cleanup-test", 3).await;
                    for job in jobs {
                        let _ = qm_clone.ack(job.id, None).await;
                    }
                    tokio::task::yield_now().await;
                }
            }));
        }

        for handle in handles {
            let _ = handle.await;
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK DETECTED: all cleanup concurrent");
}
