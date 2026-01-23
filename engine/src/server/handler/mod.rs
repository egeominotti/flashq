//! Command processing for flashQ.
//!
//! Handles all protocol commands for both text and binary protocols.
//!
//! Module organization:
//! - `commands.rs` - Command processing logic
//! - `tests.rs` - Unit tests

mod commands;
mod kv;
#[cfg(test)]
mod tests;

use std::sync::Arc;

use parking_lot::RwLock;

use crate::protocol::{deserialize_msgpack, Command, Request, Response, ResponseWithId};
use crate::queue::QueueManager;

use super::connection::ConnectionState;

/// Helper macro for commands that return Ok(()) or Err(e).
#[macro_export]
macro_rules! ok_or_error {
    ($result:expr) => {
        match $result {
            Ok(()) => Response::ok(),
            Err(e) => Response::error(e),
        }
    };
}

pub(crate) use ok_or_error;

/// Process command from binary (MessagePack) input
#[inline(always)]
pub async fn process_command_binary(
    data: &[u8],
    queue_manager: &Arc<QueueManager>,
    state: &Arc<RwLock<ConnectionState>>,
) -> ResponseWithId {
    let request: Request = match deserialize_msgpack(data) {
        Ok(req) => req,
        Err(e) => return ResponseWithId::new(Response::error(e), None),
    };

    process_request(request, queue_manager, state).await
}

#[inline(always)]
fn parse_request(line: &mut String) -> Result<Request, String> {
    // Trim newline in-place
    while line.ends_with('\n') || line.ends_with('\r') {
        line.pop();
    }
    // sonic-rs: fastest JSON parser (SIMD-accelerated, 30% faster than simd-json)
    sonic_rs::from_str(line).map_err(|e| format!("Invalid: {}", e))
}

/// Process command from text (JSON) input
#[inline(always)]
pub async fn process_command_text(
    line: &mut String,
    queue_manager: &Arc<QueueManager>,
    state: &Arc<RwLock<ConnectionState>>,
) -> ResponseWithId {
    let request: Request = match parse_request(line) {
        Ok(req) => req,
        Err(e) => return ResponseWithId::new(Response::error(e), None),
    };

    process_request(request, queue_manager, state).await
}

/// Shared command processing logic for both text and binary protocols
#[inline(always)]
pub async fn process_request(
    request: Request,
    queue_manager: &Arc<QueueManager>,
    state: &Arc<RwLock<ConnectionState>>,
) -> ResponseWithId {
    let req_id = request.req_id;
    let command = request.command;

    // Handle Auth command first (doesn't require authentication)
    if let Command::Auth { token } = &command {
        if queue_manager.verify_token(token) {
            state.write().authenticated = true;
            return ResponseWithId::new(Response::ok(), req_id);
        } else {
            return ResponseWithId::new(Response::error("Invalid token"), req_id);
        }
    }

    // Check if authentication is required
    if !queue_manager.verify_token("") && !state.read().authenticated {
        return ResponseWithId::new(Response::error("Authentication required"), req_id);
    }

    let response = commands::process_command(command, queue_manager).await;
    ResponseWithId::new(response, req_id)
}
