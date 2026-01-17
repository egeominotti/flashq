//! Database migration operations.

use sqlx::PgPool;

/// Run database migrations.
pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    // Create job_id sequence for globally unique IDs across cluster
    sqlx::query("CREATE SEQUENCE IF NOT EXISTS job_id_seq")
        .execute(pool)
        .await
        .ok();

    // Create tables if they don't exist
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS jobs (
            id BIGINT PRIMARY KEY,
            queue VARCHAR(255) NOT NULL,
            data JSONB NOT NULL,
            priority INT NOT NULL DEFAULT 0,
            created_at BIGINT NOT NULL,
            run_at BIGINT NOT NULL,
            started_at BIGINT NOT NULL DEFAULT 0,
            attempts INT NOT NULL DEFAULT 0,
            max_attempts INT NOT NULL DEFAULT 0,
            backoff BIGINT NOT NULL DEFAULT 0,
            ttl BIGINT NOT NULL DEFAULT 0,
            timeout BIGINT NOT NULL DEFAULT 0,
            unique_key VARCHAR(255),
            depends_on BIGINT[] NOT NULL DEFAULT '{}',
            progress SMALLINT NOT NULL DEFAULT 0,
            progress_msg TEXT,
            tags TEXT[] NOT NULL DEFAULT '{}',
            state VARCHAR(32) NOT NULL DEFAULT 'waiting',
            lifo BOOLEAN NOT NULL DEFAULT FALSE
        )
    "#,
    )
    .execute(pool)
    .await?;

    // Add lifo column for existing databases
    sqlx::query(
        r#"
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lifo BOOLEAN NOT NULL DEFAULT FALSE
    "#,
    )
    .execute(pool)
    .await
    .ok();

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_jobs_queue_state ON jobs(queue, state)
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_jobs_run_at ON jobs(run_at) WHERE state IN ('waiting', 'delayed')
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS job_results (
            job_id BIGINT PRIMARY KEY,
            result JSONB NOT NULL,
            completed_at BIGINT NOT NULL
        )
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS dlq_jobs (
            id BIGSERIAL PRIMARY KEY,
            job_id BIGINT NOT NULL,
            queue VARCHAR(255) NOT NULL,
            data JSONB NOT NULL,
            error TEXT,
            failed_at BIGINT NOT NULL,
            attempts INT NOT NULL
        )
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_dlq_queue ON dlq_jobs(queue)
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS cron_jobs (
            name VARCHAR(255) PRIMARY KEY,
            queue VARCHAR(255) NOT NULL,
            data JSONB NOT NULL,
            schedule VARCHAR(255) NOT NULL,
            priority INT NOT NULL DEFAULT 0,
            next_run BIGINT NOT NULL
        )
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS webhooks (
            id VARCHAR(255) PRIMARY KEY,
            url TEXT NOT NULL,
            events TEXT[] NOT NULL,
            queue VARCHAR(255),
            secret VARCHAR(255),
            created_at BIGINT NOT NULL
        )
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS queue_config (
            queue VARCHAR(255) PRIMARY KEY,
            paused BOOLEAN NOT NULL DEFAULT FALSE,
            rate_limit INT,
            concurrency_limit INT
        )
    "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}
