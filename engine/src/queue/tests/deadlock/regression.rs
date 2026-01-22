//! Regression tests for lock starvation and convoy bugs.

use super::*;

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
