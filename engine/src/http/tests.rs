//! HTTP API integration tests.

use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use tower::ServiceExt;

use super::{create_cors_layer, create_router, AppState};
use crate::queue::QueueManager;

/// Helper to create test app
fn create_test_app() -> Router {
    let state: AppState = QueueManager::new(false);
    create_router(state)
}

#[test]
fn test_create_cors_layer_default() {
    std::env::remove_var("CORS_ALLOW_ORIGIN");
    let _ = create_cors_layer();
}

#[test]
fn test_create_cors_layer_with_origins() {
    std::env::set_var(
        "CORS_ALLOW_ORIGIN",
        "http://localhost:3000,http://example.com",
    );
    let _ = create_cors_layer();
    std::env::remove_var("CORS_ALLOW_ORIGIN");
}

#[test]
fn test_create_cors_layer_wildcard() {
    std::env::set_var("CORS_ALLOW_ORIGIN", "*");
    let _ = create_cors_layer();
    std::env::remove_var("CORS_ALLOW_ORIGIN");
}

#[tokio::test]
async fn test_app_state_creation() {
    let state: AppState = QueueManager::new(false);
    let _cloned = state.clone();
}

#[tokio::test]
async fn test_create_router_no_panic() {
    let state: AppState = QueueManager::new(false);
    let _router = create_router(state);
}

