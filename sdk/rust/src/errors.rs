use thiserror::Error;

/// Result type alias for flashQ operations.
pub type Result<T> = std::result::Result<T, FlashQError>;

/// Error types for flashQ client operations.
#[derive(Error, Debug)]
pub enum FlashQError {
    #[error("Connection error: {0}")]
    Connection(String),

    #[error("Authentication failed: {0}")]
    Authentication(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Server error: {0}")]
    Server(String),

    #[error("Job not found: {0}")]
    JobNotFound(u64),

    #[error("Duplicate job: {0}")]
    DuplicateJob(String),

    #[error("Rate limit exceeded: {0}")]
    RateLimit(String),

    #[error("Protocol error: {0}")]
    Protocol(String),

    #[error("Queue paused: {0}")]
    QueuePaused(String),

    #[error("Concurrency limit: {0}")]
    ConcurrencyLimit(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl FlashQError {
    /// Whether this error is retryable.
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            FlashQError::Connection(_)
                | FlashQError::Timeout(_)
                | FlashQError::RateLimit(_)
                | FlashQError::QueuePaused(_)
                | FlashQError::ConcurrencyLimit(_)
        )
    }
}

/// Check a server response `Value` for errors and return `Ok(())` or an appropriate error.
pub fn check_response(resp: &serde_json::Value) -> Result<()> {
    let ok = resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if ok {
        return Ok(());
    }
    let msg = resp
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown error");
    Err(parse_server_error(msg))
}

/// Parse a server error message into the appropriate error variant.
pub fn parse_server_error(msg: &str) -> FlashQError {
    let lower = msg.to_lowercase();
    if lower.contains("auth") {
        FlashQError::Authentication(msg.to_string())
    } else if lower.contains("not found") || lower.contains("no job") {
        FlashQError::Server(msg.to_string())
    } else if lower.contains("timeout") || lower.contains("timed out") {
        FlashQError::Timeout(msg.to_string())
    } else if lower.contains("duplicate") || lower.contains("already exists") {
        FlashQError::DuplicateJob(msg.to_string())
    } else if lower.contains("rate limit") {
        FlashQError::RateLimit(msg.to_string())
    } else if lower.contains("paused") {
        FlashQError::QueuePaused(msg.to_string())
    } else if lower.contains("concurrency") {
        FlashQError::ConcurrencyLimit(msg.to_string())
    } else if lower.contains("valid") {
        FlashQError::Validation(msg.to_string())
    } else {
        FlashQError::Server(msg.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_retryable_errors() {
        assert!(FlashQError::Connection("lost".into()).is_retryable());
        assert!(FlashQError::Timeout("5s".into()).is_retryable());
        assert!(FlashQError::RateLimit("exceeded".into()).is_retryable());
        assert!(!FlashQError::Validation("bad name".into()).is_retryable());
        assert!(!FlashQError::Authentication("bad token".into()).is_retryable());
    }

    #[test]
    fn test_parse_server_error() {
        assert!(matches!(
            parse_server_error("Authentication required"),
            FlashQError::Authentication(_)
        ));
        assert!(matches!(
            parse_server_error("rate limit exceeded"),
            FlashQError::RateLimit(_)
        ));
        assert!(matches!(
            parse_server_error("queue is paused"),
            FlashQError::QueuePaused(_)
        ));
        assert!(matches!(
            parse_server_error("something else"),
            FlashQError::Server(_)
        ));
    }

    #[test]
    fn test_check_response_ok() {
        let resp = serde_json::json!({"ok": true, "id": 42});
        assert!(check_response(&resp).is_ok());
    }

    #[test]
    fn test_check_response_error() {
        let resp = serde_json::json!({"ok": false, "error": "Authentication required"});
        let err = check_response(&resp).unwrap_err();
        assert!(matches!(err, FlashQError::Authentication(_)));
    }
}
