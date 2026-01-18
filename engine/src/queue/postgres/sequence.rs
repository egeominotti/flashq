//! PostgreSQL sequence operations for cluster-unique ID generation.

use sqlx::{PgPool, Row};

/// Get the next ID from the PostgreSQL sequence (for cluster-unique IDs).
pub async fn next_sequence_id(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let row = sqlx::query("SELECT nextval('job_id_seq') as id")
        .fetch_one(pool)
        .await?;
    let id: i64 = row.get("id");
    Ok(id as u64)
}

/// Get the next N IDs from the PostgreSQL sequence (for batch operations).
pub async fn next_sequence_ids(pool: &PgPool, count: i64) -> Result<Vec<u64>, sqlx::Error> {
    // Use generate_series to get multiple sequence values efficiently
    let rows = sqlx::query("SELECT nextval('job_id_seq') as id FROM generate_series(1, $1)")
        .bind(count)
        .fetch_all(pool)
        .await?;

    Ok(rows.iter().map(|r| r.get::<i64, _>("id") as u64).collect())
}

/// Set the sequence to a specific value (for recovery).
pub async fn set_sequence_value(pool: &PgPool, value: u64) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT setval('job_id_seq', $1, true)")
        .bind(value as i64)
        .execute(pool)
        .await?;
    Ok(())
}
