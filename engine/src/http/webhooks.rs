//! Webhook HTTP handlers.

use axum::{
    extract::{Path, State},
    response::Json,
};
use serde_json::Value;

use crate::protocol::{Job, WebhookConfig};

use super::types::{ApiResponse, AppState, CreateWebhookRequest};

/// List all webhooks.
#[utoipa::path(
    get,
    path = "/webhooks",
    tag = "Webhooks",
    responses(
        (status = 200, description = "List of webhooks", body = Vec<WebhookConfig>)
    )
)]
pub async fn list_webhooks(State(qm): State<AppState>) -> Json<ApiResponse<Vec<WebhookConfig>>> {
    let webhooks = qm.list_webhooks().await;
    ApiResponse::success(webhooks)
}

/// Create a webhook.
#[utoipa::path(
    post,
    path = "/webhooks",
    tag = "Webhooks",
    request_body = CreateWebhookRequest,
    responses(
        (status = 200, description = "Webhook created", body = String)
    )
)]
pub async fn create_webhook(
    State(qm): State<AppState>,
    Json(req): Json<CreateWebhookRequest>,
) -> Json<ApiResponse<String>> {
    match qm
        .add_webhook(req.url, req.events, req.queue, req.secret)
        .await
    {
        Ok(id) => ApiResponse::success(id),
        Err(e) => ApiResponse::error(e),
    }
}

/// Delete a webhook.
#[utoipa::path(
    delete,
    path = "/webhooks/{id}",
    tag = "Webhooks",
    params(("id" = String, Path, description = "Webhook ID")),
    responses(
        (status = 200, description = "Webhook deleted", body = bool)
    )
)]
pub async fn delete_webhook(
    State(qm): State<AppState>,
    Path(id): Path<String>,
) -> Json<ApiResponse<bool>> {
    let deleted = qm.delete_webhook(&id).await;
    ApiResponse::success(deleted)
}

/// Incoming webhook - push job to queue.
#[utoipa::path(
    post,
    path = "/webhooks/incoming/{queue}",
    tag = "Webhooks",
    params(("queue" = String, Path, description = "Queue name")),
    responses(
        (status = 200, description = "Job created from webhook", body = Job)
    )
)]
pub async fn incoming_webhook(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
    Json(data): Json<Value>,
) -> Json<ApiResponse<Job>> {
    let input = crate::protocol::JobInput::new(data);
    match qm.push(queue, input).await {
        Ok(job) => ApiResponse::success(job),
        Err(e) => ApiResponse::error(e),
    }
}
