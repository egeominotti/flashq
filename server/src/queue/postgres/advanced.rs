//! BullMQ-like advanced database operations.

use sqlx::PgPool;

/// Drain all waiting jobs from a queue (delete from DB).
pub async fn drain_queue(pool: &PgPool, queue: &str) -> Result<u64, sqlx::Error> {
    let result =
        sqlx::query("DELETE FROM jobs WHERE queue = $1 AND state IN ('waiting', 'delayed')")
            .bind(queue)
            .execute(pool)
            .await?;
    Ok(result.rows_affected())
}

/// Obliterate all data for a queue (delete everything).
pub async fn obliterate_queue(pool: &PgPool, queue: &str) -> Result<u64, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let mut total = 0u64;

    // Delete from jobs
    let r1 = sqlx::query("DELETE FROM jobs WHERE queue = $1")
        .bind(queue)
        .execute(&mut *tx)
        .await?;
    total += r1.rows_affected();

    // Delete from DLQ
    let r2 = sqlx::query("DELETE FROM dlq_jobs WHERE queue = $1")
        .bind(queue)
        .execute(&mut *tx)
        .await?;
    total += r2.rows_affected();

    // Delete cron jobs for this queue
    sqlx::query("DELETE FROM cron_jobs WHERE queue = $1")
        .bind(queue)
        .execute(&mut *tx)
        .await?;

    // Delete queue config
    sqlx::query("DELETE FROM queue_config WHERE queue = $1")
        .bind(queue)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(total)
}

/// Change priority of a job.
pub async fn change_priority(pool: &PgPool, job_id: u64, priority: i32) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE jobs SET priority = $1 WHERE id = $2")
        .bind(priority)
        .bind(job_id as i64)
        .execute(pool)
        .await?;
    Ok(())
}

/// Move a job to delayed state.
pub async fn move_to_delayed(pool: &PgPool, job_id: u64, run_at: u64) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE jobs SET state = 'delayed', run_at = $1, started_at = 0, progress = 0 WHERE id = $2",
    )
    .bind(run_at as i64)
    .bind(job_id as i64)
    .execute(pool)
    .await?;
    Ok(())
}

/// Clean jobs by age and state.
pub async fn clean_jobs(
    pool: &PgPool,
    queue: &str,
    cutoff: u64,
    state: &str,
) -> Result<u64, sqlx::Error> {
    let result =
        sqlx::query("DELETE FROM jobs WHERE queue = $1 AND state = $2 AND created_at < $3")
            .bind(queue)
            .bind(state)
            .bind(cutoff as i64)
            .execute(pool)
            .await?;

    // Also clean from DLQ if state is 'failed'
    if state == "failed" {
        sqlx::query("DELETE FROM dlq_jobs WHERE queue = $1 AND failed_at < $2")
            .bind(queue)
            .bind(cutoff as i64)
            .execute(pool)
            .await?;
    }

    Ok(result.rows_affected())
}

/// Promote a delayed job to waiting.
pub async fn promote_job(pool: &PgPool, job_id: u64, run_at: u64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE jobs SET run_at = $1, state = 'waiting' WHERE id = $2")
        .bind(run_at as i64)
        .bind(job_id as i64)
        .execute(pool)
        .await?;
    Ok(())
}

/// Update job data.
pub async fn update_job_data(
    pool: &PgPool,
    job_id: u64,
    data: &serde_json::Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE jobs SET data = $1 WHERE id = $2")
        .bind(data)
        .bind(job_id as i64)
        .execute(pool)
        .await?;
    Ok(())
}

/// Discard a job (move to DLQ).
pub async fn discard_job(pool: &PgPool, job_id: u64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE jobs SET state = 'failed' WHERE id = $1")
        .bind(job_id as i64)
        .execute(pool)
        .await?;
    Ok(())
}

/// Purge all jobs from DLQ for a queue.
pub async fn purge_dlq(pool: &PgPool, queue: &str) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM jobs WHERE queue = $1 AND state = 'failed'")
        .bind(queue)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}
