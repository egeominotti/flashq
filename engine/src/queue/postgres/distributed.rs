//! Distributed pull operations using SELECT FOR UPDATE SKIP LOCKED.

use std::sync::Arc;

use sqlx::{PgPool, Row};

use crate::protocol::Job;

/// Pull a single job atomically using SELECT FOR UPDATE SKIP LOCKED.
/// This prevents duplicate job processing across cluster nodes.
/// Returns the job and updates its state to 'active' in a single atomic operation.
pub async fn pull_job_distributed(
    pool: &PgPool,
    queue: &str,
    now_ms: i64,
) -> Result<Option<Job>, sqlx::Error> {
    // Single atomic operation: SELECT + UPDATE in one query
    // FOR UPDATE SKIP LOCKED ensures no two nodes can claim the same job
    let row = sqlx::query(
        r#"
        WITH selected AS (
            SELECT id FROM jobs
            WHERE queue = $1
              AND state = 'waiting'
              AND run_at <= $2
            ORDER BY
                priority DESC,
                CASE WHEN lifo THEN created_at END DESC,
                CASE WHEN NOT lifo THEN run_at END ASC,
                CASE WHEN NOT lifo THEN id END ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        UPDATE jobs SET
            state = 'active',
            started_at = $2
        WHERE id = (SELECT id FROM selected)
        RETURNING
            id, queue, data, priority, created_at, run_at, started_at,
            attempts, max_attempts, backoff, ttl, timeout, unique_key,
            depends_on, progress, progress_msg, tags, lifo
        "#,
    )
    .bind(queue)
    .bind(now_ms)
    .fetch_optional(pool)
    .await?;

    match row {
        Some(row) => {
            let depends_on: Vec<i64> = row.get("depends_on");
            Ok(Some(Job {
                id: row.get::<i64, _>("id") as u64,
                queue: row.get("queue"),
                data: Arc::new(row.get("data")),
                priority: row.get("priority"),
                created_at: row.get::<i64, _>("created_at") as u64,
                run_at: row.get::<i64, _>("run_at") as u64,
                started_at: row.get::<i64, _>("started_at") as u64,
                attempts: row.get::<i32, _>("attempts") as u32,
                max_attempts: row.get::<i32, _>("max_attempts") as u32,
                backoff: row.get::<i64, _>("backoff") as u64,
                ttl: row.get::<i64, _>("ttl") as u64,
                timeout: row.get::<i64, _>("timeout") as u64,
                unique_key: row.get("unique_key"),
                depends_on: depends_on.into_iter().map(|x| x as u64).collect(),
                progress: row.get::<i16, _>("progress") as u8,
                progress_msg: row.get("progress_msg"),
                tags: row.get("tags"),
                lifo: row.get("lifo"),
                // Default values for fields not in DB
                remove_on_complete: false,
                remove_on_fail: false,
                last_heartbeat: now_ms as u64,
                stall_timeout: 0,
                stall_count: 0,
                parent_id: None,
                children_ids: Vec::new(),
                children_completed: 0,
                custom_id: None,
                keep_completed_age: 0,
                keep_completed_count: 0,
                completed_at: 0,
                group_id: None,
            }))
        }
        None => Ok(None),
    }
}

/// Pull multiple jobs atomically using SELECT FOR UPDATE SKIP LOCKED.
/// Batch version of pull_job_distributed for better performance.
pub async fn pull_jobs_distributed_batch(
    pool: &PgPool,
    queue: &str,
    count: i32,
    now_ms: i64,
) -> Result<Vec<Job>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        WITH selected AS (
            SELECT id FROM jobs
            WHERE queue = $1
              AND state = 'waiting'
              AND run_at <= $3
            ORDER BY
                priority DESC,
                CASE WHEN lifo THEN created_at END DESC,
                CASE WHEN NOT lifo THEN run_at END ASC,
                CASE WHEN NOT lifo THEN id END ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED
        )
        UPDATE jobs SET
            state = 'active',
            started_at = $3
        WHERE id IN (SELECT id FROM selected)
        RETURNING
            id, queue, data, priority, created_at, run_at, started_at,
            attempts, max_attempts, backoff, ttl, timeout, unique_key,
            depends_on, progress, progress_msg, tags, lifo
        "#,
    )
    .bind(queue)
    .bind(count)
    .bind(now_ms)
    .fetch_all(pool)
    .await?;

    let jobs = rows
        .into_iter()
        .map(|row| {
            let depends_on: Vec<i64> = row.get("depends_on");
            Job {
                id: row.get::<i64, _>("id") as u64,
                queue: row.get("queue"),
                data: Arc::new(row.get("data")),
                priority: row.get("priority"),
                created_at: row.get::<i64, _>("created_at") as u64,
                run_at: row.get::<i64, _>("run_at") as u64,
                started_at: row.get::<i64, _>("started_at") as u64,
                attempts: row.get::<i32, _>("attempts") as u32,
                max_attempts: row.get::<i32, _>("max_attempts") as u32,
                backoff: row.get::<i64, _>("backoff") as u64,
                ttl: row.get::<i64, _>("ttl") as u64,
                timeout: row.get::<i64, _>("timeout") as u64,
                unique_key: row.get("unique_key"),
                depends_on: depends_on.into_iter().map(|x| x as u64).collect(),
                progress: row.get::<i16, _>("progress") as u8,
                progress_msg: row.get("progress_msg"),
                tags: row.get("tags"),
                lifo: row.get("lifo"),
                remove_on_complete: false,
                remove_on_fail: false,
                last_heartbeat: now_ms as u64,
                stall_timeout: 0,
                stall_count: 0,
                parent_id: None,
                children_ids: Vec::new(),
                children_completed: 0,
                custom_id: None,
                keep_completed_age: 0,
                keep_completed_count: 0,
                completed_at: 0,
                group_id: None,
            }
        })
        .collect();

    Ok(jobs)
}

