"""
flashQ SDK Type Definitions

Type hints and dataclasses for the SDK.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Awaitable, TypeVar, Generic

T = TypeVar("T")
R = TypeVar("R")


class JobState(str, Enum):
    """Job state enumeration."""

    WAITING = "waiting"
    DELAYED = "delayed"
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"
    WAITING_CHILDREN = "waiting-children"


class LogLevel(str, Enum):
    """Log level enumeration."""

    TRACE = "trace"
    DEBUG = "debug"
    INFO = "info"
    WARN = "warn"
    ERROR = "error"
    SILENT = "silent"


@dataclass
class RetryConfig:
    """Retry configuration."""

    max_attempts: int = 3
    delay: int = 1000  # ms
    max_delay: int = 30000  # ms
    backoff_multiplier: float = 2.0
    jitter: bool = True


@dataclass
class ClientOptions:
    """flashQ client configuration options."""

    host: str = "localhost"
    port: int = 6789
    http_port: int = 6790
    timeout: int = 5000
    connect_timeout: int = 5000
    token: str | None = None
    use_http: bool = False
    use_binary: bool = False
    auto_reconnect: bool = True
    reconnect_delay: int = 1000
    max_reconnect_delay: int = 30000
    max_reconnect_attempts: int = 10
    queue_on_disconnect: bool = True
    max_queued_requests: int = 1000
    log_level: LogLevel = LogLevel.INFO


@dataclass
class PushOptions:
    """Options for pushing a job."""

    priority: int = 0
    delay: int | None = None
    ttl: int | None = None
    timeout: int | None = None
    max_attempts: int = 3
    backoff: int = 1000
    unique_key: str | None = None
    depends_on: list[int] | None = None
    tags: list[str] | None = None
    lifo: bool = False
    stall_timeout: int | None = None
    debounce_id: str | None = None
    debounce_ttl: int | None = None
    job_id: str | None = None
    keep_completed_age: int | None = None
    keep_completed_count: int | None = None
    group_id: str | None = None


@dataclass
class Job(Generic[T]):
    """Job object returned from queue operations."""

    id: int
    queue: str
    data: T
    priority: int = 0
    attempts: int = 0
    max_attempts: int = 3
    created_at: datetime | None = None
    run_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    state: JobState = JobState.WAITING
    result: Any = None
    error: str | None = None
    progress: int = 0
    progress_message: str | None = None
    tags: list[str] = field(default_factory=list)
    custom_id: str | None = None
    parent_id: int | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Job[Any]":
        """Create Job from dictionary response."""
        return cls(
            id=data.get("id", 0),
            queue=data.get("queue", ""),
            data=data.get("data"),
            priority=data.get("priority", 0),
            attempts=data.get("attempts", 0),
            max_attempts=data.get("max_attempts", 3),
            created_at=_parse_timestamp(data.get("created_at")),
            run_at=_parse_timestamp(data.get("run_at")),
            started_at=_parse_timestamp(data.get("started_at")),
            completed_at=_parse_timestamp(data.get("completed_at")),
            state=JobState(data.get("state", "waiting")),
            result=data.get("result"),
            error=data.get("error"),
            progress=data.get("progress", 0),
            progress_message=data.get("progress_message"),
            tags=data.get("tags", []),
            custom_id=data.get("custom_id"),
            parent_id=data.get("parent_id"),
        )


@dataclass
class JobPayload(Generic[T]):
    """Payload for pushing a job."""

    data: T
    priority: int = 0
    delay: int | None = None
    ttl: int | None = None
    timeout: int | None = None
    max_attempts: int = 3
    backoff: int = 1000
    unique_key: str | None = None
    depends_on: list[int] | None = None
    tags: list[str] | None = None
    lifo: bool = False
    stall_timeout: int | None = None
    debounce_id: str | None = None
    debounce_ttl: int | None = None
    job_id: str | None = None
    keep_completed_age: int | None = None
    keep_completed_count: int | None = None
    group_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        result: dict[str, Any] = {"data": self.data}
        if self.priority != 0:
            result["priority"] = self.priority
        if self.delay is not None:
            result["delay"] = self.delay
        if self.ttl is not None:
            result["ttl"] = self.ttl
        if self.timeout is not None:
            result["timeout"] = self.timeout
        if self.max_attempts != 3:
            result["max_attempts"] = self.max_attempts
        if self.backoff != 1000:
            result["backoff"] = self.backoff
        if self.unique_key is not None:
            result["unique_key"] = self.unique_key
        if self.depends_on:
            result["depends_on"] = self.depends_on
        if self.tags:
            result["tags"] = self.tags
        if self.lifo:
            result["lifo"] = True
        if self.stall_timeout is not None:
            result["stall_timeout"] = self.stall_timeout
        if self.debounce_id is not None:
            result["debounce_id"] = self.debounce_id
        if self.debounce_ttl is not None:
            result["debounce_ttl"] = self.debounce_ttl
        if self.job_id is not None:
            result["jobId"] = self.job_id
        if self.keep_completed_age is not None:
            result["keepCompletedAge"] = self.keep_completed_age
        if self.keep_completed_count is not None:
            result["keepCompletedCount"] = self.keep_completed_count
        if self.group_id is not None:
            result["group_id"] = self.group_id
        return result


@dataclass
class BatchPushResult:
    """Result of a batch push operation."""

    success: bool
    job_ids: list[int]
    failed: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class QueueStats:
    """Queue statistics."""

    waiting: int = 0
    active: int = 0
    completed: int = 0
    failed: int = 0
    delayed: int = 0
    paused: bool = False


@dataclass
class CronJob:
    """Cron job definition."""

    name: str
    queue: str
    schedule: str
    data: Any = None
    options: PushOptions | None = None


@dataclass
class WorkerOptions:
    """Worker configuration options."""

    concurrency: int = 1
    batch_size: int = 100
    auto_start: bool = True
    close_timeout: int = 30000
    stall_timeout: int = 30000
    log_level: LogLevel = LogLevel.INFO


# Type aliases
JobProcessor = Callable[[Job[T]], R | Awaitable[R]]
FailedJobCallback = Callable[[Job[Any], Exception], None | Awaitable[None]]


def _parse_timestamp(value: Any) -> datetime | None:
    """Parse timestamp from various formats."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000)  # ms to seconds
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None
