"""
Tests for validation functions.
"""

import pytest

from flashq.client.flashq import (
    validate_queue_name,
    validate_job_data_size,
    validate_batch_size,
)
from flashq.errors import ValidationError


class TestValidateQueueName:
    def test_valid_names(self):
        # Should not raise
        validate_queue_name("emails")
        validate_queue_name("user-notifications")
        validate_queue_name("task_queue")
        validate_queue_name("queue.v2")
        validate_queue_name("Queue123")

    def test_empty_name(self):
        with pytest.raises(ValidationError):
            validate_queue_name("")

    def test_too_long(self):
        with pytest.raises(ValidationError):
            validate_queue_name("x" * 300)

    def test_invalid_characters(self):
        with pytest.raises(ValidationError):
            validate_queue_name("queue/name")

        with pytest.raises(ValidationError):
            validate_queue_name("queue name")

        with pytest.raises(ValidationError):
            validate_queue_name("queue@name")


class TestValidateJobDataSize:
    def test_small_data(self):
        # Should not raise
        validate_job_data_size({"key": "value"})
        validate_job_data_size("small string")
        validate_job_data_size([1, 2, 3])

    def test_large_data(self):
        # 2MB of data
        large_data = "x" * (2 * 1024 * 1024)
        with pytest.raises(ValidationError):
            validate_job_data_size(large_data)


class TestValidateBatchSize:
    def test_valid_sizes(self):
        # Should not raise
        validate_batch_size(1)
        validate_batch_size(100)
        validate_batch_size(1000)

    def test_too_large(self):
        with pytest.raises(ValidationError):
            validate_batch_size(1001)

        with pytest.raises(ValidationError):
            validate_batch_size(5000)
