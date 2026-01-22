//! SQLite job operations for flashQ.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

use crate::protocol::Job;

/// Serialize a vector to JSON string if not empty, otherwise return None.
#[inline]
fn serialize_if_not_empty<T: Serialize>(v: &[T]) -> Option<String> {
    if v.is_empty() {
        None
    } else {
        Some(serde_json::to_string(v).unwrap_or_default())
    }
}

/// Insert or update a job.
pub fn insert_job(conn: &Connection, job: &Job, state: &str) -> Result<(), rusqlite::Error> {
    let data = serde_json::to_string(&*job.data).unwrap_or_default();
    let depends_on = serialize_if_not_empty(&job.depends_on);
    let tags = serialize_if_not_empty(&job.tags);
    let children_ids = serialize_if_not_empty(&job.children_ids);

    conn.execute(
        "INSERT INTO jobs (id, queue, data, priority, created_at, run_at, started_at, attempts,
            max_attempts, backoff, ttl, timeout, unique_key, depends_on, progress, progress_msg, tags, state, lifo,
            custom_id, parent_id, children_ids, children_completed, group_id, keep_completed_age, keep_completed_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26)
         ON CONFLICT(id) DO UPDATE SET
            state = excluded.state,
            run_at = excluded.run_at,
            started_at = excluded.started_at,
            attempts = excluded.attempts,
            progress = excluded.progress,
            progress_msg = excluded.progress_msg,
            children_completed = excluded.children_completed",
        params![
            job.id as i64,
            job.queue,
            data,
            job.priority,
            job.created_at as i64,
            job.run_at as i64,
            if job.started_at > 0 { Some(job.started_at as i64) } else { None },
            job.attempts,
            job.max_attempts,
            job.backoff as i64,
            if job.ttl > 0 { Some(job.ttl as i64) } else { None },
            if job.timeout > 0 { Some(job.timeout as i64) } else { None },
            job.unique_key,
            depends_on,
            job.progress as i32,
            job.progress_msg,
            tags,
            state,
            job.lifo as i32,
            job.custom_id,
            job.parent_id.map(|id| id as i64),
            children_ids,
            job.children_completed as i32,
            job.group_id,
            job.keep_completed_age as i64,
            job.keep_completed_count as i32,
        ],
    )?;
    Ok(())
}

/// Insert multiple jobs in a batch.
pub fn insert_jobs_batch(
    conn: &Connection,
    jobs: &[Job],
    state: &str,
) -> Result<(), rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;
    for job in jobs {
        insert_job(&tx, job, state)?;
    }
    tx.commit()
}

/// Acknowledge a job as completed.
pub fn ack_job(
    conn: &Connection,
    job_id: u64,
    result: Option<Value>,
) -> Result<(), rusqlite::Error> {
    let now = crate::queue::types::now_ms();
    conn.execute("DELETE FROM jobs WHERE id = ?1", params![job_id as i64])?;
    if let Some(res) = result {
        let result_str = serde_json::to_string(&res).unwrap_or_default();
        conn.execute(
            "INSERT OR REPLACE INTO job_results (job_id, result, completed_at) VALUES (?1, ?2, ?3)",
            params![job_id as i64, result_str, now as i64],
        )?;
    }
    Ok(())
}

/// Acknowledge multiple jobs in a batch.
pub fn ack_jobs_batch(conn: &Connection, ids: &[u64]) -> Result<(), rusqlite::Error> {
    if ids.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    for &id in ids {
        tx.execute("DELETE FROM jobs WHERE id = ?1", params![id as i64])?;
    }
    tx.commit()
}

/// Mark job as failed and update for retry.
pub fn fail_job(
    conn: &Connection,
    job_id: u64,
    new_run_at: u64,
    attempts: u32,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE jobs SET state = 'waiting', run_at = ?2, attempts = ?3, started_at = NULL WHERE id = ?1",
        params![job_id as i64, new_run_at as i64, attempts],
    )?;
    Ok(())
}

/// Move job to DLQ.
pub fn move_to_dlq(
    conn: &Connection,
    job: &Job,
    error: Option<&str>,
) -> Result<(), rusqlite::Error> {
    let now = crate::queue::types::now_ms();
    let data = serde_json::to_string(&*job.data).unwrap_or_default();
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM jobs WHERE id = ?1", params![job.id as i64])?;
    tx.execute(
        "INSERT INTO dlq_jobs (job_id, queue, data, error, failed_at, attempts) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![job.id as i64, job.queue, data, error, now as i64, job.attempts],
    )?;
    tx.commit()
}

/// Cancel a job.
pub fn cancel_job(conn: &Connection, job_id: u64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM jobs WHERE id = ?1", params![job_id as i64])?;
    Ok(())
}

/// Delete a job (for remove_on_complete - no result storage).
pub fn delete_job(conn: &Connection, job_id: u64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM jobs WHERE id = ?1", params![job_id as i64])?;
    Ok(())
}

/// Delete multiple jobs in a batch (for remove_on_complete batch).
pub fn delete_jobs_batch(conn: &Connection, ids: &[u64]) -> Result<(), rusqlite::Error> {
    if ids.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    for &id in ids {
        tx.execute("DELETE FROM jobs WHERE id = ?1", params![id as i64])?;
    }
    tx.commit()
}