/// Load jobs in a range by IDs (for batch sync).
pub async fn load_jobs_by_queue_since(
    pool: &PgPool,
    queue: &str,
    min_id: u64,
    limit: i64,
) -> Result<Vec<(Job, String)>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT id, queue, data, priority, created_at, run_at, started_at, attempts,
               max_attempts, backoff, ttl, timeout, unique_key, depends_on, progress,
               progress_msg, tags, state, lifo
        FROM jobs
        WHERE queue = $1 AND id >= $2 AND state IN ('waiting', 'delayed')
        ORDER BY id ASC
        LIMIT $3
    "#,
    )
    .bind(queue)
    .bind(min_id as i64)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let mut jobs = Vec::with_capacity(rows.len());
    for row in rows {
        let depends_on: Vec<i64> = row.get("depends_on");
        let job = Job {
            id: row.get::<i64, _>("id") as u64,
            queue: row.get("queue"),
            data: Arc::new(row.get("data")),
            priority: row.get("priority"),
            created_at: row.get::<i64, _>("created_at") as u64,
            run_at: row.get::<i64, _>("run_at") as u64,
            started_at: row.get::<i64, _>("started_at") as u64,
            attempts: row.get::<i32, _>("attempts") as u32,
            max_attempts: row.get::<i32, _>("max_attempts") as u32,
            backoff: row.get::<i64, _>("backoff") as u64,
            ttl: row.get::<i64, _>("ttl") as u64,
            timeout: row.get::<i64, _>("timeout") as u64,
            unique_key: row.get("unique_key"),
            depends_on: depends_on.into_iter().map(|x| x as u64).collect(),
            progress: row.get::<i16, _>("progress") as u8,
            progress_msg: row.get("progress_msg"),
            tags: row.get("tags"),
            lifo: row.get("lifo"),
            remove_on_complete: false,
            remove_on_fail: false,
            last_heartbeat: 0,
            stall_timeout: 0,
            stall_count: 0,
            parent_id: None,
            children_ids: Vec::new(),
            children_completed: 0,
            custom_id: None,
            keep_completed_age: 0,
            keep_completed_count: 0,
            completed_at: 0,
            group_id: None,
        };
        let state: String = row.get("state");
        jobs.push((job, state));
    }

    Ok(jobs)
}
