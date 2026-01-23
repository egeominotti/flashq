"""
Tests for error handling.
"""

import pytest

from flashq.errors import (
    FlashQError,
    ConnectionError,
    AuthenticationError,
    TimeoutError,
    ValidationError,
    ServerError,
    JobNotFoundError,
    QueueNotFoundError,
    DuplicateJobError,
    RateLimitError,
    parse_server_error,
)


class TestFlashQError:
    def test_basic_error(self):
        error = FlashQError("Something went wrong")

        assert str(error) == "[FLASHQ_ERROR] Something went wrong"
        assert error.message == "Something went wrong"
        assert error.code == "FLASHQ_ERROR"
        assert error.retryable is False

    def test_custom_code(self):
        error = FlashQError("Custom error", "CUSTOM_CODE", retryable=True)

        assert error.code == "CUSTOM_CODE"
        assert error.retryable is True


class TestConnectionError:
    def test_is_retryable(self):
        error = ConnectionError("Connection failed")

        assert error.retryable is True
        assert error.code == "CONNECTION_FAILED"


class TestAuthenticationError:
    def test_not_retryable(self):
        error = AuthenticationError()

        assert error.retryable is False
        assert error.code == "AUTH_FAILED"


class TestTimeoutError:
    def test_has_timeout_ms(self):
        error = TimeoutError("Timed out", timeout_ms=5000)

        assert error.timeout_ms == 5000
        assert error.retryable is True


class TestJobNotFoundError:
    def test_has_job_id(self):
        error = JobNotFoundError(123)

        assert error.job_id == 123
        assert "123" in str(error)


class TestParseServerError:
    def test_auth_error(self):
        error = parse_server_error("Unauthorized access")
        assert isinstance(error, AuthenticationError)

    def test_job_not_found(self):
        error = parse_server_error("Job not found: 123")
        assert isinstance(error, JobNotFoundError)

    def test_queue_paused(self):
        error = parse_server_error("Queue is paused")
        assert isinstance(error, FlashQError)
        assert error.retryable is True

    def test_rate_limit(self):
        error = parse_server_error("Rate limit exceeded")
        assert isinstance(error, RateLimitError)

    def test_duplicate(self):
        error = parse_server_error("Duplicate job already exists")
        assert isinstance(error, DuplicateJobError)

    def test_timeout(self):
        error = parse_server_error("Request timed out")
        assert isinstance(error, TimeoutError)

    def test_connection(self):
        error = parse_server_error("Connection reset")
        assert isinstance(error, ConnectionError)

    def test_validation(self):
        error = parse_server_error("Invalid queue name")
        assert isinstance(error, ValidationError)

    def test_unknown(self):
        error = parse_server_error("Some random error")
        assert isinstance(error, ServerError)
