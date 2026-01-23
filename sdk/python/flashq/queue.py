"""
flashQ Queue

BullMQ-compatible Queue class for easy migration.
"""

from typing import Any, TypeVar

from .client import FlashQ
from .types import Job, PushOptions, ClientOptions, QueueStats, JobState

T = TypeVar("T")


class Queue:
    """
    BullMQ-compatible Queue class.

    Provides a familiar API for BullMQ users.

    Example:
        ```python
        queue = Queue("emails")
        await queue.connect()

        job = await queue.add("send", {"to": "user@example.com"})
        print(f"Added job {job.id}")

        await queue.close()
        ```
    """

    def __init__(
        self,
        name: str,
        options: ClientOptions | dict[str, Any] | None = None,
    ):
        self._name = name
        self._client = FlashQ(options)
        self._connected = False

    @property
    def name(self) -> str:
        """Queue name."""
        return self._name

    @property
    def client(self) -> FlashQ:
        """Underlying FlashQ client."""
        return self._client

    async def connect(self) -> None:
        """Connect to flashQ server."""
        await self._client.connect()
        self._connected = True

    async def close(self) -> None:
        """Close connection."""
        await self._client.close()
        self._connected = False

    async def __aenter__(self) -> "Queue":
        await self.connect()
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    # =========================================================================
    # BullMQ-compatible API
    # =========================================================================

    async def add(
        self,
        name: str,
        data: T,
        opts: PushOptions | dict[str, Any] | None = None,
    ) -> Job[T]:
        """
        Add a job to the queue (BullMQ-compatible).

        Args:
            name: Job name (used as tag)
            data: Job data
            opts: Push options

        Returns:
            Job object
        """
        if isinstance(opts, dict):
            opts = PushOptions(**opts)
        elif opts is None:
            opts = PushOptions()

        # Add name as tag
        if opts.tags is None:
            opts.tags = []
        if name not in opts.tags:
            opts.tags.append(name)

        job_id = await self._client.push(self._name, data, opts)
        return await self._client.get_job(job_id)

    async def add_bulk(
        self,
        jobs: list[dict[str, Any]],
    ) -> list[Job[Any]]:
        """
        Add multiple jobs (BullMQ-compatible).

        Args:
            jobs: List of {"name": str, "data": Any, "opts": dict}

        Returns:
            List of Job objects
        """
        job_inputs = []
        for job in jobs:
            name = job.get("name", "default")
            data = job.get("data")
            opts = job.get("opts")

            if isinstance(opts, dict):
                opts = PushOptions(**opts)
            elif opts is None:
                opts = PushOptions()

            if opts.tags is None:
                opts.tags = []
            if name not in opts.tags:
                opts.tags.append(name)

            job_inputs.append((data, opts))

        result = await self._client.push_batch(self._name, job_inputs)
        return [await self._client.get_job(jid) for jid in result.job_ids]

    async def get_job(self, job_id: int | str) -> Job[Any] | None:
        """Get a job by ID."""
        try:
            return await self._client.get_job(int(job_id))
        except Exception:
            return None

    async def get_jobs(
        self,
        types: list[str] | str | None = None,
        start: int = 0,
        end: int = 100,
    ) -> list[Job[Any]]:
        """
        Get jobs by state (BullMQ-compatible).

        Args:
            types: Job states ("waiting", "active", "completed", "failed")
            start: Start offset
            end: End offset
        """
        if isinstance(types, str):
            types = [types]

        if types is None:
            types = ["waiting", "active", "completed", "failed"]

        all_jobs = []
        limit = end - start

        for state in types:
            jobs = await self._client.get_jobs(
                self._name,
                state=state,
                limit=limit,
                offset=start,
            )
            all_jobs.extend(jobs)

        return all_jobs[:limit]

    async def get_job_counts(self, *types: str) -> dict[str, int]:
        """Get job counts by state."""
        counts = await self._client.get_job_counts(self._name)

        if types:
            return {t: counts.get(t, 0) for t in types}
        return counts

    async def get_waiting_count(self) -> int:
        """Get waiting job count."""
        counts = await self.get_job_counts("waiting")
        return counts.get("waiting", 0)

    async def get_active_count(self) -> int:
        """Get active job count."""
        counts = await self.get_job_counts("active")
        return counts.get("active", 0)

    async def get_completed_count(self) -> int:
        """Get completed job count."""
        counts = await self.get_job_counts("completed")
        return counts.get("completed", 0)

    async def get_failed_count(self) -> int:
        """Get failed job count."""
        counts = await self.get_job_counts("failed")
        return counts.get("failed", 0)

    async def get_delayed_count(self) -> int:
        """Get delayed job count."""
        counts = await self.get_job_counts("delayed")
        return counts.get("delayed", 0)

    async def pause(self) -> None:
        """Pause the queue."""
        await self._client.pause(self._name)

    async def resume(self) -> None:
        """Resume the queue."""
        await self._client.resume(self._name)

    async def is_paused(self) -> bool:
        """Check if queue is paused."""
        return await self._client.is_paused(self._name)

    async def drain(self) -> None:
        """Remove all waiting jobs."""
        await self._client.drain(self._name)

    async def obliterate(self, force: bool = False) -> None:
        """Remove all queue data."""
        await self._client.obliterate(self._name)

    async def clean(
        self,
        grace: int,
        limit: int = 100,
        type: str = "completed",
    ) -> list[int]:
        """
        Clean jobs by age.

        Args:
            grace: Age in ms
            limit: Max jobs to clean
            type: Job state to clean

        Returns:
            List of cleaned job IDs
        """
        count = await self._client.clean(self._name, grace, type, limit)
        return list(range(count))  # BullMQ returns job IDs, we return count

    async def retry_jobs(self, count: int = 100) -> int:
        """Retry failed jobs from DLQ."""
        return await self._client.retry_dlq(self._name)

    async def remove(self, job_id: int | str) -> bool:
        """Remove a job."""
        return await self._client.cancel(int(job_id))
