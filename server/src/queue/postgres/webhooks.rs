//! Webhook database operations.

use sqlx::{PgPool, Row};

use crate::protocol::WebhookConfig;

/// Save a webhook.
#[allow(dead_code)]
pub async fn save_webhook(pool: &PgPool, webhook: &WebhookConfig) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO webhooks (id, url, events, queue, secret, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
            url = EXCLUDED.url,
            events = EXCLUDED.events,
            queue = EXCLUDED.queue,
            secret = EXCLUDED.secret
    "#,
    )
    .bind(&webhook.id)
    .bind(&webhook.url)
    .bind(&webhook.events)
    .bind(&webhook.queue)
    .bind(&webhook.secret)
    .bind(webhook.created_at as i64)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete a webhook.
#[allow(dead_code)]
pub async fn delete_webhook(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM webhooks WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Load all webhooks.
pub async fn load_webhooks(pool: &PgPool) -> Result<Vec<WebhookConfig>, sqlx::Error> {
    let rows = sqlx::query("SELECT id, url, events, queue, secret, created_at FROM webhooks")
        .fetch_all(pool)
        .await?;

    let mut webhooks = Vec::with_capacity(rows.len());
    for row in rows {
        webhooks.push(WebhookConfig {
            id: row.get("id"),
            url: row.get("url"),
            events: row.get("events"),
            queue: row.get("queue"),
            secret: row.get("secret"),
            created_at: row.get::<i64, _>("created_at") as u64,
        });
    }

    Ok(webhooks)
}
