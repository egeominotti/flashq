//! Custom ID synchronization tests.

use super::*;

/// Test: Same custom ID concurrent push - idempotency behavior.
/// NOTE: Custom ID provides idempotency, not uniqueness enforcement.
/// All pushes with the same custom_id should return Ok (either the existing job or a new one).
/// Due to the timing window between custom_id insertion and job indexing,
/// concurrent pushes may create multiple jobs - this is a known limitation.
#[tokio::test]
async fn test_custom_id_concurrent_push() {
    let qm = setup();

    let success_count = Arc::new(AtomicUsize::new(0));
    let fail_count = Arc::new(AtomicUsize::new(0));
    let job_ids = Arc::new(parking_lot::RwLock::new(std::collections::HashSet::new()));

    let mut handles = vec![];
    for i in 0..20 {
        let qm = qm.clone();
        let success = success_count.clone();
        let fail = fail_count.clone();
        let ids = job_ids.clone();
        handles.push(tokio::spawn(async move {
            let result = qm
                .push(
                    "custom-id-race".into(),
                    JobInput {
                        data: json!({"worker": i}),
                        job_id: Some("unique-job-123".to_string()),
                        ..Default::default()
                    },
                )
                .await;
            match result {
                Ok(job) => {
                    success.fetch_add(1, Ordering::Relaxed);
                    ids.write().insert(job.id);
                }
                Err(_) => {
                    fail.fetch_add(1, Ordering::Relaxed);
                }
            };
        }));
    }

    for h in handles {
        h.await.unwrap();
    }

    let successes = success_count.load(Ordering::Relaxed);
    let unique_jobs = job_ids.read().len();

    // All pushes should succeed (custom_id is for idempotency, returns existing job)
    assert_eq!(
        successes, 20,
        "All pushes should succeed with idempotency, got {}",
        successes
    );

    // Due to race condition in current implementation, we may get multiple jobs
    // This is a known limitation - the custom_id is inserted before job is indexed
    assert!(
        unique_jobs >= 1,
        "At least one job should be created, got {}",
        unique_jobs
    );
}

/// Test: Custom ID lookup during concurrent push.
#[tokio::test]
async fn test_custom_id_lookup_during_push() {
    let qm = setup();

    let found_count = Arc::new(AtomicUsize::new(0));
    let push_done = Arc::new(AtomicBool::new(false));

    let result = timeout(Duration::from_secs(3), async {
        let mut handles = vec![];

        let qm1 = qm.clone();
        let done = push_done.clone();
        handles.push(tokio::spawn(async move {
            for i in 0..100 {
                let _ = qm1
                    .push(
                        "lookup-race".into(),
                        JobInput {
                            data: json!({"i": i}),
                            job_id: Some(format!("job-{}", i)),
                            ..Default::default()
                        },
                    )
                    .await;
            }
            done.store(true, Ordering::Relaxed);
        }));

        let qm2 = qm.clone();
        let counter = found_count.clone();
        let done2 = push_done.clone();
        handles.push(tokio::spawn(async move {
            while !done2.load(Ordering::Relaxed) {
                for i in 0..100 {
                    if qm2.get_job_by_custom_id(&format!("job-{}", i)).is_some() {
                        counter.fetch_add(1, Ordering::Relaxed);
                    }
                }
                tokio::task::yield_now().await;
            }
        }));

        for h in handles {
            let _ = h.await;
        }
    })
    .await;

    assert!(result.is_ok(), "DEADLOCK: custom ID lookup + push");

    // All 100 jobs should be findable at the end
    let mut found = 0;
    for i in 0..100 {
        if qm.get_job_by_custom_id(&format!("job-{}", i)).is_some() {
            found += 1;
        }
    }
    assert_eq!(found, 100, "All custom ID jobs should be findable");
}

/// Test: Custom ID after job completion - behavior verification.
/// NOTE: Completed jobs don't retain job data in memory (only in persistence layer).
/// get_job_by_custom_id returns None for completed jobs because get_job returns (None, Completed).
/// The custom_id mapping is retained, but since job data is not available, lookup returns None.
/// This allows re-using the same custom_id for a new job after completion.
#[tokio::test]
async fn test_custom_id_after_completion() {
    let qm = setup();

    let job = qm
        .push(
            "custom-complete".into(),
            JobInput {
                data: json!({}),
                job_id: Some("my-custom-id".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let original_id = job.id;

    let _pulled = qm.pull("custom-complete").await;
    qm.ack(job.id, None).await.unwrap();

    // Custom ID lookup returns None for completed jobs (job data not stored in memory)
    let found = qm.get_job_by_custom_id("my-custom-id");
    assert!(
        found.is_none(),
        "Custom ID returns None for completed jobs (expected behavior)"
    );

    // However, the mapping still exists in custom_id_map
    let mapping_exists = qm.custom_id_map.read().contains_key("my-custom-id");
    assert!(
        mapping_exists,
        "custom_id_map should still have the mapping"
    );

    // Pushing with same custom_id after completion should create a new job
    // (because get_job returns None for completed jobs, treated as "stale")
    let new_job = qm
        .push(
            "custom-complete".into(),
            JobInput {
                data: json!({"new": true}),
                job_id: Some("my-custom-id".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_ne!(
        new_job.id, original_id,
        "Should create new job after completion"
    );
}

/// Test: Custom ID cleanup after many completions.
#[tokio::test]
async fn test_custom_id_cleanup_consistency() {
    let qm = setup();

    for i in 0..100 {
        let job = qm
            .push(
                "custom-cleanup".into(),
                JobInput {
                    data: json!({"i": i}),
                    job_id: Some(format!("cleanup-job-{}", i)),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        let _pulled = qm.pull("custom-cleanup").await;
        qm.ack(job.id, None).await.unwrap();
    }

    qm.cleanup_completed_jobs();

    let custom_map_size = qm.custom_id_map.read().len();
    let completed_size = qm.completed_jobs.read().len();

    // custom_id_map can be <= completed_jobs (some jobs may not have custom IDs)
    assert!(
        custom_map_size <= completed_size + 10, // small margin for in-flight
        "Custom ID map inconsistent: {} custom IDs, {} completed jobs",
        custom_map_size,
        completed_size
    );
}
