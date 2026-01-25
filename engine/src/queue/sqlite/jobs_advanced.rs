//! Advanced SQLite job operations (cron, webhooks, queue management).

use rusqlite::{params, Connection};
use serde_json::Value;

use crate::protocol::{CronJob, WebhookConfig};

// ============== Cron Jobs ==============

/// Save a cron job.
pub fn save_cron(conn: &Connection, cron: &CronJob) -> Result<(), rusqlite::Error> {
    let data = serde_json::to_string(&cron.data).unwrap_or_default();
    let schedule = cron.schedule.clone();
    let repeat_every = cron.repeat_every;

    conn.execute(
        "INSERT OR REPLACE INTO cron_jobs (name, queue, data, schedule, repeat_every, priority, next_run, executions, max_limit)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            cron.name,
            cron.queue,
            data,
            schedule,
            repeat_every.map(|v| v as i64),
            cron.priority,
            cron.next_run as i64,
            cron.executions as i64,
            cron.limit.map(|v| v as i64),
        ],
    )?;
    Ok(())
}

/// Delete a cron job.
pub fn delete_cron(conn: &Connection, name: &str) -> Result<bool, rusqlite::Error> {
    let rows = conn.execute("DELETE FROM cron_jobs WHERE name = ?1", params![name])?;
    Ok(rows > 0)
}

/// Load all cron jobs.
pub fn load_crons(conn: &Connection) -> Result<Vec<CronJob>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT name, queue, data, schedule, repeat_every, priority, next_run, executions, max_limit FROM cron_jobs"
    )?;

    let rows = stmt.query_map([], |row| {
        let name: String = row.get(0)?;
        let queue: String = row.get(1)?;
        let data_str: String = row.get(2)?;
        let schedule: Option<String> = row.get(3)?;
        let repeat_every: Option<i64> = row.get(4)?;
        let priority: i32 = row.get(5)?;
        let next_run: i64 = row.get(6)?;
        let executions: i64 = row.get(7)?;
        let limit: Option<i64> = row.get(8)?;

        let data: Value = serde_json::from_str(&data_str).unwrap_or(Value::Null);

        Ok(CronJob {
            name,
            queue,
            data,
            schedule,
            repeat_every: repeat_every.map(|v| v as u64),
            priority,
            next_run: next_run as u64,
            executions: executions as u64,
            limit: limit.map(|v| v as u64),
        })
    })?;

    rows.collect()
}

/// Update cron next_run time.
pub fn update_cron_next_run(
    conn: &Connection,
    name: &str,
    next_run: u64,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE cron_jobs SET next_run = ?2 WHERE name = ?1",
        params![name, next_run as i64],
    )?;
    Ok(())
}

// ============== Webhooks ==============

/// Save a webhook.
pub fn save_webhook(conn: &Connection, webhook: &WebhookConfig) -> Result<(), rusqlite::Error> {
    let events = serde_json::to_string(&webhook.events).unwrap_or_default();

    conn.execute(
        "INSERT OR REPLACE INTO webhooks (id, url, events, queue, secret, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            webhook.id,
            webhook.url,
            events,
            webhook.queue,
            webhook.secret,
            webhook.created_at as i64
        ],
    )?;
    Ok(())
}

/// Delete a webhook.
pub fn delete_webhook(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
    let rows = conn.execute("DELETE FROM webhooks WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

/// Load all webhooks.
pub fn load_webhooks(conn: &Connection) -> Result<Vec<WebhookConfig>, rusqlite::Error> {
    let mut stmt =
        conn.prepare("SELECT id, url, events, queue, secret, created_at FROM webhooks")?;

    let rows = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let url: String = row.get(1)?;
        let events_str: String = row.get(2)?;
        let queue: Option<String> = row.get(3)?;
        let secret: Option<String> = row.get(4)?;
        let created_at: i64 = row.get(5)?;

        let events: Vec<String> = serde_json::from_str(&events_str).unwrap_or_default();

        Ok(WebhookConfig {
            id,
            url,
            events,
            queue,
            secret,
            created_at: created_at as u64,
        })
    })?;

    rows.collect()
}

// ============== Queue Management ==============

/// Drain all waiting jobs from a queue.
pub fn drain_queue(conn: &Connection, queue: &str) -> Result<u64, rusqlite::Error> {
    let rows = conn.execute(
        "DELETE FROM jobs WHERE queue = ?1 AND state = 'waiting'",
        params![queue],
    )?;
    Ok(rows as u64)
}

