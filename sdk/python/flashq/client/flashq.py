"""
flashQ Client

Main client class with all queue operations.
"""

import asyncio
import re
from typing import Any, TypeVar

from .connection import FlashQConnection
from ..types import (
    ClientOptions,
    Job,
    PushOptions,
    JobPayload,
    BatchPushResult,
    QueueStats,
    CronJob,
    JobState,
)
from ..errors import ValidationError, JobNotFoundError
from ..constants import (
    MAX_QUEUE_NAME_LENGTH,
    MAX_JOB_DATA_SIZE,
    MAX_BATCH_SIZE,
    QUEUE_NAME_PATTERN,
    DEFAULT_PULL_TIMEOUT,
    CLIENT_TIMEOUT_BUFFER,
)

T = TypeVar("T")


def validate_queue_name(queue: str) -> None:
    """Validate queue name format."""
    if not queue:
        raise ValidationError("Queue name is required")
    if len(queue) > MAX_QUEUE_NAME_LENGTH:
        raise ValidationError(
            f"Queue name exceeds max length ({MAX_QUEUE_NAME_LENGTH} chars)"
        )
    if not re.match(QUEUE_NAME_PATTERN, queue):
        raise ValidationError(
            "Queue name must contain only alphanumeric, underscore, hyphen, or dot"
        )


def validate_job_data_size(data: Any) -> None:
    """Validate job data size."""
    import json

    try:
        size = len(json.dumps(data).encode())
    except (TypeError, ValueError):
        size = 0

    if size > MAX_JOB_DATA_SIZE:
        raise ValidationError(
            f"Job data size ({size} bytes) exceeds max ({MAX_JOB_DATA_SIZE} bytes)"
        )


def validate_batch_size(count: int, operation: str = "push") -> None:
    """Validate batch operation size."""
    if count > MAX_BATCH_SIZE:
        raise ValidationError(
            f"Batch {operation} size ({count}) exceeds max ({MAX_BATCH_SIZE})"
        )


def map_job_to_payload(data: T, options: PushOptions | None = None) -> JobPayload[T]:
    """Map job data and options to payload."""
    opts = options or PushOptions()
    return JobPayload(
        data=data,
        priority=opts.priority,
        delay=opts.delay,
        ttl=opts.ttl,
        timeout=opts.timeout,
        max_attempts=opts.max_attempts,
        backoff=opts.backoff,
        unique_key=opts.unique_key,
        depends_on=opts.depends_on,
        tags=opts.tags,
        lifo=opts.lifo,
        stall_timeout=opts.stall_timeout,
        debounce_id=opts.debounce_id,
        debounce_ttl=opts.debounce_ttl,
        job_id=opts.job_id,
        keep_completed_age=opts.keep_completed_age,
        keep_completed_count=opts.keep_completed_count,
    )


