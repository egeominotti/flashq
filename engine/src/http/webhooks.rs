//! Webhook HTTP handlers.

use axum::{
    extract::{Path, State},
    response::Json,
};
use serde_json::Value;

use crate::protocol::{Job, WebhookConfig};

use super::types::{ApiResponse, AppState, CreateWebhookRequest};

/// List all webhooks.
///
/// Returns all registered webhook configurations including URLs, subscribed events,
/// and target queues. Useful for debugging webhook setups.
#[utoipa::path(
    get,
    path = "/webhooks",
    tag = "Webhooks",
    summary = "List all webhook configurations",
    description = "Returns all registered webhooks. Each includes: unique ID, target URL, subscribed event types (completed, failed, progress), queue filter (optional), and secret for signature verification. Use for auditing and managing webhook integrations.",
    responses(
        (status = 200, description = "All registered webhook configurations", body = Vec<WebhookConfig>)
    )
)]
pub async fn list_webhooks(State(qm): State<AppState>) -> Json<ApiResponse<Vec<WebhookConfig>>> {
    let webhooks = qm.list_webhooks().await;
    ApiResponse::success(webhooks)
}

/// Create a webhook.
///
/// Registers a webhook to receive HTTP callbacks on job events. Webhooks are called
/// with job data and signed with HMAC-SHA256 if a secret is provided.
#[utoipa::path(
    post,
    path = "/webhooks",
    tag = "Webhooks",
    summary = "Register webhook for job events",
    description = "Creates a webhook that POSTs to URL when specified events occur. Events: 'completed', 'failed', 'progress'. Optional queue filter limits to specific queue. Secret enables HMAC-SHA256 signature in X-FlashQ-Signature header for verification. Returns unique webhook ID.",
    request_body = CreateWebhookRequest,
    responses(
        (status = 200, description = "Webhook ID for management", body = String)
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
///
/// Removes a webhook registration. No further callbacks will be sent.
/// Returns true if found and deleted.
#[utoipa::path(
    delete,
    path = "/webhooks/{id}",
    tag = "Webhooks",
    summary = "Remove webhook registration",
    description = "Deletes a webhook by ID. Stops all future callbacks to that URL. Returns true if webhook existed and was deleted, false if ID not found.",
    params(("id" = String, Path, description = "Webhook ID returned from create")),
    responses(
        (status = 200, description = "True if deleted, false if not found", body = bool)
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
///
/// Accepts external webhook calls and creates jobs. Use this endpoint to receive
/// webhooks from external services (GitHub, Stripe, etc.) and queue them for processing.
#[utoipa::path(
    post,
    path = "/webhooks/incoming/{queue}",
    tag = "Webhooks",
    summary = "Receive external webhook as job",
    description = "Creates a job from incoming webhook payload. The entire request body becomes the job data. Use for: GitHub webhooks, Stripe events, external service integrations. Jobs are queued with default options. For advanced options, use POST /queues/{queue}/jobs instead.",
    params(("queue" = String, Path, description = "Target queue for the webhook job")),
    responses(
        (status = 200, description = "Job created from webhook payload", body = Job)
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
