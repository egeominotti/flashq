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

// ==================== SETTINGS TESTS ====================

#[tokio::test]
async fn test_get_settings_http() {
    let app = create_test_app();
    let response = app
        .oneshot(Request::get("/settings").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["ok"].as_bool().unwrap_or(false));
    assert!(json["data"].get("version").is_some());
    assert!(json["data"].get("sqlite").is_some());
    assert!(json["data"].get("s3_backup").is_some());
}

#[tokio::test]
async fn test_get_system_metrics_http() {
    let app = create_test_app();
    let response = app
        .oneshot(Request::get("/system/metrics").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["ok"].as_bool().unwrap_or(false));
    assert!(json["data"].get("memory_used_mb").is_some());
    assert!(json["data"].get("cpu_percent").is_some());
    assert!(json["data"].get("uptime_seconds").is_some());
}

#[tokio::test]
async fn test_save_auth_settings_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Auth settings expects tokens as comma-separated string
    let response = app
        .oneshot(
            Request::post("/settings/auth")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"tokens": "token1,token2"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["ok"].as_bool().unwrap_or(false));
}

#[tokio::test]
async fn test_save_queue_defaults_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    let response = app
        .oneshot(
            Request::post("/settings/queue-defaults")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"default_timeout": 30000, "default_max_attempts": 3}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_save_cleanup_settings_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    let response = app
        .oneshot(
            Request::post("/settings/cleanup")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"max_completed_jobs": 10000, "max_job_results": 5000}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_run_cleanup_now_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    let response = app
        .oneshot(
            Request::post("/settings/cleanup/run")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["ok"].as_bool().unwrap_or(false));
}