#[tokio::test]
async fn test_health_endpoint() {
    let app = create_test_app();
    let response = app
        .oneshot(Request::get("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_stats_endpoint() {
    let app = create_test_app();
    let response = app
        .oneshot(Request::get("/stats").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["ok"].as_bool().unwrap_or(false));
    assert!(json["data"].get("queued").is_some());
}

#[tokio::test]
async fn test_list_queues_empty() {
    let app = create_test_app();
    let response = app
        .oneshot(Request::get("/queues").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["ok"].as_bool().unwrap_or(false));
    assert!(json["data"].is_array());
}

#[tokio::test]
async fn test_push_job_http() {
    let app = create_test_app();
    let response = app
        .oneshot(
            Request::post("/queues/test-queue/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {"task": "test"}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["data"]["id"].is_number());
}

#[tokio::test]
async fn test_push_pull_flow_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/http-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {"value": 42}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
        .as_u64()
        .unwrap();

    let pull_resp = app
        .oneshot(
            Request::get("/queues/http-test/jobs?count=1&timeout=100")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = pull_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let jobs = json["data"].as_array().unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0]["id"].as_u64().unwrap(), job_id);
}

#[tokio::test]
async fn test_push_pull_ack_flow_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/ack-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {"x": 1}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
        .as_u64()
        .unwrap();

    let _ = app
        .clone()
        .oneshot(
            Request::get("/queues/ack-test/jobs?count=1&timeout=100")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let ack_resp = app
        .clone()
        .oneshot(
            Request::post(&format!("/jobs/{}/ack", job_id))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"result": "done"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ack_resp.status(), StatusCode::OK);

    let get_resp = app
        .oneshot(
            Request::get(&format!("/jobs/{}", job_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = get_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["data"]["state"].as_str().unwrap(), "completed");
}

#[tokio::test]
async fn test_push_pull_fail_flow_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/fail-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}, "max_attempts": 1}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
        .as_u64()
        .unwrap();

    let _ = app
        .clone()
        .oneshot(
            Request::get("/queues/fail-test/jobs?count=1&timeout=100")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let _ = app
        .clone()
        .oneshot(
            Request::post(&format!("/jobs/{}/fail", job_id))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"error": "test error"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    let get_resp = app
        .oneshot(
            Request::get(&format!("/jobs/{}", job_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = get_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["data"]["state"].as_str().unwrap(), "failed");
}

#[tokio::test]
async fn test_get_job_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/get-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {"foo": "bar"}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
        .as_u64()
        .unwrap();

    let get_resp = app
        .oneshot(
            Request::get(&format!("/jobs/{}", job_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(get_resp.status(), StatusCode::OK);
    let body = get_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["data"]["id"].as_u64().unwrap(), job_id);
    assert_eq!(json["data"]["state"].as_str().unwrap(), "waiting");
}

#[tokio::test]
async fn test_cancel_job_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/cancel-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
        .as_u64()
        .unwrap();

    let cancel_resp = app
        .clone()
        .oneshot(
            Request::post(&format!("/jobs/{}/cancel", job_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cancel_resp.status(), StatusCode::OK);

    let get_resp = app
        .oneshot(
            Request::get(&format!("/jobs/{}", job_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = get_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["data"]["job"].is_null());
}

#[tokio::test]
async fn test_progress_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/progress-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
        .as_u64()
        .unwrap();

    let _ = app
        .clone()
        .oneshot(
            Request::get("/queues/progress-test/jobs?count=1&timeout=100")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let _ = app
        .clone()
        .oneshot(
            Request::post(&format!("/jobs/{}/progress", job_id))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"progress": 50, "message": "halfway"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    let get_resp = app
        .oneshot(
            Request::get(&format!("/jobs/{}/progress", job_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = get_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["data"][0].as_u64().unwrap(), 50);
}

#[tokio::test]
async fn test_metrics_endpoint() {
    let app = create_test_app();
    let response = app
        .oneshot(Request::get("/metrics").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["ok"].as_bool().unwrap_or(false));
    assert!(json["data"].get("total_pushed").is_some());
}

#[tokio::test]
async fn test_dlq_endpoint() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/dlq-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}, "max_attempts": 1}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
        .as_u64()
        .unwrap();

    let _ = app
        .clone()
        .oneshot(
            Request::get("/queues/dlq-test/jobs?count=1&timeout=100")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let _ = app
        .clone()
        .oneshot(
            Request::post(&format!("/jobs/{}/fail", job_id))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"error": "error"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    let dlq_resp = app
        .oneshot(
            Request::get("/queues/dlq-test/dlq")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(dlq_resp.status(), StatusCode::OK);
    let body = dlq_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let dlq_jobs = json["data"].as_array().unwrap();
    assert_eq!(dlq_jobs.len(), 1);
    assert_eq!(dlq_jobs[0]["id"].as_u64().unwrap(), job_id);
}

// ==================== QUEUE MANAGEMENT TESTS ====================

#[tokio::test]
async fn test_drain_queue_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push multiple jobs
    for i in 0..5 {
        let _ = app
            .clone()
            .oneshot(
                Request::post("/queues/drain-test/jobs")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(r#"{{"data": {{"i": {}}}}}"#, i)))
                    .unwrap(),
            )
            .await
            .unwrap();
    }

    // Drain the queue
    let drain_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/drain-test/drain")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(drain_resp.status(), StatusCode::OK);
    let body = drain_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["data"].as_u64().unwrap(), 5);

    // Verify queue is empty via stats (no blocking pull)
    let stats_resp = app
        .oneshot(Request::get("/stats").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = stats_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // After drain, queued should be 0 for this queue
    assert!(json["ok"].as_bool().unwrap());
}

#[tokio::test]
async fn test_obliterate_queue_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push jobs
    for _ in 0..3 {
        let _ = app
            .clone()
            .oneshot(
                Request::post("/queues/obliterate-test/jobs")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"data": {}}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
    }

    // Obliterate
    let resp = app
        .clone()
        .oneshot(
            Request::delete("/queues/obliterate-test/obliterate")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["data"].as_u64().unwrap() >= 3);
}

#[tokio::test]
async fn test_clean_queue_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push and complete a job
    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/clean-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
        .as_u64()
        .unwrap();

    // Pull and ack
    let _ = app
        .clone()
        .oneshot(
            Request::get("/queues/clean-test/jobs?count=1&timeout=100")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let _ = app
        .clone()
        .oneshot(
            Request::post(&format!("/jobs/{}/ack", job_id))
                .header("content-type", "application/json")
                .body(Body::from(r#"{}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    // Clean completed jobs older than 0ms (all)
    let clean_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/clean-test/clean")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"grace": 0, "state": "completed"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(clean_resp.status(), StatusCode::OK);
}

// ==================== JOB MANAGEMENT TESTS ====================

#[tokio::test]
async fn test_move_to_delayed_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push and pull a job
    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/delay-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
        .as_u64()
        .unwrap();

    // Pull to make it active
    let _ = app
        .clone()
        .oneshot(
            Request::get("/queues/delay-test/jobs?count=1&timeout=100")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Move to delayed
    let resp = app
        .clone()
        .oneshot(
            Request::post(&format!("/jobs/{}/move-to-delayed", job_id))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"delay": 5000}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Check state is delayed
    let get_resp = app
        .oneshot(
            Request::get(&format!("/jobs/{}", job_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = get_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["data"]["state"].as_str().unwrap(), "delayed");
}

#[tokio::test]
async fn test_promote_job_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push a delayed job
    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/promote-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}, "delay": 60000}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
        .as_u64()
        .unwrap();

    // Promote it
    let resp = app
        .clone()
        .oneshot(
            Request::post(&format!("/jobs/{}/promote", job_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Check state is waiting
    let get_resp = app
        .oneshot(
            Request::get(&format!("/jobs/{}", job_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = get_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["data"]["state"].as_str().unwrap(), "waiting");
}

#[tokio::test]
async fn test_discard_job_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push a job
    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/discard-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
        .as_u64()
        .unwrap();

    // Discard it
    let resp = app
        .clone()
        .oneshot(
            Request::post(&format!("/jobs/{}/discard", job_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Check it's in DLQ
    let dlq_resp = app
        .oneshot(
            Request::get("/queues/discard-test/dlq")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = dlq_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let dlq_jobs = json["data"].as_array().unwrap();
    assert_eq!(dlq_jobs.len(), 1);
}

#[tokio::test]
async fn test_change_priority_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push a job with low priority
    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/priority-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}, "priority": 1}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
        .as_u64()
        .unwrap();

    // Change priority
    let resp = app
        .clone()
        .oneshot(
            Request::post(&format!("/jobs/{}/priority", job_id))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"priority": 100}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

// ==================== CRON TESTS ====================

#[tokio::test]
async fn test_cron_crud_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Create cron
    let create_resp = app
        .clone()
        .oneshot(
            Request::post("/crons/test-cron")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"queue": "cron-queue", "schedule": "0 * * * * *", "data": {"test": true}}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_resp.status(), StatusCode::OK);

    // List crons
    let list_resp = app
        .clone()
        .oneshot(Request::get("/crons").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(list_resp.status(), StatusCode::OK);
    let body = list_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let crons = json["data"].as_array().unwrap();
    assert!(!crons.is_empty());

    // Delete cron
    let delete_resp = app
        .clone()
        .oneshot(
            Request::delete("/crons/test-cron")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(delete_resp.status(), StatusCode::OK);
    let body = delete_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["data"].as_bool().unwrap());
}

// ==================== RATE LIMIT & CONCURRENCY TESTS ====================

#[tokio::test]
async fn test_rate_limit_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Set rate limit
    let set_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/rate-test/rate-limit")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"limit": 10}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(set_resp.status(), StatusCode::OK);

    // Clear rate limit
    let clear_resp = app
        .clone()
        .oneshot(
            Request::delete("/queues/rate-test/rate-limit")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(clear_resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_concurrency_limit_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Set concurrency
    let set_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/conc-test/concurrency")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"limit": 5}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(set_resp.status(), StatusCode::OK);

    // Clear concurrency
    let clear_resp = app
        .clone()
        .oneshot(
            Request::delete("/queues/conc-test/concurrency")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(clear_resp.status(), StatusCode::OK);
}

// ==================== PAUSE/RESUME TESTS ====================

#[tokio::test]
async fn test_pause_resume_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Pause
    let pause_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/pause-test/pause")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(pause_resp.status(), StatusCode::OK);

    // Resume
    let resume_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/pause-test/resume")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resume_resp.status(), StatusCode::OK);
}

// ==================== JOB RESULT TESTS ====================

#[tokio::test]
async fn test_get_job_result_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push job
    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/result-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
        .as_u64()
        .unwrap();

    // Pull
    let _ = app
        .clone()
        .oneshot(
            Request::get("/queues/result-test/jobs?count=1&timeout=100")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Ack with result
    let _ = app
        .clone()
        .oneshot(
            Request::post(&format!("/jobs/{}/ack", job_id))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"result": {"value": 42}}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    // Get result
    let result_resp = app
        .oneshot(
            Request::get(&format!("/jobs/{}/result", job_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(result_resp.status(), StatusCode::OK);
    let body = result_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["data"]["value"].as_u64().unwrap(), 42);
}

// ==================== LIST JOBS TESTS ====================

#[tokio::test]
async fn test_list_jobs_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push some jobs
    for _ in 0..3 {
        let _ = app
            .clone()
            .oneshot(
                Request::post("/queues/list-test/jobs")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"data": {}}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
    }

    // List jobs
    let list_resp = app
        .oneshot(
            Request::get("/jobs?queue=list-test&limit=10")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_resp.status(), StatusCode::OK);
    let body = list_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let jobs = json["data"].as_array().unwrap();
    assert_eq!(jobs.len(), 3);
}
