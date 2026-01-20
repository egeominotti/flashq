//! SQLite database migrations for flashQ.

use rusqlite::Connection;
use tracing::info;

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
        conn.execute_batch(
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
            );

            CREATE INDEX idx_jobs_queue_state ON jobs(queue, state);
            CREATE INDEX idx_jobs_run_at ON jobs(run_at);
            CREATE INDEX idx_jobs_unique_key ON jobs(unique_key) WHERE unique_key IS NOT NULL;

            INSERT INTO migrations (name, applied_at) VALUES ('001_create_jobs', strftime('%s', 'now'));
            ",
        )?;
        applied_count += 1;
    }

    // Migration 2: Create job_results table
    if !applied.contains(&"002_create_job_results".to_string()) {
        conn.execute_batch(
            "CREATE TABLE job_results (
                job_id INTEGER PRIMARY KEY,
                result TEXT,
                completed_at INTEGER NOT NULL
            );

            INSERT INTO migrations (name, applied_at) VALUES ('002_create_job_results', strftime('%s', 'now'));
            ",
        )?;
        applied_count += 1;
    }

    // Migration 3: Create dlq_jobs table
    if !applied.contains(&"003_create_dlq_jobs".to_string()) {
        conn.execute_batch(
            "CREATE TABLE dlq_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER NOT NULL,
                queue TEXT NOT NULL,
                data TEXT NOT NULL,
                error TEXT,
                failed_at INTEGER NOT NULL,
                attempts INTEGER NOT NULL
            );

            CREATE INDEX idx_dlq_queue ON dlq_jobs(queue);

            INSERT INTO migrations (name, applied_at) VALUES ('003_create_dlq_jobs', strftime('%s', 'now'));
            ",
        )?;
        applied_count += 1;
    }

    // Migration 4: Create cron_jobs table
    if !applied.contains(&"004_create_cron_jobs".to_string()) {
        conn.execute_batch(
            "CREATE TABLE cron_jobs (
                name TEXT PRIMARY KEY,
                queue TEXT NOT NULL,
                data TEXT NOT NULL,
                schedule TEXT,
                repeat_every INTEGER,
                priority INTEGER NOT NULL DEFAULT 0,
                next_run INTEGER NOT NULL,
                executions INTEGER NOT NULL DEFAULT 0,
                max_limit INTEGER
            );

            INSERT INTO migrations (name, applied_at) VALUES ('004_create_cron_jobs', strftime('%s', 'now'));
            ",
        )?;
        applied_count += 1;
    }

    // Migration 5: Create webhooks table
    if !applied.contains(&"005_create_webhooks".to_string()) {
        conn.execute_batch(
            "CREATE TABLE webhooks (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                events TEXT NOT NULL,
                queue TEXT,
                secret TEXT,
                created_at INTEGER NOT NULL
            );

            INSERT INTO migrations (name, applied_at) VALUES ('005_create_webhooks', strftime('%s', 'now'));
            ",
        )?;
        applied_count += 1;
    }

    if applied_count > 0 {
        info!(count = applied_count, "Applied SQLite migrations");
    }

    Ok(())
}
