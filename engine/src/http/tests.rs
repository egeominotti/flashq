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
