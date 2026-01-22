//! Basic lock ordering deadlock tests.

use super::*;

/// Test: stats() + check_dependencies() + ack() concurrent
/// Known deadlock scenario from lock ordering issues.
#[tokio::test]
async fn test_stats_deps_ack() {
    let qm = setup();

    let parent = qm
        .push("dl-basic".into(), job(json!({"t": "parent"})))
        .await
        .unwrap();
    let _child = qm
        .push(
            "dl-basic".into(),
            JobInput {
                data: json!({"t": "child"}),
                depends_on: Some(vec![parent.id]),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let pulled = qm.pull("dl-basic").await;
    assert_eq!(pulled.id, parent.id);

    let qm1 = qm.clone();
    let qm2 = qm.clone();
    let qm3 = qm.clone();
    let pid = parent.id;

    let ok = run_concurrent(TIMEOUT_SHORT, 3, move |i| {
        let q = match i {
            0 => qm1.clone(),
            1 => qm2.clone(),
            _ => qm3.clone(),
        };
        async move {
            match i % 3 {
                0 => {
                    for _ in 0..100 {
                        let _ = q.stats().await;
                    }
                }
                1 => {
                    for _ in 0..100 {
                        q.check_dependencies().await;
                    }
                }
                _ => {
                    let _ = q.ack(pid, Some(json!({"r": "ok"}))).await;
                }
            }
        }
    })
    .await;

    assert!(ok, "DEADLOCK: stats + deps + ack");
}

/// Test: mixed operations across multiple queues
#[tokio::test]
async fn test_multi_queue_ops() {
    let qm = setup();

    let qm_push = qm.clone();
    let qm_stats = qm.clone();

    let ok = run_concurrent(TIMEOUT_SHORT, 10, move |i| {
        let q = if i < 5 {
            qm_push.clone()
        } else {
            qm_stats.clone()
        };
        async move {
            if i < 5 {
                for j in 0..50 {
                    let _ = q.push(format!("q-{}", i), job(json!({"j": j}))).await;
                }
            } else {
                for _ in 0..200 {
                    let _ = q.stats().await;
                }
            }
        }
    })
    .await;

    assert!(ok, "DEADLOCK: multi-queue ops");
    let (queued, _, _, _, _) = qm.stats().await;
    assert_eq!(queued, 250);
}

/// Test: rapid push/pull/ack lifecycle
#[tokio::test]
async fn test_rapid_lifecycle() {
    let qm = setup();

    let ok = timeout(Duration::from_secs(5), async {
        let mut handles = vec![];

        for w in 0..10 {
            let q = qm.clone();
            handles.push(tokio::spawn(async move {
                let name = format!("rapid-{}", w);
                for i in 0..50 {
                    let pushed = q
                        .push(name.clone(), job(json!({"w": w, "i": i})))
                        .await
                        .unwrap();
                    let pulled = q.pull_batch_nowait(&name, 1).await;
                    let id = if !pulled.is_empty() {
                        pulled[0].id
                    } else {
                        pushed.id
                    };
                    let _ = q.ack(id, None).await;
                }
            }));
        }

        // Background tasks concurrent
        let q = qm.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                q.check_dependencies().await;
                q.cleanup_completed_jobs();
                tokio::task::yield_now().await;
            }
        }));

        for h in handles {
            let _ = h.await;
        }
    })
    .await;

    assert!(ok.is_ok(), "DEADLOCK: rapid lifecycle");
}
