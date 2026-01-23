"""
flashQ SDK Error Definitions

Comprehensive error hierarchy for the SDK.
"""

from typing import Any


class FlashQError(Exception):
    """Base error for all flashQ errors."""

    def __init__(
        self,
        message: str,
        code: str = "FLASHQ_ERROR",
        retryable: bool = False,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.retryable = retryable

    def __str__(self) -> str:
        return f"[{self.code}] {self.message}"


class ConnectionError(FlashQError):
    """Connection-related errors (retryable)."""

    def __init__(self, message: str, code: str = "CONNECTION_FAILED"):
        super().__init__(message, code, retryable=True)


class AuthenticationError(FlashQError):
    """Authentication failed (non-retryable)."""

    def __init__(self, message: str = "Authentication failed"):
        super().__init__(message, "AUTH_FAILED", retryable=False)


class TimeoutError(FlashQError):
    """Operation timed out (retryable)."""

    def __init__(self, message: str = "Operation timed out", timeout_ms: int | None = None):
        super().__init__(message, "TIMEOUT", retryable=True)
        self.timeout_ms = timeout_ms


class ValidationError(FlashQError):
    """Input validation failed (non-retryable)."""

    def __init__(self, message: str):
        super().__init__(message, "VALIDATION_ERROR", retryable=False)


class ServerError(FlashQError):
    """Server returned an error."""

    def __init__(self, message: str, code: str = "SERVER_ERROR", retryable: bool = False):
        super().__init__(message, code, retryable=retryable)


class JobNotFoundError(FlashQError):
    """Job not found."""

    def __init__(self, job_id: int | str):
        super().__init__(f"Job not found: {job_id}", "JOB_NOT_FOUND", retryable=False)
        self.job_id = job_id


class QueueNotFoundError(FlashQError):
    """Queue not found."""

    def __init__(self, queue: str):
        super().__init__(f"Queue not found: {queue}", "QUEUE_NOT_FOUND", retryable=False)
        self.queue = queue


class DuplicateJobError(FlashQError):
    """Duplicate job (unique key violation)."""

    def __init__(self, message: str = "Duplicate job", existing_job_id: int | None = None):
        super().__init__(message, "DUPLICATE_JOB", retryable=False)
        self.existing_job_id = existing_job_id


class QueuePausedError(FlashQError):
    """Queue is paused (retryable)."""

    def __init__(self, queue: str):
        super().__init__(f"Queue is paused: {queue}", "QUEUE_PAUSED", retryable=True)
        self.queue = queue


class RateLimitError(FlashQError):
    """Rate limit exceeded (retryable)."""

    def __init__(self, message: str = "Rate limit exceeded", retry_after: int | None = None):
        super().__init__(message, "RATE_LIMITED", retryable=True)
        self.retry_after = retry_after


class ConcurrencyLimitError(FlashQError):
    """Concurrency limit exceeded (retryable)."""

    def __init__(self, message: str = "Concurrency limit exceeded"):
        super().__init__(message, "CONCURRENCY_LIMITED", retryable=True)


class BatchError(FlashQError):
    """Batch operation partial failure."""

    def __init__(
        self,
        message: str,
        succeeded: list[int],
        failed: list[dict[str, Any]],
    ):
        super().__init__(message, "BATCH_ERROR", retryable=False)
        self.succeeded = succeeded
        self.failed = failed


def parse_server_error(error_message: str) -> FlashQError:
    """Parse server error message and return appropriate error type."""
    msg = error_message.lower()

    # Authentication errors
    if "auth" in msg or "unauthorized" in msg or "invalid token" in msg:
        return AuthenticationError(error_message)

    # Job errors
    if "job not found" in msg or "job does not exist" in msg:
        return JobNotFoundError(error_message)

    # Queue errors
    if "queue not found" in msg:
        return QueueNotFoundError(error_message)
    if "queue paused" in msg or "queue is paused" in msg:
        return QueuePausedError(error_message)

    # Duplicate errors
    if "duplicate" in msg or "unique" in msg or "already exists" in msg:
        return DuplicateJobError(error_message)

    # Rate limiting
    if "rate limit" in msg or "too many requests" in msg:
        return RateLimitError(error_message)

    # Concurrency
    if "concurrency" in msg:
        return ConcurrencyLimitError(error_message)

    # Timeout
    if "timeout" in msg or "timed out" in msg:
        return TimeoutError(error_message)

    # Connection
    if "connection" in msg or "disconnect" in msg or "socket" in msg:
        return ConnectionError(error_message)

    # Validation
    if "invalid" in msg or "validation" in msg or "required" in msg:
        return ValidationError(error_message)

    # Default to server error
    return ServerError(error_message)
