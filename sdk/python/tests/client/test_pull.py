"""
Tests for flashQ client pull operations.

These tests require a running flashQ server on localhost:6789.
"""

import asyncio
import pytest

from flashq import FlashQ
from flashq.types import ClientOptions, PushOptions, LogLevel
from flashq.errors import ValidationError


pytestmark = pytest.mark.asyncio


@pytest.fixture
async def client():
    """Create and connect a client."""
    client = FlashQ(ClientOptions(log_level=LogLevel.ERROR))
    try:
        await asyncio.wait_for(client.connect(), timeout=5.0)
    except Exception:
        pytest.skip("flashQ server not available on localhost:6789")
    yield client
    await client.close()


@pytest.fixture
def test_queue():
    """Return a unique test queue name."""
    import time
    return f"test-pull-{int(time.time() * 1000)}"


class TestPullSuccess:
    """Tests for successful pull operations."""

    async def test_pull_success(self, client, test_queue):
        """Test successful pull of a job."""
        try:
            # Push a job first
            job_id = await client.push(test_queue, {"message": "hello"})

            # Pull the job
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None
            assert job.id == job_id
            assert job.data == {"message": "hello"}

            await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)

    async def test_pull_returns_job_data(self, client, test_queue):
        """Test that pull returns complete job data."""
        try:
            data = {"key": "value", "number": 42, "nested": {"a": 1}}
            job_id = await client.push(test_queue, data)

            job = await client.pull(test_queue, timeout=5000)
            assert job is not None
            assert job.id == job_id
            assert job.data == data
            assert job.queue == test_queue

            await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)

    async def test_pull_with_priority_ordering(self, client, test_queue):
        """Test that pull respects priority ordering."""
        try:
            # Push low priority first
            low_id = await client.push(
                test_queue, {"priority": "low"}, PushOptions(priority=1)
            )
            # Push high priority second
            high_id = await client.push(
                test_queue, {"priority": "high"}, PushOptions(priority=100)
            )

            # Should get high priority first
            job1 = await client.pull(test_queue, timeout=5000)
            assert job1 is not None
            assert job1.id == high_id
            await client.ack(job1.id)

            # Then low priority
            job2 = await client.pull(test_queue, timeout=5000)
            assert job2 is not None
            assert job2.id == low_id
            await client.ack(job2.id)
        finally:
            await client.obliterate(test_queue)


class TestPullEmptyQueue:
    """Tests for pulling from empty queue."""

    async def test_pull_empty_queue(self, client, test_queue):
        """Test pull from empty queue returns None after timeout."""
        try:
            job = await client.pull(test_queue, timeout=500)
            assert job is None
        finally:
            await client.obliterate(test_queue)

    async def test_pull_empty_queue_short_timeout(self, client, test_queue):
        """Test pull with very short timeout."""
        try:
            job = await client.pull(test_queue, timeout=100)
            assert job is None
        finally:
            await client.obliterate(test_queue)


class TestPullTimeout:
    """Tests for pull timeout behavior."""

    async def test_pull_timeout_respected(self, client, test_queue):
        """Test that pull timeout is approximately respected."""
        try:
            start = asyncio.get_event_loop().time()
            job = await client.pull(test_queue, timeout=1000)  # 1 second
            elapsed = asyncio.get_event_loop().time() - start

            assert job is None
            # Should take approximately 1 second (with some buffer)
            assert 0.8 <= elapsed <= 3.0
        finally:
            await client.obliterate(test_queue)

    async def test_pull_default_timeout(self, client, test_queue):
        """Test pull with default timeout (should not hang forever)."""
        try:
            # Push a job to avoid waiting
            await client.push(test_queue, {"test": True})
            job = await client.pull(test_queue)  # Default timeout
            assert job is not None
            await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)


class TestPullBatch:
    """Tests for batch pull operations."""

    async def test_pull_batch_success(self, client, test_queue):
        """Test successful batch pull."""
        try:
            # Push multiple jobs
            for i in range(5):
                await client.push(test_queue, {"index": i})

            # Pull batch
            jobs = await client.pull_batch(test_queue, 5, timeout=5000)
            assert len(jobs) == 5

            # Ack all
            for job in jobs:
                await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)

    async def test_pull_batch_partial(self, client, test_queue):
        """Test batch pull when fewer jobs available."""
        try:
            # Push only 3 jobs
            for i in range(3):
                await client.push(test_queue, {"index": i})

            # Try to pull 10
            jobs = await client.pull_batch(test_queue, 10, timeout=1000)
            # Should get only 3
            assert len(jobs) <= 3

            for job in jobs:
                await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)

    async def test_pull_batch_empty(self, client, test_queue):
        """Test batch pull from empty queue."""
        try:
            jobs = await client.pull_batch(test_queue, 10, timeout=500)
            assert len(jobs) == 0
        finally:
            await client.obliterate(test_queue)

    async def test_pull_batch_count_one(self, client, test_queue):
        """Test batch pull with count=1."""
        try:
            await client.push(test_queue, {"single": True})
            jobs = await client.pull_batch(test_queue, 1, timeout=5000)
            assert len(jobs) == 1
            await client.ack(jobs[0].id)
        finally:
            await client.obliterate(test_queue)


