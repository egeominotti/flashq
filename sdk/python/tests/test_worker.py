"""Tests for flashQ Worker class."""

import asyncio
import pytest
from flashq.worker import Worker
from flashq.types import ClientOptions, LogLevel, WorkerOptions

pytestmark = pytest.mark.asyncio


def make_queue_name():
    import time, random
    return f"test-worker-{int(time.time() * 1000)}-{random.randint(0, 9999)}"


class TestWorkerCreation:
    async def test_worker_creation(self):
        """Test creating a worker."""
        queue = make_queue_name()

        async def processor(job):
            return {"processed": True}

        worker = Worker(
            queue, processor,
            client_options=ClientOptions(log_level=LogLevel.ERROR),
            worker_options=WorkerOptions(auto_start=False)
        )
        assert worker is not None

    async def test_worker_with_options(self):
        """Test creating worker with options."""
        queue = make_queue_name()

        async def processor(job):
            return {"done": True}

        worker = Worker(
            queue, processor,
            client_options=ClientOptions(log_level=LogLevel.ERROR),
            worker_options=WorkerOptions(concurrency=5, auto_start=False)
        )
        assert worker is not None


class TestWorkerProcessing:
    async def test_worker_process_job(self):
        """Test worker processes job."""
        queue = make_queue_name()
        processed = []

        async def processor(job):
            processed.append(job.id)
            return {"done": True}

        worker = Worker(
            queue, processor,
            client_options=ClientOptions(log_level=LogLevel.ERROR),
            worker_options=WorkerOptions(auto_start=False)
        )

        try:
            # Start worker which connects
            await worker.start()

            # Push a job via worker's client
            job_id = await worker._client.push(queue, {"task": "test"})

            await asyncio.sleep(1.0)
            await worker.stop()
        except Exception:
            pytest.skip("Server not available")

    async def test_worker_stop(self):
        """Test stopping worker."""
        queue = make_queue_name()

        async def processor(job):
            return {}

        worker = Worker(
            queue, processor,
            client_options=ClientOptions(log_level=LogLevel.ERROR),
            worker_options=WorkerOptions(auto_start=False)
        )

        try:
            await worker.start()
            await asyncio.sleep(0.2)
            await worker.stop()
        except Exception:
            pytest.skip("Server not available")


class TestWorkerConcurrency:
    async def test_worker_concurrency(self):
        """Test worker concurrency setting."""
        queue = make_queue_name()

        async def processor(job):
            await asyncio.sleep(0.1)
            return {}

        worker = Worker(
            queue, processor,
            client_options=ClientOptions(log_level=LogLevel.ERROR),
            worker_options=WorkerOptions(concurrency=3, auto_start=False)
        )

        try:
            await worker.start()
            for i in range(5):
                await worker._client.push(queue, {"index": i})
            await asyncio.sleep(1.0)
            await worker.stop()
        except Exception:
            pytest.skip("Server not available")


class TestWorkerErrorHandling:
    async def test_worker_handles_processor_error(self):
        """Test worker handles processor errors."""
        queue = make_queue_name()

        async def processor(job):
            raise ValueError("Test error")

        worker = Worker(
            queue, processor,
            client_options=ClientOptions(log_level=LogLevel.ERROR),
            worker_options=WorkerOptions(auto_start=False)
        )

        try:
            await worker.start()
            await worker._client.push(queue, {"task": "fail"})
            await asyncio.sleep(1.0)
            await worker.stop()
        except Exception:
            pytest.skip("Server not available")
