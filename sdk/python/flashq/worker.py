"""
flashQ Worker

Job processor with concurrent workers and graceful shutdown.
"""

import asyncio
import signal
from enum import Enum
from typing import Any, Callable, TypeVar, Generic, Awaitable

from .client import FlashQ
from .types import Job, ClientOptions, WorkerOptions, LogLevel
from .errors import FlashQError
from .utils.logger import Logger
from .constants import (
    WORKER_PULL_TIMEOUT,
    WORKER_ERROR_RETRY_DELAY,
    DEFAULT_WORKER_CONCURRENCY,
    DEFAULT_BATCH_SIZE,
    DEFAULT_CLOSE_TIMEOUT,
)

T = TypeVar("T")
R = TypeVar("R")


class WorkerState(str, Enum):
    """Worker state."""

    IDLE = "idle"
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"


class WorkerEvents(Generic[T, R]):
    """
    Worker event callbacks with typed signatures.

    Type Parameters:
        T: Job data type
        R: Job result type
    """

    def __init__(self) -> None:
        self.on_ready: Callable[[], None | Awaitable[None]] | None = None
        self.on_active: Callable[[Job[T], int], None | Awaitable[None]] | None = None
        self.on_completed: Callable[[Job[T], R, int], None | Awaitable[None]] | None = None
        self.on_failed: Callable[[Job[T], Exception, int], None | Awaitable[None]] | None = None
        self.on_error: Callable[[Exception], None | Awaitable[None]] | None = None
        self.on_stopping: Callable[[], None | Awaitable[None]] | None = None
        self.on_stopped: Callable[[], None | Awaitable[None]] | None = None