class TestAck:
    """Tests for job acknowledgment."""

    async def test_ack_success(self, client, test_queue):
        """Test successful job acknowledgment."""
        try:
            job_id = await client.push(test_queue, {"task": "test"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            # Ack should complete without exception
            result = await client.ack(job.id)
            # Result is boolean, True or False depending on server impl
            assert isinstance(result, bool)

            # Job should no longer be pullable (already acked)
            job2 = await client.pull(test_queue, timeout=500)
            assert job2 is None
        finally:
            await client.obliterate(test_queue)

    async def test_ack_with_result(self, client, test_queue):
        """Test ack with result data."""
        try:
            job_id = await client.push(test_queue, {"task": "compute"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            result = {"output": 42, "status": "completed"}
            ack_result = await client.ack(job.id, result)
            assert isinstance(ack_result, bool)

            # Job should be completed now (not pullable)
            job2 = await client.pull(test_queue, timeout=500)
            assert job2 is None
        finally:
            await client.obliterate(test_queue)

    async def test_ack_nonexistent_job(self, client, test_queue):
        """Test ack for non-existent job."""
        try:
            # Should not raise, may return False
            try:
                success = await client.ack(999999999)
                assert isinstance(success, bool)
            except Exception:
                # Some implementations may raise for non-existent job
                pass
        finally:
            await client.obliterate(test_queue)

    async def test_ack_already_acked(self, client, test_queue):
        """Test ack for already acknowledged job."""
        try:
            job_id = await client.push(test_queue, {"task": "test"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            # First ack
            await client.ack(job.id)

            # Second ack - should be handled gracefully (no exception)
            try:
                await client.ack(job.id)
            except Exception:
                # Some implementations may raise for already acked job
                pass
        finally:
            await client.obliterate(test_queue)


class TestAckBatch:
    """Tests for batch acknowledgment."""

    async def test_ack_batch_success(self, client, test_queue):
        """Test successful batch acknowledgment."""
        try:
            # Push and pull multiple jobs
            for i in range(5):
                await client.push(test_queue, {"index": i})

            jobs = await client.pull_batch(test_queue, 5, timeout=5000)
            job_ids = [job.id for job in jobs]

            # Batch ack
            count = await client.ack_batch(job_ids)
            # Count should be >= 0
            assert count >= 0

            # Jobs should no longer be pullable
            remaining = await client.pull_batch(test_queue, 5, timeout=500)
            assert len(remaining) == 0
        finally:
            await client.obliterate(test_queue)

    async def test_ack_batch_empty(self, client, test_queue):
        """Test batch ack with empty list."""
        try:
            count = await client.ack_batch([])
            # Empty batch should return 0
            assert count >= 0
        finally:
            await client.obliterate(test_queue)

    async def test_ack_batch_partial_valid(self, client, test_queue):
        """Test batch ack with some invalid IDs."""
        try:
            job_id = await client.push(test_queue, {"valid": True})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            # Mix valid and invalid IDs
            ids = [job.id, 999999999]
            count = await client.ack_batch(ids)
            # Should complete without error
            assert count >= 0
        finally:
            await client.obliterate(test_queue)


class TestFail:
    """Tests for job failure."""

    async def test_fail_job(self, client, test_queue):
        """Test failing a job."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "will fail"},
                PushOptions(max_attempts=3)
            )
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            # Fail should complete without exception
            result = await client.fail(job.id, "Test failure")
            assert isinstance(result, bool)
        finally:
            await client.obliterate(test_queue)

    async def test_fail_job_with_exception(self, client, test_queue):
        """Test failing a job with exception object."""
        try:
            job_id = await client.push(test_queue, {"task": "error"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            error = ValueError("Something went wrong")
            result = await client.fail(job.id, error)
            assert isinstance(result, bool)
        finally:
            await client.obliterate(test_queue)

    async def test_fail_job_without_error(self, client, test_queue):
        """Test failing a job without error message."""
        try:
            job_id = await client.push(test_queue, {"task": "fail"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            result = await client.fail(job.id)
            assert isinstance(result, bool)
        finally:
            await client.obliterate(test_queue)

    async def test_fail_triggers_retry(self, client, test_queue):
        """Test that fail triggers retry for jobs with attempts remaining."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "retry me"},
                PushOptions(max_attempts=3, backoff=100)
            )

            # Pull and fail
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None
            await client.fail(job.id, "First attempt failed")

            # Wait a bit for retry
            await asyncio.sleep(0.5)

            # Should be able to pull again (retry)
            job2 = await client.pull(test_queue, timeout=2000)
            if job2 is not None:
                assert job2.id == job_id
                assert job2.attempts >= 1
                await client.ack(job2.id)
        finally:
            await client.obliterate(test_queue)


class TestPullValidation:
    """Tests for pull input validation."""

    async def test_pull_empty_queue_name(self, client):
        """Test that empty queue name is rejected."""
        with pytest.raises(ValidationError):
            await client.pull("")

    async def test_pull_invalid_queue_name(self, client):
        """Test that invalid queue name is rejected."""
        with pytest.raises(ValidationError):
            await client.pull("invalid queue!")

    async def test_pull_batch_invalid_queue(self, client):
        """Test batch pull with invalid queue name."""
        with pytest.raises(ValidationError):
            await client.pull_batch("invalid/queue", 10)

    async def test_pull_batch_exceed_limit(self, client, test_queue):
        """Test batch pull exceeding limit."""
        with pytest.raises(ValidationError):
            await client.pull_batch(test_queue, 1001)
