//! Unit tests for command handler.

use std::sync::Arc;

use parking_lot::RwLock;

use super::*;
use crate::protocol::{serialize_msgpack, Command, Request};
use crate::server::connection::ConnectionState;

fn setup() -> Arc<QueueManager> {
    QueueManager::new(false)
}

fn setup_with_auth() -> Arc<QueueManager> {
    QueueManager::with_auth_tokens(false, vec!["secret-token".to_string()])
}

#[test]
fn test_parse_request_valid_json() {
    let mut line = r#"{"cmd":"STATS"}"#.to_string();
    let result = parse_request(&mut line);
    assert!(result.is_ok());
}

#[test]
fn test_parse_request_with_newline() {
    let mut line = "{\"cmd\":\"STATS\"}\n".to_string();
    let result = parse_request(&mut line);
    assert!(result.is_ok());
}

#[test]
fn test_parse_request_with_crlf() {
    let mut line = "{\"cmd\":\"STATS\"}\r\n".to_string();
    let result = parse_request(&mut line);
    assert!(result.is_ok());
}

#[test]
fn test_parse_request_invalid_json() {
    let mut line = "not json".to_string();
    let result = parse_request(&mut line);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Invalid"));
}

#[test]
fn test_parse_request_push_command() {
    let mut line = r#"{"cmd":"PUSH","queue":"test","data":{"foo":"bar"}}"#.to_string();
    let result = parse_request(&mut line);
    assert!(result.is_ok());
    let request = result.unwrap();
    match request.command {
        Command::Push { queue, .. } => assert_eq!(queue, "test"),
        _ => panic!("Expected Push command"),
    }
}

#[test]
fn test_parse_request_with_req_id() {
    let mut line = r#"{"reqId":"abc123","cmd":"STATS"}"#.to_string();
    let result = parse_request(&mut line);
    assert!(result.is_ok());
    let request = result.unwrap();
    assert_eq!(request.req_id, Some("abc123".to_string()));
}

#[tokio::test]
async fn test_process_command_text_valid() {
    let qm = setup();
    let state = Arc::new(RwLock::new(ConnectionState {
        authenticated: false,
    }));

    let mut line = r#"{"cmd":"STATS"}"#.to_string();
    let response = process_command_text(&mut line, &qm, &state).await;

    // Should return stats response
    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"ok\":true"));
}

#[tokio::test]
async fn test_process_command_text_invalid_json() {
    let qm = setup();
    let state = Arc::new(RwLock::new(ConnectionState {
        authenticated: false,
    }));

    let mut line = "invalid json".to_string();
    let response = process_command_text(&mut line, &qm, &state).await;

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"ok\":false"));
    assert!(json.contains("Invalid"));
}

#[tokio::test]
async fn test_process_command_binary_valid() {
    let qm = setup();
    let state = Arc::new(RwLock::new(ConnectionState {
        authenticated: false,
    }));

    let request = Request {
        req_id: None,
        command: Command::Stats,
    };
    let data = serialize_msgpack(&request).unwrap();

    let response = process_command_binary(&data, &qm, &state).await;
    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"ok\":true"));
}

#[tokio::test]
async fn test_process_command_binary_invalid() {
    let qm = setup();
    let state = Arc::new(RwLock::new(ConnectionState {
        authenticated: false,
    }));

    let data = vec![0xFF, 0xFF, 0xFF]; // Invalid MessagePack
    let response = process_command_binary(&data, &qm, &state).await;

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"ok\":false"));
}

#[tokio::test]
async fn test_auth_required_without_token() {
    let qm = setup_with_auth();
    let state = Arc::new(RwLock::new(ConnectionState {
        authenticated: false,
    }));

    let mut line = r#"{"cmd":"STATS"}"#.to_string();
    let response = process_command_text(&mut line, &qm, &state).await;

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"ok\":false"));
    assert!(json.contains("Authentication required"));
}

#[tokio::test]
async fn test_auth_success() {
    let qm = setup_with_auth();
    let state = Arc::new(RwLock::new(ConnectionState {
        authenticated: false,
    }));

    // First authenticate
    let mut auth_line = r#"{"cmd":"AUTH","token":"secret-token"}"#.to_string();
    let auth_response = process_command_text(&mut auth_line, &qm, &state).await;
    let json = serde_json::to_string(&auth_response).unwrap();
    assert!(json.contains("\"ok\":true"));

    // Now stats should work
    let mut stats_line = r#"{"cmd":"STATS"}"#.to_string();
    let stats_response = process_command_text(&mut stats_line, &qm, &state).await;
    let json = serde_json::to_string(&stats_response).unwrap();
    assert!(json.contains("\"ok\":true"));
    assert!(json.contains("queued"));
}

#[tokio::test]
async fn test_auth_invalid_token() {
    let qm = setup_with_auth();
    let state = Arc::new(RwLock::new(ConnectionState {
        authenticated: false,
    }));

    let mut line = r#"{"cmd":"AUTH","token":"wrong-token"}"#.to_string();
    let response = process_command_text(&mut line, &qm, &state).await;

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"ok\":false"));
    assert!(json.contains("Invalid token"));
}

#[tokio::test]
async fn test_req_id_echoed_in_response() {
    let qm = setup();
    let state = Arc::new(RwLock::new(ConnectionState {
        authenticated: false,
    }));

    let mut line = r#"{"reqId":"test-123","cmd":"STATS"}"#.to_string();
    let response = process_command_text(&mut line, &qm, &state).await;

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"reqId\":\"test-123\""));
}