class FlashQ(FlashQConnection):
    """
    flashQ client with all queue operations.

    Example:
        ```python
        async with FlashQ() as client:
            job_id = await client.push("emails", {"to": "user@example.com"})
            job = await client.pull("emails")
            await client.ack(job.id, {"sent": True})
        ```
    """

    def __init__(self, options: ClientOptions | dict[str, Any] | None = None):
        if isinstance(options, dict):
            options = ClientOptions(**options)
        super().__init__(options)

    async def __aenter__(self) -> "FlashQ":
        await self.connect()
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    # =========================================================================
    # Core Operations
    # =========================================================================

    async def push(
        self,
        queue: str,
        data: T,
        options: PushOptions | None = None,
    ) -> int:
        """
        Push a job to a queue.

        Args:
            queue: Queue name
            data: Job data
            options: Push options

        Returns:
            Job ID

        Example:
            ```python
            job_id = await client.push("emails", {"to": "user@example.com"})
            ```
        """
        validate_queue_name(queue)
        validate_job_data_size(data)

        payload = map_job_to_payload(data, options)

        response = await self._send({
            "cmd": "PUSH",
            "queue": queue,
            **payload.to_dict(),
        })

        return response.get("id", 0)

    async def push_batch(
        self,
        queue: str,
        jobs: list[tuple[T, PushOptions | None]] | list[T],
    ) -> BatchPushResult:
        """
        Push multiple jobs to a queue.

        Args:
            queue: Queue name
            jobs: List of (data, options) tuples or just data

        Returns:
            BatchPushResult with job IDs and failures
        """
        validate_queue_name(queue)
        validate_batch_size(len(jobs), "push")

        payloads = []
        for item in jobs:
            if isinstance(item, tuple):
                data, options = item
            else:
                data, options = item, None
            validate_job_data_size(data)
            payloads.append(map_job_to_payload(data, options).to_dict())

        response = await self._send({
            "cmd": "PUSHB",
            "queue": queue,
            "jobs": payloads,
        })

        return BatchPushResult(
            success=response.get("success", False),
            job_ids=response.get("ids", []),
            failed=response.get("failed", []),
        )

    async def pull(
        self,
        queue: str,
        timeout: int | None = None,
    ) -> Job[Any] | None:
        """
        Pull a job from a queue (blocking).

        Args:
            queue: Queue name
            timeout: Wait timeout in ms (default: 30000)

        Returns:
            Job or None if timeout
        """
        validate_queue_name(queue)

        wait_timeout = timeout or DEFAULT_PULL_TIMEOUT
        client_timeout = wait_timeout + CLIENT_TIMEOUT_BUFFER

        response = await self._send(
            {"cmd": "PULL", "queue": queue, "timeout": wait_timeout},
            timeout=client_timeout,
        )

        job_data = response.get("job")
        if job_data:
            return Job.from_dict(job_data)
        return None

    async def pull_batch(
        self,
        queue: str,
        count: int,
        timeout: int | None = None,
    ) -> list[Job[Any]]:
        """
        Pull multiple jobs from a queue.

        Args:
            queue: Queue name
            count: Number of jobs to pull
            timeout: Wait timeout in ms

        Returns:
            List of jobs
        """
        validate_queue_name(queue)
        validate_batch_size(count, "pull")

        wait_timeout = timeout or DEFAULT_PULL_TIMEOUT
        client_timeout = wait_timeout + CLIENT_TIMEOUT_BUFFER

        response = await self._send(
            {"cmd": "PULLB", "queue": queue, "count": count, "timeout": wait_timeout},
            timeout=client_timeout,
        )

        jobs_data = response.get("jobs", [])
        return [Job.from_dict(j) for j in jobs_data]

    async def ack(self, job_id: int, result: Any = None) -> bool:
        """
        Acknowledge job completion.

        Args:
            job_id: Job ID
            result: Optional result data

        Returns:
            True if acknowledged
        """
        cmd: dict[str, Any] = {"cmd": "ACK", "id": job_id}
        if result is not None:
            cmd["result"] = result

        response = await self._send(cmd)
        return response.get("success", False)

    async def ack_batch(self, job_ids: list[int]) -> bool:
        """Acknowledge multiple jobs."""
        validate_batch_size(len(job_ids), "ack")

        response = await self._send({"cmd": "ACKB", "ids": job_ids})
        return response.get("success", False)

    async def fail(
        self,
        job_id: int,
        error: str | Exception | None = None,
    ) -> bool:
        """
        Fail a job (will retry or go to DLQ).

        Args:
            job_id: Job ID
            error: Error message or exception

        Returns:
            True if failed
        """
        error_msg = str(error) if error else None

        response = await self._send({
            "cmd": "FAIL",
            "id": job_id,
            "error": error_msg,
        })
        return response.get("success", False)

    # =========================================================================
    # Job Query
    # =========================================================================

    async def get_job(self, job_id: int) -> Job[Any]:
        """Get job by ID."""
        response = await self._send({"cmd": "GETJOB", "id": job_id})

        job_data = response.get("job")
        if not job_data:
            raise JobNotFoundError(job_id)

        return Job.from_dict(job_data)

    async def get_state(self, job_id: int) -> JobState | None:
        """Get job state only."""
        response = await self._send({"cmd": "GETSTATE", "id": job_id})

        state = response.get("state")
        if state:
            return JobState(state)
        return None

    async def get_result(self, job_id: int) -> Any:
        """Get job result."""
        response = await self._send({"cmd": "GETRESULT", "id": job_id})
        return response.get("result")

    async def get_job_by_custom_id(self, custom_id: str) -> Job[Any] | None:
        """Get job by custom ID."""
        response = await self._send({"cmd": "GETJOBBYCUSTOMID", "customId": custom_id})

        job_data = response.get("job")
        if job_data:
            return Job.from_dict(job_data)
        return None

    async def get_jobs(
        self,
        queue: str,
        state: JobState | str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Job[Any]]:
        """Get jobs with filtering."""
        validate_queue_name(queue)

        cmd: dict[str, Any] = {
            "cmd": "GETJOBS",
            "queue": queue,
            "limit": limit,
            "offset": offset,
        }
        if state:
            cmd["state"] = state.value if isinstance(state, JobState) else state

        response = await self._send(cmd)
        jobs_data = response.get("jobs", [])
        return [Job.from_dict(j) for j in jobs_data]

    async def get_job_counts(self, queue: str) -> dict[str, int]:
        """Get job counts by state."""
        validate_queue_name(queue)

        response = await self._send({"cmd": "GETJOBCOUNTS", "queue": queue})
        return response.get("counts", {})

    async def count(self, queue: str) -> int:
        """Count waiting + delayed jobs."""
        validate_queue_name(queue)

        response = await self._send({"cmd": "COUNT", "queue": queue})
        return response.get("count", 0)

    # =========================================================================
    # Job Management
    # =========================================================================

    async def cancel(self, job_id: int) -> bool:
        """Cancel a pending job."""
        response = await self._send({"cmd": "CANCEL", "id": job_id})
        return response.get("success", False)

    async def progress(
        self,
        job_id: int,
        progress: int,
        message: str | None = None,
    ) -> bool:
        """Update job progress (0-100)."""
        cmd: dict[str, Any] = {"cmd": "PROGRESS", "id": job_id, "progress": progress}
        if message:
            cmd["message"] = message

        response = await self._send(cmd)
        return response.get("success", False)

    async def get_progress(self, job_id: int) -> tuple[int, str | None]:
        """Get job progress."""
        response = await self._send({"cmd": "GETPROGRESS", "id": job_id})
        return response.get("progress", 0), response.get("message")

    async def finished(
        self,
        job_id: int,
        timeout: int = 30000,
    ) -> Any:
        """Wait for job completion."""
        response = await self._send(
            {"cmd": "WAITJOB", "id": job_id, "timeout": timeout},
            timeout=timeout + CLIENT_TIMEOUT_BUFFER,
        )
        return response.get("result")

    async def update(self, job_id: int, data: Any) -> bool:
        """Update job data."""
        response = await self._send({"cmd": "UPDATE", "id": job_id, "data": data})
        return response.get("success", False)

    async def change_priority(self, job_id: int, priority: int) -> bool:
        """Change job priority."""
        response = await self._send({
            "cmd": "CHANGEPRIORITY",
            "id": job_id,
            "priority": priority,
        })
        return response.get("success", False)

    async def move_to_delayed(self, job_id: int, delay: int) -> bool:
        """Move active job back to delayed."""
        response = await self._send({
            "cmd": "MOVETODELAYED",
            "id": job_id,
            "delay": delay,
        })
        return response.get("success", False)

    async def promote(self, job_id: int) -> bool:
        """Move delayed job to waiting."""
        response = await self._send({"cmd": "PROMOTE", "id": job_id})
        return response.get("success", False)

    async def discard(self, job_id: int) -> bool:
        """Move job to DLQ."""
        response = await self._send({"cmd": "DISCARD", "id": job_id})
        return response.get("success", False)

    async def heartbeat(self, job_id: int) -> bool:
        """Send heartbeat for long-running job."""
        response = await self._send({"cmd": "HEARTBEAT", "id": job_id})
        return response.get("success", False)

    async def log(
        self,
        job_id: int,
        message: str,
        level: str = "info",
    ) -> bool:
        """Add log entry to job."""
        response = await self._send({
            "cmd": "LOG",
            "id": job_id,
            "message": message,
            "level": level,
        })
        return response.get("success", False)

    async def get_logs(self, job_id: int) -> list[dict[str, Any]]:
        """Get job log entries."""
        response = await self._send({"cmd": "GETLOGS", "id": job_id})
        return response.get("logs", [])

    # =========================================================================
    # Queue Management
    # =========================================================================

    async def pause(self, queue: str) -> bool:
        """Pause a queue."""
        validate_queue_name(queue)
        response = await self._send({"cmd": "PAUSE", "queue": queue})
        return response.get("success", False)

    async def resume(self, queue: str) -> bool:
        """Resume a queue."""
        validate_queue_name(queue)
        response = await self._send({"cmd": "RESUME", "queue": queue})
        return response.get("success", False)

    async def is_paused(self, queue: str) -> bool:
        """Check if queue is paused."""
        validate_queue_name(queue)
        response = await self._send({"cmd": "ISPAUSED", "queue": queue})
        return response.get("paused", False)

    async def drain(self, queue: str) -> int:
        """Remove all waiting jobs from queue."""
        validate_queue_name(queue)
        response = await self._send({"cmd": "DRAIN", "queue": queue})
        return response.get("count", 0)

    async def obliterate(self, queue: str) -> bool:
        """Remove ALL queue data."""
        validate_queue_name(queue)
        response = await self._send({"cmd": "OBLITERATE", "queue": queue})
        return response.get("success", False)

    async def clean(
        self,
        queue: str,
        grace: int,
        state: JobState | str,
        limit: int | None = None,
    ) -> int:
        """Cleanup jobs by age and state."""
        validate_queue_name(queue)

        cmd: dict[str, Any] = {
            "cmd": "CLEAN",
            "queue": queue,
            "grace": grace,
            "state": state.value if isinstance(state, JobState) else state,
        }
        if limit is not None:
            cmd["limit"] = limit

        response = await self._send(cmd)
        return response.get("count", 0)

    async def list_queues(self) -> list[str]:
        """List all queues."""
        response = await self._send({"cmd": "LISTQUEUES"})
        return response.get("queues", [])

    # =========================================================================
    # DLQ Operations
    # =========================================================================

    async def get_dlq(self, queue: str, count: int = 100) -> list[Job[Any]]:
        """Get dead letter queue jobs."""
        validate_queue_name(queue)

        response = await self._send({"cmd": "DLQ", "queue": queue, "count": count})
        jobs_data = response.get("jobs", [])
        return [Job.from_dict(j) for j in jobs_data]

    async def retry_dlq(
        self,
        queue: str,
        job_id: int | None = None,
    ) -> int:
        """Retry DLQ jobs."""
        validate_queue_name(queue)

        cmd: dict[str, Any] = {"cmd": "RETRYDLQ", "queue": queue}
        if job_id is not None:
            cmd["id"] = job_id

        response = await self._send(cmd)
        return response.get("count", 0)

    # =========================================================================
    # Rate Limiting
    # =========================================================================

    async def set_rate_limit(self, queue: str, limit: int) -> bool:
        """Set queue rate limit (jobs/second)."""
        validate_queue_name(queue)
        response = await self._send({
            "cmd": "RATELIMIT",
            "queue": queue,
            "limit": limit,
        })
        return response.get("success", False)

    async def clear_rate_limit(self, queue: str) -> bool:
        """Clear queue rate limit."""
        validate_queue_name(queue)
        response = await self._send({"cmd": "RATELIMITCLEAR", "queue": queue})
        return response.get("success", False)

    async def set_concurrency(self, queue: str, limit: int) -> bool:
        """Set concurrency limit."""
        validate_queue_name(queue)
        response = await self._send({
            "cmd": "SETCONCURRENCY",
            "queue": queue,
            "limit": limit,
        })
        return response.get("success", False)

    async def clear_concurrency(self, queue: str) -> bool:
        """Clear concurrency limit."""
        validate_queue_name(queue)
        response = await self._send({"cmd": "CLEARCONCURRENCY", "queue": queue})
        return response.get("success", False)

    # =========================================================================
    # Cron Jobs
    # =========================================================================

    async def add_cron(
        self,
        name: str,
        queue: str,
        schedule: str,
        data: Any = None,
        options: PushOptions | None = None,
    ) -> bool:
        """Add a cron job."""
        validate_queue_name(queue)

        cmd: dict[str, Any] = {
            "cmd": "CRON",
            "name": name,
            "queue": queue,
            "schedule": schedule,
        }
        if data is not None:
            cmd["data"] = data
        if options:
            cmd["options"] = map_job_to_payload(None, options).to_dict()

        response = await self._send(cmd)
        return response.get("success", False)

    async def delete_cron(self, name: str) -> bool:
        """Delete a cron job."""
        response = await self._send({"cmd": "CRONDELETE", "name": name})
        return response.get("success", False)

    async def list_crons(self) -> list[CronJob]:
        """List all cron jobs."""
        response = await self._send({"cmd": "CRONLIST"})
        crons = response.get("crons", [])
        return [
            CronJob(
                name=c["name"],
                queue=c["queue"],
                schedule=c["schedule"],
                data=c.get("data"),
            )
            for c in crons
        ]

    # =========================================================================
    # Monitoring
    # =========================================================================

    async def stats(self) -> dict[str, QueueStats]:
        """Get queue statistics."""
        response = await self._send({"cmd": "STATS"})
        stats_data = response.get("queues", {})
        return {
            queue: QueueStats(
                waiting=s.get("waiting", 0),
                active=s.get("active", 0),
                completed=s.get("completed", 0),
                failed=s.get("failed", 0),
                delayed=s.get("delayed", 0),
                paused=s.get("paused", False),
            )
            for queue, s in stats_data.items()
        }

    async def metrics(self) -> dict[str, Any]:
        """Get detailed metrics."""
        response = await self._send({"cmd": "METRICS"})
        return response.get("metrics", {})
