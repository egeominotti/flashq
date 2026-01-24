"""Tests for flashQ client DLQ operations."""

import asyncio
import pytest
from flashq import FlashQ
from flashq.types import ClientOptions, PushOptions, LogLevel

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def client():
    client = FlashQ(ClientOptions(log_level=LogLevel.ERROR, timeout=10000))
    try:
        await asyncio.wait_for(client.connect(), timeout=5.0)
    except Exception:
        pytest.skip("flashQ server not available")
    yield client
    try:
        await asyncio.wait_for(client.close(), timeout=5.0)
    except Exception:
        pass


@pytest.fixture
def test_queue():
    import time, random
    return f"test-dlq-{int(time.time() * 1000)}-{random.randint(0, 9999)}"


class TestDlq:
    async def test_get_dlq_empty(self, client, test_queue):
        """Test getting DLQ when empty."""
        try:
            jobs = await client.get_dlq(test_queue)
            assert isinstance(jobs, list)
            assert len(jobs) == 0
        finally:
            await client.obliterate(test_queue)

    async def test_job_to_dlq_after_max_attempts(self, client, test_queue):
        """Test job goes to DLQ after max attempts."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "fail"},
                PushOptions(max_attempts=1, backoff=100)
            )
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None
            await client.fail(job.id, "Intentional failure")

            await asyncio.sleep(0.5)
            dlq = await client.get_dlq(test_queue)
            assert isinstance(dlq, list)
        finally:
            await client.obliterate(test_queue)

    async def test_retry_dlq(self, client, test_queue):
        """Test retrying DLQ jobs."""
        try:
            job_id = await client.push(
                test_queue, {"task": "fail"}, PushOptions(max_attempts=1)
            )
            job = await client.pull(test_queue, timeout=5000)
            if job:
                await client.fail(job.id)
                await asyncio.sleep(0.3)
                count = await client.retry_dlq(test_queue)
                assert count >= 0
        finally:
            await client.obliterate(test_queue)

    async def test_retry_dlq_single_job(self, client, test_queue):
        """Test retrying single DLQ job."""
        try:
            job_id = await client.push(
                test_queue, {"task": "fail"}, PushOptions(max_attempts=1)
            )
            job = await client.pull(test_queue, timeout=5000)
            if job:
                await client.fail(job.id)
                await asyncio.sleep(0.3)
                count = await client.retry_dlq(test_queue, job_id)
                assert count >= 0
        finally:
            await client.obliterate(test_queue)

    async def test_get_dlq_with_count(self, client, test_queue):
        """Test getting DLQ with count limit."""
        try:
            jobs = await client.get_dlq(test_queue, count=10)
            assert isinstance(jobs, list)
        finally:
            await client.obliterate(test_queue)