class Worker(Generic[T, R]):
    """
    Job processor for flashQ queues.

    Supports concurrent processing, batch pulls, and graceful shutdown.

    Example:
        ```python
        async def process_email(job: Job[dict]) -> dict:
            # Process the job
            return {"sent": True}

        worker = Worker("emails", process_email)
        await worker.start()
        # Worker runs until stopped
        await worker.stop()
        ```
    """

    def __init__(
        self,
        queue: str | list[str],
        processor: Callable[[Job[T]], R | Awaitable[R]],
        client_options: ClientOptions | dict[str, Any] | None = None,
        worker_options: WorkerOptions | dict[str, Any] | None = None,
    ):
        # Queues
        if isinstance(queue, str):
            self._queues = [queue]
        else:
            self._queues = list(queue)

        self._processor = processor

        # Options
        if isinstance(client_options, dict):
            client_options = ClientOptions(**client_options)
        self._client_options = client_options or ClientOptions()

        if isinstance(worker_options, dict):
            worker_options = WorkerOptions(**worker_options)
        self._worker_options = worker_options or WorkerOptions()

        # State
        self._state = WorkerState.IDLE
        self._clients: list[FlashQ] = []
        self._workers: list[asyncio.Task[None]] = []
        self._processing = 0
        self._processed = 0
        self._failed_count = 0
        self._shutdown_event = asyncio.Event()

        # Events
        self.events: WorkerEvents[T, R] = WorkerEvents()

        # Logger
        self._logger = Logger(
            level=self._worker_options.log_level,
            prefix="Worker",
        )

        # Auto-start
        if self._worker_options.auto_start:
            asyncio.create_task(self.start())

    @property
    def state(self) -> WorkerState:
        """Get worker state."""
        return self._state

    @property
    def processing(self) -> int:
        """Get number of jobs currently processing."""
        return self._processing

    @property
    def processed(self) -> int:
        """Get total number of jobs processed."""
        return self._processed

    @property
    def failed(self) -> int:
        """Get total number of jobs failed."""
        return self._failed_count

    async def start(self) -> None:
        """Start the worker."""
        if self._state != WorkerState.IDLE:
            return

        self._state = WorkerState.STARTING
        self._logger.info("Starting", queues=self._queues)

        # Create clients (one per concurrency level)
        concurrency = self._worker_options.concurrency or DEFAULT_WORKER_CONCURRENCY

        for _ in range(concurrency):
            client = FlashQ(self._client_options)
            await client.connect()
            self._clients.append(client)

        # Start worker tasks
        for i in range(concurrency):
            task = asyncio.create_task(self._worker_loop(i))
            self._workers.append(task)

        self._state = WorkerState.RUNNING
        self._logger.info("Started", concurrency=concurrency)

        if self.events.on_ready:
            self._emit(self.events.on_ready)

    async def stop(self, force: bool = False) -> None:
        """
        Stop the worker.

        Args:
            force: If True, abort immediately without waiting for jobs
        """
        if self._state in (WorkerState.STOPPING, WorkerState.STOPPED):
            return

        self._state = WorkerState.STOPPING
        self._logger.info("Stopping", force=force)

        if self.events.on_stopping:
            self._emit(self.events.on_stopping)

        # Signal shutdown
        self._shutdown_event.set()

        if force:
            # Cancel all workers
            for task in self._workers:
                task.cancel()
        else:
            # Wait for workers with timeout
            timeout = self._worker_options.close_timeout or DEFAULT_CLOSE_TIMEOUT

            try:
                await asyncio.wait_for(
                    asyncio.gather(*self._workers, return_exceptions=True),
                    timeout=timeout / 1000,
                )
            except asyncio.TimeoutError:
                self._logger.warn("Timeout waiting for workers, forcing stop")
                for task in self._workers:
                    task.cancel()

        self._workers.clear()

        # Close clients
        for client in self._clients:
            await client.close()
        self._clients.clear()

        self._state = WorkerState.STOPPED
        self._logger.info("Stopped", processed=self._processed, failed=self._failed_count)

        if self.events.on_stopped:
            self._emit(self.events.on_stopped)

    async def wait(self) -> None:
        """Wait for worker to stop."""
        await self._shutdown_event.wait()

    async def _worker_loop(self, worker_id: int) -> None:
        """Main worker loop for processing jobs."""
        client = self._clients[worker_id]
        batch_size = self._worker_options.batch_size or DEFAULT_BATCH_SIZE
        queue_index = 0

        while not self._shutdown_event.is_set():
            try:
                # Round-robin through queues
                queue = self._queues[queue_index % len(self._queues)]
                queue_index += 1

                # Pull batch of jobs
                jobs = await client.pull_batch(queue, batch_size, WORKER_PULL_TIMEOUT)

                if not jobs:
                    continue

                # Process jobs concurrently
                tasks = [self._process_job(client, job, worker_id) for job in jobs]
                await asyncio.gather(*tasks, return_exceptions=True)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self._logger.error("Worker loop error", error=str(e))

                if self.events.on_error:
                    self._emit(self.events.on_error, e)

                await asyncio.sleep(WORKER_ERROR_RETRY_DELAY / 1000)

    async def _process_job(self, client: FlashQ, job: Job[T], worker_id: int) -> None:
        """Process a single job."""
        self._processing += 1

        if self.events.on_active:
            self._emit(self.events.on_active, job, worker_id)

        try:
            # Call processor
            result = self._processor(job)
            if asyncio.iscoroutine(result):
                result = await result

            # Acknowledge success
            await client.ack(job.id, result)

            self._processed += 1

            if self.events.on_completed:
                self._emit(self.events.on_completed, job, result, worker_id)

        except Exception as e:
            self._failed_count += 1
            error_msg = str(e)

            try:
                await client.fail(job.id, error_msg)
            except Exception as fail_error:
                self._logger.error(
                    "Failed to report job failure",
                    job_id=job.id,
                    error=str(fail_error),
                )

            if self.events.on_failed:
                self._emit(self.events.on_failed, job, e, worker_id)

        finally:
            self._processing -= 1

    def _emit(self, callback: Callable[..., Any], *args: Any) -> None:
        """Emit event callback."""
        try:
            result = callback(*args)
            if asyncio.iscoroutine(result):
                asyncio.create_task(result)
        except Exception as e:
            self._logger.error("Event callback error", error=str(e))

    def on(self, event: str, callback: Callable[..., Any]) -> "Worker[T, R]":
        """
        Register event callback.

        Events:
            - ready: Worker started
            - active: Job started processing
            - completed: Job completed
            - failed: Job failed
            - error: Worker error
            - stopping: Worker stopping
            - stopped: Worker stopped
        """
        if event == "ready":
            self.events.on_ready = callback
        elif event == "active":
            self.events.on_active = callback
        elif event == "completed":
            self.events.on_completed = callback
        elif event == "failed":
            self.events.on_failed = callback
        elif event == "error":
            self.events.on_error = callback
        elif event == "stopping":
            self.events.on_stopping = callback
        elif event == "stopped":
            self.events.on_stopped = callback
        return self


def create_worker(
    queue: str | list[str],
    processor: Callable[[Job[T]], R | Awaitable[R]],
    client_options: ClientOptions | dict[str, Any] | None = None,
    worker_options: WorkerOptions | dict[str, Any] | None = None,
) -> Worker[T, R]:
    """
    Create a new worker.

    Convenience function for creating workers.
    """
    return Worker(queue, processor, client_options, worker_options)
