"""
Tests for type definitions.
"""

import pytest
from datetime import datetime

from flashq import (
    Job,
    JobState,
    PushOptions,
    ClientOptions,
    WorkerOptions,
    JobPayload,
    LogLevel,
)


class TestJobState:
    def test_enum_values(self):
        assert JobState.WAITING == "waiting"
        assert JobState.DELAYED == "delayed"
        assert JobState.ACTIVE == "active"
        assert JobState.COMPLETED == "completed"
        assert JobState.FAILED == "failed"


class TestJob:
    def test_from_dict_basic(self):
        data = {
            "id": 123,
            "queue": "test",
            "data": {"key": "value"},
            "priority": 5,
            "state": "waiting",
        }
        job = Job.from_dict(data)

        assert job.id == 123
        assert job.queue == "test"
        assert job.data == {"key": "value"}
        assert job.priority == 5
        assert job.state == JobState.WAITING

    def test_from_dict_with_timestamps(self):
        data = {
            "id": 1,
            "queue": "test",
            "data": None,
            "created_at": 1704067200000,  # 2024-01-01 00:00:00 UTC (ms)
        }
        job = Job.from_dict(data)

        assert job.created_at is not None
        assert isinstance(job.created_at, datetime)

    def test_from_dict_defaults(self):
        data = {"id": 1, "queue": "test", "data": None}
        job = Job.from_dict(data)

        assert job.priority == 0
        assert job.attempts == 0
        assert job.max_attempts == 3
        assert job.state == JobState.WAITING
        assert job.tags == []


class TestPushOptions:
    def test_defaults(self):
        opts = PushOptions()

        assert opts.priority == 0
        assert opts.delay is None
        assert opts.max_attempts == 3
        assert opts.backoff == 1000
        assert opts.lifo is False

    def test_custom_values(self):
        opts = PushOptions(
            priority=10,
            delay=5000,
            max_attempts=5,
            unique_key="test-key",
            tags=["urgent"],
        )

        assert opts.priority == 10
        assert opts.delay == 5000
        assert opts.max_attempts == 5
        assert opts.unique_key == "test-key"
        assert opts.tags == ["urgent"]


class TestClientOptions:
    def test_defaults(self):
        opts = ClientOptions()

        assert opts.host == "localhost"
        assert opts.port == 6789
        assert opts.http_port == 6790
        assert opts.timeout == 5000
        assert opts.token is None
        assert opts.use_http is False
        assert opts.use_binary is False
        assert opts.auto_reconnect is True

    def test_custom_values(self):
        opts = ClientOptions(
            host="server.example.com",
            port=9999,
            token="secret",
            use_binary=True,
        )

        assert opts.host == "server.example.com"
        assert opts.port == 9999
        assert opts.token == "secret"
        assert opts.use_binary is True


class TestJobPayload:
    def test_to_dict_minimal(self):
        payload = JobPayload(data={"key": "value"})
        result = payload.to_dict()

        assert result == {"data": {"key": "value"}}

    def test_to_dict_with_options(self):
        payload = JobPayload(
            data={"key": "value"},
            priority=10,
            delay=5000,
            tags=["urgent"],
        )
        result = payload.to_dict()

        assert result["data"] == {"key": "value"}
        assert result["priority"] == 10
        assert result["delay"] == 5000
        assert result["tags"] == ["urgent"]

    def test_to_dict_excludes_defaults(self):
        payload = JobPayload(
            data="test",
            priority=0,  # default
            max_attempts=3,  # default
            backoff=1000,  # default
        )
        result = payload.to_dict()

        # Only data should be included
        assert result == {"data": "test"}