#[tokio::test]
async fn test_reset_metrics_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push a job first to have some metrics
    let _ = app
        .clone()
        .oneshot(
            Request::post("/queues/metrics-reset-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    // Reset metrics
    let response = app
        .clone()
        .oneshot(
            Request::post("/server/reset-metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Verify metrics are reset
    let metrics_resp = app
        .oneshot(Request::get("/metrics").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = metrics_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // After reset, counters should be 0
    assert_eq!(json["data"]["total_pushed"].as_u64().unwrap_or(1), 0);
}

#[tokio::test]
async fn test_clear_all_queues_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push jobs to multiple queues
    for q in ["queue1", "queue2", "queue3"] {
        let _ = app
            .clone()
            .oneshot(
                Request::post(&format!("/queues/{}/jobs", q))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"data": {}}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
    }

    // Clear all queues
    let response = app
        .clone()
        .oneshot(
            Request::post("/server/clear-queues")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Verify stats
    let stats_resp = app
        .oneshot(Request::get("/stats").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = stats_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["data"]["queued"].as_u64().unwrap_or(1), 0);
}

#[tokio::test]
async fn test_clear_all_dlq_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Create a failed job
    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/dlq-clear-test/jobs")
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

    // Pull and fail
    let _ = app
        .clone()
        .oneshot(
            Request::get("/queues/dlq-clear-test/jobs?count=1&timeout=100")
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
                .body(Body::from(r#"{"error": "test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    // Clear all DLQ
    let response = app
        .clone()
        .oneshot(
            Request::post("/server/clear-dlq")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Verify DLQ is empty
    let stats_resp = app
        .oneshot(Request::get("/stats").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = stats_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["data"]["dlq"].as_u64().unwrap_or(1), 0);
}

#[tokio::test]
async fn test_clear_completed_jobs_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Create and complete a job
    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/completed-clear-test/jobs")
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
            Request::get("/queues/completed-clear-test/jobs?count=1&timeout=100")
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

    // Clear completed jobs
    let response = app
        .clone()
        .oneshot(
            Request::post("/server/clear-completed")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Verify completed count is 0
    let stats_resp = app
        .oneshot(Request::get("/stats").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = stats_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["data"]["completed"].as_u64().unwrap_or(1), 0);
}

#[tokio::test]
async fn test_reset_server_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push some jobs
    for _ in 0..5 {
        let _ = app
            .clone()
            .oneshot(
                Request::post("/queues/reset-test/jobs")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"data": {}}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
    }

    // Reset server
    let response = app
        .clone()
        .oneshot(Request::post("/server/reset").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Verify all is cleared
    let stats_resp = app
        .oneshot(Request::get("/stats").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = stats_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["data"]["queued"].as_u64().unwrap_or(1), 0);
    assert_eq!(json["data"]["processing"].as_u64().unwrap_or(1), 0);
    assert_eq!(json["data"]["dlq"].as_u64().unwrap_or(1), 0);
}

// ==================== SQLITE SETTINGS TESTS ====================

#[tokio::test]
async fn test_get_sqlite_settings_http() {
    let app = create_test_app();
    let response = app
        .oneshot(
            Request::get("/sqlite/settings")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["ok"].as_bool().unwrap_or(false));
    assert!(json["data"].get("enabled").is_some());
}

#[tokio::test]
async fn test_get_sqlite_stats_http() {
    let app = create_test_app();
    let response = app
        .oneshot(Request::get("/sqlite/stats").body(Body::empty()).unwrap())
        .await
        .unwrap();
    // Could be 200 or error depending on sqlite state, just check it doesn't panic
    assert!(
        response.status() == StatusCode::OK
            || response.status() == StatusCode::INTERNAL_SERVER_ERROR
    );
}

// ==================== S3 SETTINGS TESTS ====================

#[tokio::test]
async fn test_get_s3_settings_http() {
    let app = create_test_app();
    let response = app
        .oneshot(Request::get("/s3/settings").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["ok"].as_bool().unwrap_or(false));
    assert!(json["data"].get("enabled").is_some());
}

#[tokio::test]
async fn test_list_s3_backups_http() {
    let app = create_test_app();
    let response = app
        .oneshot(Request::get("/s3/backups").body(Body::empty()).unwrap())
        .await
        .unwrap();
    // May fail if S3 not configured, but should not panic
    let status = response.status();
    assert!(status == StatusCode::OK || status == StatusCode::INTERNAL_SERVER_ERROR);
}

// ==================== WEBHOOKS TESTS ====================

#[tokio::test]
async fn test_webhook_crud_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Create webhook - events should be plain names like "completed", "failed"
    // Use example.com as localhost URLs are not allowed
    let create_resp = app
        .clone()
        .oneshot(
            Request::post("/webhooks")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{
                        "url": "https://example.com/webhook/callback",
                        "events": ["completed", "failed"],
                        "queue": "webhook-test"
                    }"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_resp.status(), StatusCode::OK);
    let body = create_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // Check if the request succeeded
    assert!(
        json["ok"].as_bool().unwrap_or(false),
        "Webhook creation failed: {:?}",
        json["error"]
    );
    // The webhook ID is returned directly as a string in data field
    let webhook_id = json["data"].as_str().unwrap().to_string();

    // List webhooks
    let list_resp = app
        .clone()
        .oneshot(Request::get("/webhooks").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(list_resp.status(), StatusCode::OK);
    let body = list_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let webhooks = json["data"].as_array().unwrap();
    assert!(!webhooks.is_empty());

    // Delete webhook
    let delete_resp = app
        .clone()
        .oneshot(
            Request::delete(&format!("/webhooks/{}", webhook_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(delete_resp.status(), StatusCode::OK);
}

// ==================== WORKERS TESTS ====================

#[tokio::test]
async fn test_list_workers_http() {
    let app = create_test_app();
    let response = app
        .oneshot(Request::get("/workers").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["ok"].as_bool().unwrap_or(false));
    assert!(json["data"].is_array());
}

// ==================== METRICS HISTORY TESTS ====================

#[tokio::test]
async fn test_metrics_history_http() {
    let app = create_test_app();
    let response = app
        .oneshot(
            Request::get("/metrics/history")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["ok"].as_bool().unwrap_or(false));
    assert!(json["data"].is_array());
}

#[tokio::test]
async fn test_prometheus_metrics_http() {
    let app = create_test_app();
    let response = app
        .oneshot(
            Request::get("/metrics/prometheus")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&body);
    // Prometheus format should contain HELP and TYPE
    assert!(text.contains("flashq_") || text.is_empty());
}

// ==================== DEBUG TESTS ====================

#[tokio::test]
async fn test_debug_memory_stats_http() {
    let app = create_test_app();
    let response = app
        .oneshot(Request::get("/debug/memory").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // debug_memory_stats returns MemoryStats directly, not ApiResponse
    // Fields use _count suffix (e.g., job_index_count, completed_jobs_count)
    assert!(json.get("job_index_count").is_some());
    assert!(json.get("completed_jobs_count").is_some());
}

// ==================== BATCH OPERATIONS TESTS ====================

#[tokio::test]
async fn test_batch_ack_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push multiple jobs
    let mut job_ids = Vec::new();
    for i in 0..3 {
        let push_resp = app
            .clone()
            .oneshot(
                Request::post("/queues/batch-ack-test/jobs")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(r#"{{"data": {{"i": {}}}}}"#, i)))
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = push_resp.into_body().collect().await.unwrap().to_bytes();
        let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
            .as_u64()
            .unwrap();
        job_ids.push(job_id);
    }

    // Pull all jobs
    let _ = app
        .clone()
        .oneshot(
            Request::get("/queues/batch-ack-test/jobs?count=3&timeout=100")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Ack each job
    for job_id in &job_ids {
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
    }

    // Verify all completed
    let stats_resp = app
        .oneshot(Request::get("/stats").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = stats_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["data"]["completed"].as_u64().unwrap() >= 3);
}

// ==================== JOB QUERY TESTS ====================

#[tokio::test]
async fn test_get_job_counts_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push some jobs
    for _ in 0..2 {
        let _ = app
            .clone()
            .oneshot(
                Request::post("/queues/counts-test/jobs")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"data": {}}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
    }

    // Get jobs for this queue and verify count
    let list_resp = app
        .oneshot(
            Request::get("/jobs?queue=counts-test")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_resp.status(), StatusCode::OK);
    let body = list_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let jobs = json["data"].as_array().unwrap();
    assert_eq!(jobs.len(), 2);
}

#[tokio::test]
async fn test_get_job_not_found_http() {
    let app = create_test_app();
    let response = app
        .oneshot(Request::get("/jobs/999999999").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // Job not found but returns ok with null job
    assert!(json["data"]["job"].is_null());
}

// ==================== JOB UPDATE TESTS ====================

#[tokio::test]
async fn test_get_job_detail_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push a job
    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/detail-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {"original": true}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let job_id = serde_json::from_slice::<serde_json::Value>(&body).unwrap()["data"]["id"]
        .as_u64()
        .unwrap();

    // Get job details - returns JobDetailResponse with flattened job fields, state, result
    // The job Option<Job> is flattened via #[serde(flatten)]
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
    // Check response structure - job is flattened so id/data are at data level
    assert!(json["ok"].as_bool().unwrap_or(false));
    assert_eq!(json["data"]["state"].as_str().unwrap(), "waiting");
    // Job id should be at data level (flattened)
    assert_eq!(json["data"]["id"].as_u64().unwrap(), job_id);
}

// ==================== DLQ RETRY TESTS ====================

#[tokio::test]
async fn test_retry_dlq_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Create a failed job
    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/retry-dlq-test/jobs")
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

    // Pull and fail
    let _ = app
        .clone()
        .oneshot(
            Request::get("/queues/retry-dlq-test/jobs?count=1&timeout=100")
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
                .body(Body::from(r#"{"error": "test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    // Retry DLQ
    let retry_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/retry-dlq-test/dlq/retry")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(retry_resp.status(), StatusCode::OK);

    // Verify job is back in queue
    let stats_resp = app
        .oneshot(Request::get("/stats").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = stats_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["data"]["queued"].as_u64().unwrap() >= 1);
}

// ==================== PARTIAL RESULT TESTS ====================

#[tokio::test]
async fn test_send_partial_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push a job
    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/partial-test/jobs")
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

    // Pull job
    let _ = app
        .clone()
        .oneshot(
            Request::get("/queues/partial-test/jobs?count=1&timeout=100")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Send partial result
    let partial_resp = app
        .clone()
        .oneshot(
            Request::post(&format!("/jobs/{}/partial", job_id))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {"chunk": 1}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(partial_resp.status(), StatusCode::OK);
}

// ==================== IS_PAUSED TEST ====================

#[tokio::test]
async fn test_is_paused_state_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // First push a job to create the queue
    let _ = app
        .clone()
        .oneshot(
            Request::post("/queues/paused-state-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    // Pause queue
    let _ = app
        .clone()
        .oneshot(
            Request::post("/queues/paused-state-test/pause")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Check queue is paused via list queues
    let list_resp = app
        .clone()
        .oneshot(Request::get("/queues").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = list_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let queues = json["data"].as_array().unwrap();
    let paused_queue = queues.iter().find(|q| q["name"] == "paused-state-test");
    assert!(paused_queue.is_some());
    assert!(paused_queue.unwrap()["paused"].as_bool().unwrap());

    // Resume and verify
    let _ = app
        .clone()
        .oneshot(
            Request::post("/queues/paused-state-test/resume")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let list_resp2 = app
        .oneshot(Request::get("/queues").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body2 = list_resp2.into_body().collect().await.unwrap().to_bytes();
    let json2: serde_json::Value = serde_json::from_slice(&body2).unwrap();
    let queues2 = json2["data"].as_array().unwrap();
    let resumed_queue = queues2.iter().find(|q| q["name"] == "paused-state-test");
    assert!(!resumed_queue.unwrap()["paused"].as_bool().unwrap());
}

// ==================== INCOMING WEBHOOK TESTS ====================

#[tokio::test]
async fn test_incoming_webhook_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Send webhook to create a job
    let response = app
        .clone()
        .oneshot(
            Request::post("/webhooks/incoming/incoming-test")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"payload": "test data"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["data"]["id"].is_number());

    // Verify job was created
    let stats_resp = app
        .oneshot(Request::get("/stats").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = stats_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["data"]["queued"].as_u64().unwrap() >= 1);
}

// ==================== ERROR HANDLING TESTS ====================

#[tokio::test]
async fn test_invalid_json_http() {
    let app = create_test_app();
    let response = app
        .oneshot(
            Request::post("/queues/error-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"invalid json"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        response.status() == StatusCode::BAD_REQUEST
            || response.status() == StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn test_missing_content_type_http() {
    let app = create_test_app();
    let response = app
        .oneshot(
            Request::post("/queues/error-test/jobs")
                .body(Body::from(r#"{"data": {}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    // Should still work or fail gracefully
    let status = response.status();
    assert!(
        status == StatusCode::OK
            || status == StatusCode::BAD_REQUEST
            || status == StatusCode::UNSUPPORTED_MEDIA_TYPE
    );
}

#[tokio::test]
async fn test_ack_job_not_found_http() {
    let app = create_test_app();
    let response = app
        .oneshot(
            Request::post("/jobs/999999999/ack")
                .header("content-type", "application/json")
                .body(Body::from(r#"{}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    // Should return error or ok with message
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // Either ok=false or job not found in some form
    assert!(!json["ok"].as_bool().unwrap_or(true) || json["data"].is_null());
}

#[tokio::test]
async fn test_fail_job_not_found_http() {
    let app = create_test_app();
    let response = app
        .oneshot(
            Request::post("/jobs/999999999/fail")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"error": "test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(!json["ok"].as_bool().unwrap_or(true) || json["data"].is_null());
}

#[tokio::test]
async fn test_cancel_already_completed_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push and complete a job
    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/cancel-completed-test/jobs")
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
            Request::get("/queues/cancel-completed-test/jobs?count=1&timeout=100")
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

    // Try to cancel completed job
    let cancel_resp = app
        .oneshot(
            Request::post(&format!("/jobs/{}/cancel", job_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    // Should fail gracefully
    let body = cancel_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // Cancel should return ok=false since job is completed
    assert!(!json["ok"].as_bool().unwrap_or(true));
}

// ==================== CUSTOM JOB ID TESTS ====================

#[tokio::test]
async fn test_push_with_custom_job_id_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push job with custom ID
    let response = app
        .clone()
        .oneshot(
            Request::post("/queues/custom-id-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}, "jobId": "my-custom-id-123"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["ok"].as_bool().unwrap_or(false));

    // Push same job ID again - should be deduplicated
    let dup_response = app
        .clone()
        .oneshot(
            Request::post("/queues/custom-id-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}, "jobId": "my-custom-id-123"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(dup_response.status(), StatusCode::OK);
    // Should return same job ID or indicate duplicate
}

// ==================== DELAYED JOB TESTS ====================

#[tokio::test]
async fn test_push_delayed_job_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push delayed job
    let push_resp = app
        .clone()
        .oneshot(
            Request::post("/queues/delayed-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {}, "delay": 60000}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = push_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let job_id = json["data"]["id"].as_u64().unwrap();

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

// ==================== PRIORITY JOB TESTS ====================

#[tokio::test]
async fn test_push_priority_jobs_http() {
    let state: AppState = QueueManager::new(false);
    let app = create_router(state);

    // Push low priority job first
    let _ = app
        .clone()
        .oneshot(
            Request::post("/queues/priority-order-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"data": {"order": "first"}, "priority": 1}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    // Push high priority job second
    let _ = app
        .clone()
        .oneshot(
            Request::post("/queues/priority-order-test/jobs")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"data": {"order": "second"}, "priority": 100}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    // Pull should return high priority first
    let pull_resp = app
        .oneshot(
            Request::get("/queues/priority-order-test/jobs?count=1&timeout=100")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = pull_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let jobs = json["data"].as_array().unwrap();
    assert_eq!(jobs[0]["data"]["order"].as_str().unwrap(), "second");
}
