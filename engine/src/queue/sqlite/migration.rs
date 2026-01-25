//! SQLite database migrations for flashQ.

use rusqlite::Connection;
use tracing::info;

/// Run a migration inside a transaction for atomicity.
/// If any statement fails, the entire migration is rolled back.
fn run_migration(
    conn: &Connection,
    name: &str,
    statements: &[&str],
) -> Result<(), rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;

    for stmt in statements {
        tx.execute_batch(stmt)?;
    }

    // Record migration as applied
    tx.execute(
        "INSERT INTO migrations (name, applied_at) VALUES (?1, strftime('%s', 'now'))",
        [name],
    )?;

    tx.commit()
}

/// Run all database migrations.
pub fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Create migrations table to track applied migrations
    conn.execute(
        "CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            applied_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Check which migrations have been applied
    let applied: Vec<String> = {
        let mut stmt = conn.prepare("SELECT name FROM migrations")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let mut applied_count = 0;

    // Migration 1: Create jobs table
    if !applied.contains(&"001_create_jobs".to_string()) {
        run_migration(
            conn,
            "001_create_jobs",
            &[
                "CREATE TABLE jobs (
                    id INTEGER PRIMARY KEY,
                    queue TEXT NOT NULL,
                    data TEXT NOT NULL,
                    priority INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    run_at INTEGER NOT NULL,
                    started_at INTEGER,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    max_attempts INTEGER NOT NULL DEFAULT 3,
                    backoff INTEGER NOT NULL DEFAULT 1000,
                    ttl INTEGER,
                    timeout INTEGER,
                    unique_key TEXT,
                    depends_on TEXT,
                    progress INTEGER DEFAULT 0,
                    progress_msg TEXT,
                    tags TEXT,
                    state TEXT NOT NULL DEFAULT 'waiting',
                    lifo INTEGER NOT NULL DEFAULT 0
                )",
                "CREATE INDEX idx_jobs_queue_state ON jobs(queue, state)",
                "CREATE INDEX idx_jobs_run_at ON jobs(run_at)",
                "CREATE INDEX idx_jobs_unique_key ON jobs(unique_key) WHERE unique_key IS NOT NULL",
            ],
        )?;
        applied_count += 1;
    }

    // Migration 2: Create job_results table
    if !applied.contains(&"002_create_job_results".to_string()) {
        run_migration(
            conn,
            "002_create_job_results",
            &["CREATE TABLE job_results (
                    job_id INTEGER PRIMARY KEY,
                    result TEXT,
                    completed_at INTEGER NOT NULL
                )"],
        )?;
        applied_count += 1;
    }

    // Migration 3: Create dlq_jobs table
    if !applied.contains(&"003_create_dlq_jobs".to_string()) {
        run_migration(
            conn,
            "003_create_dlq_jobs",
            &[
                "CREATE TABLE dlq_jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id INTEGER NOT NULL,
                    queue TEXT NOT NULL,
                    data TEXT NOT NULL,
                    error TEXT,
                    failed_at INTEGER NOT NULL,
                    attempts INTEGER NOT NULL
                )",
                "CREATE INDEX idx_dlq_queue ON dlq_jobs(queue)",
            ],
        )?;
        applied_count += 1;
    }

    // Migration 4: Create cron_jobs table
    if !applied.contains(&"004_create_cron_jobs".to_string()) {
        run_migration(
            conn,
            "004_create_cron_jobs",
            &["CREATE TABLE cron_jobs (
                    name TEXT PRIMARY KEY,
                    queue TEXT NOT NULL,
                    data TEXT NOT NULL,
                    schedule TEXT,
                    repeat_every INTEGER,
                    priority INTEGER NOT NULL DEFAULT 0,
                    next_run INTEGER NOT NULL,
                    executions INTEGER NOT NULL DEFAULT 0,
                    max_limit INTEGER
                )"],
        )?;
        applied_count += 1;
    }

    // Migration 5: Create webhooks table
    if !applied.contains(&"005_create_webhooks".to_string()) {
        run_migration(
            conn,
            "005_create_webhooks",
            &["CREATE TABLE webhooks (
                    id TEXT PRIMARY KEY,
                    url TEXT NOT NULL,
                    events TEXT NOT NULL,
                    queue TEXT,
                    secret TEXT,
                    created_at INTEGER NOT NULL
                )"],
        )?;
        applied_count += 1;
    }

    // Migration 6: Add missing columns for flows and custom_id
    if !applied.contains(&"006_add_flow_columns".to_string()) {
        run_migration(
            conn,
            "006_add_flow_columns",
            &[
                "ALTER TABLE jobs ADD COLUMN custom_id TEXT",
                "ALTER TABLE jobs ADD COLUMN parent_id INTEGER",
                "ALTER TABLE jobs ADD COLUMN children_ids TEXT",
                "ALTER TABLE jobs ADD COLUMN children_completed INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE jobs ADD COLUMN group_id TEXT",
                "ALTER TABLE jobs ADD COLUMN keep_completed_age INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE jobs ADD COLUMN keep_completed_count INTEGER NOT NULL DEFAULT 0",
                "CREATE INDEX idx_jobs_custom_id ON jobs(custom_id) WHERE custom_id IS NOT NULL",
                "CREATE INDEX idx_jobs_parent_id ON jobs(parent_id) WHERE parent_id IS NOT NULL",
                "CREATE INDEX idx_jobs_group_id ON jobs(group_id) WHERE group_id IS NOT NULL",
            ],
        )?;
        applied_count += 1;
    }

    // Migration 7: Add index on dlq_jobs.job_id for faster lookups
    if !applied.contains(&"007_add_dlq_job_id_index".to_string()) {
        run_migration(
            conn,
            "007_add_dlq_job_id_index",
            &["CREATE INDEX idx_dlq_job_id ON dlq_jobs(job_id)"],
        )?;
        applied_count += 1;
    }

    // Migration 8: Create queue_state table for persisting pause/rate_limit/concurrency
    if !applied.contains(&"008_create_queue_state".to_string()) {
        run_migration(
            conn,
            "008_create_queue_state",
            &["CREATE TABLE queue_state (
                    queue TEXT PRIMARY KEY,
                    paused INTEGER NOT NULL DEFAULT 0,
                    rate_limit_max INTEGER,
                    concurrency_limit INTEGER
                )"],
        )?;
        applied_count += 1;
    }

    if applied_count > 0 {
        info!(count = applied_count, "Applied SQLite migrations");
    }

    Ok(())
}