/// Load all pending jobs for recovery.
pub fn load_pending_jobs(conn: &Connection) -> Result<Vec<(Job, String)>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, queue, data, priority, created_at, run_at, started_at, attempts, max_attempts,
                backoff, ttl, timeout, unique_key, depends_on, progress, progress_msg, tags, state, lifo,
                custom_id, parent_id, children_ids, children_completed, group_id, keep_completed_age, keep_completed_count
         FROM jobs WHERE state IN ('waiting', 'delayed', 'active', 'waiting_children')"
    )?;

    let rows = stmt.query_map([], |row| {
        let job = row_to_job(row)?;
        let state: String = row.get(17)?;
        Ok((job, state))
    })?;

    rows.collect()
}

/// Load DLQ jobs.
pub fn load_dlq_jobs(conn: &Connection) -> Result<Vec<Job>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT job_id, queue, data, attempts FROM dlq_jobs")?;
    let now = crate::queue::types::now_ms();

    let rows = stmt.query_map([], |row| {
        let id: i64 = row.get(0)?;
        let queue: String = row.get(1)?;
        let data_str: String = row.get(2)?;
        let attempts: u32 = row.get(3)?;
        let data: Value = serde_json::from_str(&data_str).unwrap_or(Value::Null);

        Ok(Job {
            id: id as u64,
            queue,
            data: Arc::new(data),
            priority: 0,
            created_at: now,
            run_at: now,
            started_at: 0,
            attempts,
            max_attempts: attempts,
            backoff: 1000,
            ttl: 0,
            timeout: 0,
            unique_key: None,
            depends_on: vec![],
            progress: 0,
            progress_msg: None,
            tags: vec![],
            lifo: false,
            remove_on_complete: false,
            remove_on_fail: false,
            last_heartbeat: 0,
            stall_timeout: 0,
            stall_count: 0,
            parent_id: None,
            children_ids: vec![],
            children_completed: 0,
            custom_id: None,
            keep_completed_age: 0,
            keep_completed_count: 0,
            completed_at: 0,
            group_id: None,
        })
    })?;

    rows.collect()
}

/// Get the maximum job ID.
pub fn get_max_job_id(conn: &Connection) -> Result<u64, rusqlite::Error> {
    let max: Option<i64> = conn
        .query_row("SELECT MAX(id) FROM jobs", [], |row| row.get(0))
        .optional()?
        .flatten();
    Ok(max.unwrap_or(0) as u64)
}

/// Convert a database row to a Job struct.
fn row_to_job(row: &rusqlite::Row) -> Result<Job, rusqlite::Error> {
    let id: i64 = row.get(0)?;
    let queue: String = row.get(1)?;
    let data_str: String = row.get(2)?;
    let priority: i32 = row.get(3)?;
    let created_at: i64 = row.get(4)?;
    let run_at: i64 = row.get(5)?;
    let started_at: Option<i64> = row.get(6)?;
    let attempts: u32 = row.get(7)?;
    let max_attempts: u32 = row.get(8)?;
    let backoff: i64 = row.get(9)?;
    let ttl: Option<i64> = row.get(10)?;
    let timeout: Option<i64> = row.get(11)?;
    let unique_key: Option<String> = row.get(12)?;
    let depends_on_str: Option<String> = row.get(13)?;
    let progress: i32 = row.get(14)?;
    let progress_msg: Option<String> = row.get(15)?;
    let tags_str: Option<String> = row.get(16)?;
    let lifo: i32 = row.get(18)?;
    let custom_id: Option<String> = row.get(19)?;
    let parent_id: Option<i64> = row.get(20)?;
    let children_ids_str: Option<String> = row.get(21)?;
    let children_completed: i32 = row.get(22)?;
    let group_id: Option<String> = row.get(23)?;
    let keep_completed_age: i64 = row.get(24)?;
    let keep_completed_count: i32 = row.get(25)?;

    let data: Value = serde_json::from_str(&data_str).unwrap_or(Value::Null);
    let depends_on: Vec<u64> = depends_on_str
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let tags: Vec<String> = tags_str
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let children_ids: Vec<u64> = children_ids_str
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    Ok(Job {
        id: id as u64,
        queue,
        data: Arc::new(data),
        priority,
        created_at: created_at as u64,
        run_at: run_at as u64,
        started_at: started_at.unwrap_or(0) as u64,
        attempts,
        max_attempts,
        backoff: backoff as u64,
        ttl: ttl.unwrap_or(0) as u64,
        timeout: timeout.unwrap_or(0) as u64,
        unique_key,
        depends_on,
        progress: progress as u8,
        progress_msg,
        tags,
        lifo: lifo != 0,
        remove_on_complete: false,
        remove_on_fail: false,
        last_heartbeat: 0,
        stall_timeout: 0,
        stall_count: 0,
        parent_id: parent_id.map(|id| id as u64),
        children_ids,
        children_completed: children_completed as u32,
        custom_id,
        keep_completed_age: keep_completed_age as u64,
        keep_completed_count: keep_completed_count as usize,
        completed_at: 0,
        group_id,
    })
}
