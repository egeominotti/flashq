//! Cleanup task deadlock tests.
//!
//! Tests for deadlocks between cleanup tasks and client operations.
//! These are regression tests for fixed bugs.

use super::*;

/// REGRESSION: cleanup_completed_jobs + push deadlock
/// Bug: cleanup held completed_jobs.write() while acquiring custom_id_map.write()
/// But push() acquires them in reverse order.
#[tokio::test]
async fn test_cleanup_completed_vs_push() {
    let qm = setup();

    // Create completed jobs to trigger cleanup
    for i in 0..100 {
        let j = qm
            .push("cleanup-push".into(), job(json!({"i": i})))
            .await
            .unwrap();
        qm.pull("cleanup-push").await;
        let _ = qm.ack(j.id, Some(json!({"r": "ok"}))).await;
    }

    let qm_cleanup = qm.clone();
    let qm_push = qm.clone();

    let ok = run_concurrent(TIMEOUT_SHORT, 20, move |i| {
        let q = if i % 2 == 0 {
            qm_cleanup.clone()
        } else {
            qm_push.clone()
        };
        async move {
            if i % 2 == 0 {
                for _ in 0..50 {
                    q.cleanup_completed_jobs();
                    tokio::task::yield_now().await;
                }
            } else {
                for j in 0..30 {
                    let _ = q.push("cleanup-push".into(), job(json!({"j": j}))).await;
                }
            }
        }
    })
    .await;

    assert!(ok, "DEADLOCK: cleanup_completed_jobs + push");
}

/// REGRESSION: cleanup_stale_index_entries livelock during push
/// Bug: cleanup acquired shard.read() for each entry, starving push's write()
#[tokio::test]
async fn test_cleanup_index_vs_push_batch() {
    let qm = setup();

    // Pre-populate to ensure index has entries
    for i in 0..200 {
        qm.push("idx-test".into(), job(json!({"i": i})))
            .await
            .unwrap();
    }

    let qm_cleanup = qm.clone();
    let qm_push = qm.clone();

    let ok = run_concurrent(TIMEOUT_SHORT, 10, move |i| {
        let q = if i < 5 {
            qm_cleanup.clone()
        } else {
            qm_push.clone()
        };
        async move {
            if i < 5 {
                for _ in 0..30 {
                    q.cleanup_stale_index_entries();
                    tokio::task::yield_now().await;
                }
            } else {
                for j in 0..20 {
                    let jobs: Vec<_> = (0..50)
                        .map(|k| JobInput::new(json!({"j": j, "k": k})))
                        .collect();
                    let _ = q.push_batch("idx-test".into(), jobs).await;
                }
            }
        }
    })
    .await;

    assert!(ok, "LIVELOCK: cleanup_stale_index + push_batch");
}

/// Test: all cleanup functions running concurrently
#[tokio::test]
async fn test_all_cleanup_concurrent() {
    let qm = setup();

    // Pre-populate with various job states
    for i in 0..100 {
        qm.push("all-cleanup".into(), job(json!({"i": i})))
            .await
            .unwrap();
    }
    for _ in 0..50 {
        let j = qm.pull("all-cleanup").await;
        let _ = qm.ack(j.id, Some(json!({"r": "ok"}))).await;
    }

    let ok = run_concurrent(TIMEOUT_SHORT, 25, {
        let qm = qm.clone();
        move |i| {
            let q = qm.clone();
            async move {
                for _ in 0..30 {
                    match i % 5 {
                        0 => q.cleanup_completed_jobs(),
                        1 => q.cleanup_job_results(),
                        2 => q.cleanup_stale_index_entries(),
                        3 => q.shrink_memory_buffers(),
                        _ => q.check_dependencies().await,
                    }
                    tokio::task::yield_now().await;
                }
            }
        }
    })
    .await;

    assert!(ok, "DEADLOCK: all cleanup concurrent");
}

/// Test: shrink_memory_buffers during heavy load
#[tokio::test]
async fn test_shrink_during_load() {
    let qm = setup();

    let qm_push = qm.clone();
    let qm_shrink = qm.clone();
    let qm_stats = qm.clone();

    let ok = run_concurrent(TIMEOUT_SHORT, 15, move |i| {
        let q = match i % 3 {
            0 => qm_push.clone(),
            1 => qm_shrink.clone(),
            _ => qm_stats.clone(),
        };
        async move {
            match i % 3 {
                0 => {
                    for j in 0..100 {
                        let _ = q.push("shrink".into(), job(json!({"j": j}))).await;
                    }
                }
                1 => {
                    for _ in 0..200 {
                        q.shrink_memory_buffers();
                        tokio::task::yield_now().await;
                    }
                }
                _ => {
                    for _ in 0..100 {
                        let _ = q.stats().await;
                    }
                }
            }
        }
    })
    .await;

    assert!(ok, "DEADLOCK: shrink during load");
}
