use once_cell::sync::Lazy;
use regex::Regex;

use crate::constants::{MAX_BATCH_SIZE, MAX_QUEUE_NAME_LENGTH, QUEUE_NAME_PATTERN};
use crate::errors::{FlashQError, Result};

static QUEUE_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(QUEUE_NAME_PATTERN).expect("invalid queue name regex"));

/// Validate a queue name format.
pub fn validate_queue_name(queue: &str) -> Result<()> {
    if queue.is_empty() {
        return Err(FlashQError::Validation("queue name is required".into()));
    }
    if queue.len() > MAX_QUEUE_NAME_LENGTH {
        return Err(FlashQError::Validation(format!(
            "queue name exceeds max length ({MAX_QUEUE_NAME_LENGTH})"
        )));
    }
    if !QUEUE_REGEX.is_match(queue) {
        return Err(FlashQError::Validation(
            "queue name must contain only alphanumeric, underscore, hyphen, or dot".into(),
        ));
    }
    Ok(())
}

/// Validate batch operation size.
pub fn validate_batch_size(count: usize) -> Result<()> {
    if count > MAX_BATCH_SIZE {
        return Err(FlashQError::Validation(format!(
            "batch size ({count}) exceeds max ({MAX_BATCH_SIZE})"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_queue_names() {
        assert!(validate_queue_name("emails").is_ok());
        assert!(validate_queue_name("my-queue").is_ok());
        assert!(validate_queue_name("queue.v2").is_ok());
        assert!(validate_queue_name("queue_name_123").is_ok());
    }

    #[test]
    fn test_invalid_queue_names() {
        assert!(validate_queue_name("").is_err());
        assert!(validate_queue_name("has space").is_err());
        assert!(validate_queue_name("has/slash").is_err());
        assert!(validate_queue_name("has@symbol").is_err());
        let long_name = "a".repeat(MAX_QUEUE_NAME_LENGTH + 1);
        assert!(validate_queue_name(&long_name).is_err());
    }

    #[test]
    fn test_batch_size_validation() {
        assert!(validate_batch_size(1).is_ok());
        assert!(validate_batch_size(1000).is_ok());
        assert!(validate_batch_size(1001).is_err());
    }
}
