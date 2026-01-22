//! Job state race condition tests.

use super::*;

/// Test: Double ACK on same job doesn't cause issues.
#[tokio::test]
async fn test_double_ack_same_job() {
    let qm = setup();

    let job = qm.push("double-ack".into(), job(json!({}))).await.unwrap();
    let _pulled = qm.pull("double-ack").await;

    let result1 = qm.ack(job.id, None).await;
    assert!(result1.is_ok(), "First ack should succeed");

    let result2 = qm.ack(job.id, None).await;
    assert!(
        result2.is_err(),
        "Second ack should fail (job not in processing)"
    );
}

/// Test: Concurrent ACK on same job - only one should succeed.
#[tokio::test]
async fn test_concurrent_ack_same_job() {
    let qm = setup();

    let job = qm.push("conc-ack".into(), job(json!({}))).await.unwrap();
    let _pulled = qm.pull("conc-ack").await;

    let success_count = Arc::new(AtomicUsize::new(0));
    let fail_count = Arc::new(AtomicUsize::new(0));

    let mut handles = vec![];
    for _ in 0..10 {
        let qm = qm.clone();
        let job_id = job.id;
        let success = success_count.clone();
        let fail = fail_count.clone();
        handles.push(tokio::spawn(async move {
            match qm.ack(job_id, None).await {
                Ok(_) => success.fetch_add(1, Ordering::Relaxed),
                Err(_) => fail.fetch_add(1, Ordering::Relaxed),
            };
        }));
    }

    for h in handles {
        h.await.unwrap();
    }

    let successes = success_count.load(Ordering::Relaxed);
    assert_eq!(
        successes, 1,
        "Exactly one ACK should succeed, got {}",
        successes
    );
}

/// Test: CANCEL + PULL race - cancelled job shouldn't be pulled.
#[tokio::test]
async fn test_cancel_pull_race() {
    let qm = setup();

    let mut ids = vec![];
    for i in 0..100 {
        let job = qm
            .push("cancel-race".into(), job(json!({"i": i})))
            .await
            .unwrap();
        ids.push(job.id);
    }

    let cancelled = Arc::new(AtomicUsize::new(0));
    let pulled = Arc::new(AtomicUsize::new(0));
    let pulled_cancelled = Arc::new(AtomicUsize::new(0));

    let cancelled_ids = Arc::new(parking_lot::RwLock::new(std::collections::HashSet::new()));

    let result = timeout(Duration::from_secs(3), async {
        let mut handles = vec![];

        for id in ids.iter().take(50) {
            let qm = qm.clone();
            let job_id = *id;
            let counter = cancelled.clone();
            let set = cancelled_ids.clone();
            handles.push(tokio::spawn(async move {
                if qm.cancel(job_id).await.is_ok() {
                    counter.fetch_add(1, Ordering::Relaxed);
                    set.write().insert(job_id);
                }
            }));
        }

        for _ in 0..50 {
            let qm = qm.clone();
            let counter = pulled.clone();
            let pc = pulled_cancelled.clone();
            let set = cancelled_ids.clone();
            handles.push(tokio::spawn(async move {
                let jobs = qm.pull_batch_nowait("cancel-race", 5).await;
                counter.fetch_add(jobs.len(), Ordering::Relaxed);
                for job in jobs {
                    if set.read().contains(&job.id) {
                        pc.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }));
        }

        for h in handles {
            let _ = h.await;
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK: cancel + pull");

    let pc = pulled_cancelled.load(Ordering::Relaxed);
    assert_eq!(pc, 0, "Pulled {} cancelled jobs - race condition!", pc);
}

/// Test: FAIL + ACK race - only one should succeed.
#[tokio::test]
async fn test_fail_ack_race() {
    let qm = setup();

    let job = qm
        .push(
            "fail-ack-race".into(),
            JobInput {
                data: json!({}),
                max_attempts: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let _pulled = qm.pull("fail-ack-race").await;

    let ack_success = Arc::new(AtomicBool::new(false));
    let fail_success = Arc::new(AtomicBool::new(false));

    let qm1 = qm.clone();
    let ack_flag = ack_success.clone();
    let job_id = job.id;
    let ack_handle = tokio::spawn(async move {
        if qm1.ack(job_id, None).await.is_ok() {
            ack_flag.store(true, Ordering::Relaxed);
        }
    });

    let qm2 = qm.clone();
    let fail_flag = fail_success.clone();
    let fail_handle = tokio::spawn(async move {
        if qm2.fail(job_id, None).await.is_ok() {
            fail_flag.store(true, Ordering::Relaxed);
        }
    });

    ack_handle.await.unwrap();
    fail_handle.await.unwrap();

    let ack = ack_success.load(Ordering::Relaxed);
    let fail = fail_success.load(Ordering::Relaxed);

    assert!(
        ack ^ fail,
        "Exactly one operation should succeed: ack={}, fail={}",
        ack,
        fail
    );
}

/// Test: Progress update after completion should fail.
#[tokio::test]
async fn test_progress_after_completion() {
    let qm = setup();

    let job = qm
        .push("progress-test".into(), job(json!({})))
        .await
        .unwrap();
    let _pulled = qm.pull("progress-test").await;
    qm.ack(job.id, None).await.unwrap();

    let result = qm
        .update_progress(job.id, 50, Some("halfway".to_string()))
        .await;
    assert!(result.is_err(), "Progress on completed job should fail");
}

/// Test: Move to delayed + pull race.
#[tokio::test]
async fn test_move_delayed_pull_race() {
    let qm = setup();

    for i in 0..50 {
        let _ = qm.push("delay-race".into(), job(json!({"i": i}))).await;
    }

    let moved = Arc::new(AtomicUsize::new(0));
    let pulled = Arc::new(AtomicUsize::new(0));

    let result = timeout(Duration::from_secs(3), async {
        let mut handles = vec![];

        let qm1 = qm.clone();
        let counter = moved.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                let jobs = qm1.pull_batch_nowait("delay-race", 1).await;
                for job in jobs {
                    if qm1.move_to_delayed(job.id, 10000).await.is_ok() {
                        counter.fetch_add(1, Ordering::Relaxed);
                    }
                }
                tokio::task::yield_now().await;
            }
        }));

        let qm2 = qm.clone();
        let counter = pulled.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..100 {
                let jobs = qm2.pull_batch_nowait("delay-race", 5).await;
                counter.fetch_add(jobs.len(), Ordering::Relaxed);
                tokio::task::yield_now().await;
            }
        }));

        for h in handles {
            let _ = h.await;
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK: move_to_delayed + pull");
}
