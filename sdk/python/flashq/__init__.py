"""
flashQ Python SDK

High-performance Python client for flashQ job queue.

Example:
    ```python
    from flashq import FlashQ, Worker, Queue

    # Using the client directly
    async with FlashQ() as client:
        job_id = await client.push("emails", {"to": "user@example.com"})
        job = await client.pull("emails")
        await client.ack(job.id)

    # Using Worker for processing
    async def process(job):
        print(f"Processing {job.data}")
        return {"done": True}

    worker = Worker("emails", process)
    await worker.start()

    # Using Queue (BullMQ-compatible)
    async with Queue("emails") as queue:
        job = await queue.add("send", {"to": "user@example.com"})
    ```
"""

__version__ = "0.3.6"

from .client import FlashQ
from .worker import Worker, create_worker, WorkerState, WorkerEvents
from .queue import Queue
from .types import (
    Job,
    JobState,
    JobPayload,
    PushOptions,
    ClientOptions,
    WorkerOptions,
    RetryConfig,
    QueueStats,
    CronJob,
    BatchPushResult,
    LogLevel,
)
from .errors import (
    FlashQError,
    ConnectionError,
    AuthenticationError,
    TimeoutError,
    ValidationError,
    ServerError,
    JobNotFoundError,
    QueueNotFoundError,
    DuplicateJobError,
    QueuePausedError,
    RateLimitError,
    ConcurrencyLimitError,
    BatchError,
)
from .utils import Logger, retry, RetryPresets

__all__ = [
    # Version
    "__version__",
    # Client
    "FlashQ",
    # Worker
    "Worker",
    "create_worker",
    "WorkerState",
    "WorkerEvents",
    # Queue
    "Queue",
    # Types
    "Job",
    "JobState",
    "JobPayload",
    "PushOptions",
    "ClientOptions",
    "WorkerOptions",
    "RetryConfig",
    "QueueStats",
    "CronJob",
    "BatchPushResult",
    "LogLevel",
    # Errors
    "FlashQError",
    "ConnectionError",
    "AuthenticationError",
    "TimeoutError",
    "ValidationError",
    "ServerError",
    "JobNotFoundError",
    "QueueNotFoundError",
    "DuplicateJobError",
    "QueuePausedError",
    "RateLimitError",
    "ConcurrencyLimitError",
    "BatchError",
    # Utils
    "Logger",
    "retry",
    "RetryPresets",
]
