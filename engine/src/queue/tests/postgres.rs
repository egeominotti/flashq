//! PostgreSQL integration tests.
//!
//! These tests require a running PostgreSQL instance.
//! Run with: DATABASE_URL=postgres://... cargo test -- --ignored

use super::*;

#[tokio::test]
#[ignore = "Requires PostgreSQL - run with: DATABASE_URL=postgres://... cargo test -- --ignored"]
async fn test_postgres_migration() {
    let db_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");

    let storage = crate::queue::postgres::PostgresStorage::new(&db_url)
        .await
        .expect("Failed to connect to PostgreSQL");

    // Run migrations
    storage.migrate().await.expect("Migration failed");

    // Verify tables exist by querying them
    let result: (i64,) = sqlx::query_as::<sqlx::Postgres, (i64,)>("SELECT COUNT(*) FROM jobs")
        .fetch_one(storage.pool())
        .await
        .expect("Failed to query jobs table");

    assert!(result.0 >= 0);
}

#[tokio::test]
#[ignore = "Requires PostgreSQL - run with: DATABASE_URL=postgres://... cargo test -- --ignored"]
async fn test_postgres_job_persistence() {
    let db_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");

    // Create QueueManager with PostgreSQL
    let qm = QueueManager::with_postgres(&db_url).await;

    // Push a job
    let job = qm
        .push(
            "postgres-test".to_string(),
            json!({"persisted": true}),
            10,
            None,
            None,
            None,
            Some(3),
            None,
            Some("unique-pg-test".to_string()),
            None,
            Some(vec!["tag1".to_string(), "tag2".to_string()]),
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // group_id
        )
        .await
        .expect("Failed to push job");

    // Verify job is in database
    let storage = qm.storage.as_ref().expect("PostgreSQL not initialized");
    let db_job: Option<(i64, String, i32)> = sqlx::query_as::<sqlx::Postgres, (i64, String, i32)>(
        "SELECT id, queue, priority FROM jobs WHERE id = $1",
    )
    .bind(job.id as i64)
    .fetch_optional(storage.pool())
    .await
    .expect("Failed to query job");

    assert!(db_job.is_some());
    let (id, queue, priority) = db_job.unwrap();
    assert_eq!(id, job.id as i64);
    assert_eq!(queue, "postgres-test");
    assert_eq!(priority, 10);

    // Clean up
    sqlx::query("DELETE FROM jobs WHERE id = $1")
        .bind(job.id as i64)
        .execute(storage.pool())
        .await
        .ok();
}

#[tokio::test]
#[ignore = "Requires PostgreSQL - run with: DATABASE_URL=postgres://... cargo test -- --ignored"]
async fn test_postgres_job_state_transitions() {
    let db_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");

    let qm = QueueManager::with_postgres(&db_url).await;

    // Push job
    let job = qm
        .push(
            "state-test".to_string(),
            json!({}),
            0,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // group_id
        )
        .await
        .expect("Push failed");

    let storage = qm.storage.as_ref().unwrap();

    // Check initial state
    let state: (String,) =
        sqlx::query_as::<sqlx::Postgres, (String,)>("SELECT state FROM jobs WHERE id = $1")
            .bind(job.id as i64)
            .fetch_one(storage.pool())
            .await
            .expect("Query failed");
    assert_eq!(state.0, "waiting");

    // Pull job
    let _pulled = qm.pull("state-test").await;

    // Check active state
    let state: (String,) =
        sqlx::query_as::<sqlx::Postgres, (String,)>("SELECT state FROM jobs WHERE id = $1")
            .bind(job.id as i64)
            .fetch_one(storage.pool())
            .await
            .expect("Query failed");
    assert_eq!(state.0, "active");

    // Ack job
    qm.ack(job.id, Some(json!({"result": "done"})))
        .await
        .unwrap();

    // Check completed state
    let state: (String,) =
        sqlx::query_as::<sqlx::Postgres, (String,)>("SELECT state FROM jobs WHERE id = $1")
            .bind(job.id as i64)
            .fetch_one(storage.pool())
            .await
            .expect("Query failed");
    assert_eq!(state.0, "completed");

    // Clean up
    sqlx::query("DELETE FROM jobs WHERE id = $1")
        .bind(job.id as i64)
        .execute(storage.pool())
        .await
        .ok();
    sqlx::query("DELETE FROM job_results WHERE job_id = $1")
        .bind(job.id as i64)
        .execute(storage.pool())
        .await
        .ok();
}

#[tokio::test]
#[ignore = "Requires PostgreSQL - run with: DATABASE_URL=postgres://... cargo test -- --ignored"]
async fn test_postgres_cron_persistence() {
    let db_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");

    let qm = QueueManager::with_postgres(&db_url).await;

    // Add cron job
    let _ = qm
        .add_cron(
            "pg-cron-test".to_string(),
            "cron-queue".to_string(),
            json!({"cron": "persistent"}),
            "0 * * * * *".to_string(), // Every minute
            0,
        )
        .await;

    // Verify in database
    let storage = qm.storage.as_ref().unwrap();
    let cron: Option<(String, String)> = sqlx::query_as::<sqlx::Postgres, (String, String)>(
        "SELECT name, queue FROM cron_jobs WHERE name = $1",
    )
    .bind("pg-cron-test")
    .fetch_optional(storage.pool())
    .await
    .expect("Query failed");

    assert!(cron.is_some());
    let (name, queue) = cron.unwrap();
    assert_eq!(name, "pg-cron-test");
    assert_eq!(queue, "cron-queue");

    // Delete cron
    qm.delete_cron("pg-cron-test").await;

    // Verify deleted
    let cron: Option<(String,)> =
        sqlx::query_as::<sqlx::Postgres, (String,)>("SELECT name FROM cron_jobs WHERE name = $1")
            .bind("pg-cron-test")
            .fetch_optional(storage.pool())
            .await
            .expect("Query failed");

    assert!(cron.is_none());
}

#[tokio::test]
#[ignore = "Requires PostgreSQL - run with: DATABASE_URL=postgres://... cargo test -- --ignored"]
async fn test_postgres_unique_job_id_sequence() {
    let db_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");

    let qm = QueueManager::with_postgres(&db_url).await;

    // Get multiple job IDs
    let ids1 = qm.next_job_ids(10).await;
    let ids2 = qm.next_job_ids(10).await;

    // All IDs should be unique
    let mut all_ids: Vec<_> = ids1.into_iter().chain(ids2.into_iter()).collect();
    let original_len = all_ids.len();
    all_ids.sort();
    all_ids.dedup();

    assert_eq!(all_ids.len(), original_len, "All job IDs should be unique");
}