/// Obliterate all data for a queue (jobs, DLQ, cron, queue state).
pub fn obliterate_queue(conn: &Connection, queue: &str) -> Result<u64, rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;
    let jobs_deleted = tx.execute("DELETE FROM jobs WHERE queue = ?1", params![queue])? as u64;
    tx.execute("DELETE FROM dlq_jobs WHERE queue = ?1", params![queue])?;
    tx.execute("DELETE FROM cron_jobs WHERE queue = ?1", params![queue])?;
    tx.execute("DELETE FROM queue_state WHERE queue = ?1", params![queue])?;
    tx.commit()?;
    Ok(jobs_deleted)
}

/// Change priority of a job.
pub fn change_priority(
    conn: &Connection,
    job_id: u64,
    priority: i32,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE jobs SET priority = ?2 WHERE id = ?1",
        params![job_id as i64, priority],
    )?;
    Ok(())
}

/// Move a job to delayed state.
pub fn move_to_delayed(conn: &Connection, job_id: u64, run_at: u64) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE jobs SET state = 'delayed', run_at = ?2 WHERE id = ?1",
        params![job_id as i64, run_at as i64],
    )?;
    Ok(())
}

/// Promote a delayed job to waiting.
pub fn promote_job(conn: &Connection, job_id: u64, run_at: u64) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE jobs SET state = 'waiting', run_at = ?2 WHERE id = ?1",
        params![job_id as i64, run_at as i64],
    )?;
    Ok(())
}

/// Update job data.
pub fn update_job_data(
    conn: &Connection,
    job_id: u64,
    data: &serde_json::Value,
) -> Result<(), rusqlite::Error> {
    let data_str = serde_json::to_string(data).unwrap_or_default();
    conn.execute(
        "UPDATE jobs SET data = ?2 WHERE id = ?1",
        params![job_id as i64, data_str],
    )?;
    Ok(())
}

/// Clean jobs by age and state.
pub fn clean_jobs(
    conn: &Connection,
    queue: &str,
    cutoff: u64,
    state: &str,
) -> Result<u64, rusqlite::Error> {
    let rows = conn.execute(
        "DELETE FROM jobs WHERE queue = ?1 AND state = ?2 AND created_at < ?3",
        params![queue, state, cutoff as i64],
    )?;
    Ok(rows as u64)
}

/// Discard a job by moving it to DLQ.
pub fn discard_job(conn: &Connection, job_id: u64) -> Result<(), rusqlite::Error> {
    let now = crate::queue::types::now_ms();
    let tx = conn.unchecked_transaction()?;

    // Get job data before deleting
    let job_data: Option<(String, String, u32)> = tx
        .query_row(
            "SELECT queue, data, attempts FROM jobs WHERE id = ?1",
            params![job_id as i64],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok();

    if let Some((queue, data, attempts)) = job_data {
        // Delete from jobs
        tx.execute("DELETE FROM jobs WHERE id = ?1", params![job_id as i64])?;

        // Insert into DLQ
        tx.execute(
            "INSERT INTO dlq_jobs (job_id, queue, data, error, failed_at, attempts) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![job_id as i64, queue, data, "Discarded by user", now as i64, attempts],
        )?;
    }

    tx.commit()
}

// ============== Queue State Persistence ==============

/// Queue state data for persistence
#[derive(Debug, Clone)]
pub struct PersistedQueueState {
    pub queue: String,
    pub paused: bool,
    pub rate_limit: Option<u32>,
    pub concurrency_limit: Option<u32>,
}

/// Save queue state (pause, rate limit, concurrency).
pub fn save_queue_state(
    conn: &Connection,
    state: &PersistedQueueState,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR REPLACE INTO queue_state (queue, paused, rate_limit_max, concurrency_limit)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            state.queue,
            state.paused as i32,
            state.rate_limit.map(|v| v as i64),
            state.concurrency_limit.map(|v| v as i64),
        ],
    )?;
    Ok(())
}

/// Load all queue states for recovery.
pub fn load_queue_states(conn: &Connection) -> Result<Vec<PersistedQueueState>, rusqlite::Error> {
    let mut stmt =
        conn.prepare("SELECT queue, paused, rate_limit_max, concurrency_limit FROM queue_state")?;

    let rows = stmt.query_map([], |row| {
        let queue: String = row.get(0)?;
        let paused: i32 = row.get(1)?;
        let rate_limit: Option<i64> = row.get(2)?;
        let concurrency_limit: Option<i64> = row.get(3)?;

        Ok(PersistedQueueState {
            queue,
            paused: paused != 0,
            rate_limit: rate_limit.map(|v| v as u32),
            concurrency_limit: concurrency_limit.map(|v| v as u32),
        })
    })?;

    rows.collect()
}
