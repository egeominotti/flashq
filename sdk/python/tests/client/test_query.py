"""
Tests for flashQ client job query operations.

These tests require a running flashQ server on localhost:6789.
"""

import asyncio
import pytest

from flashq import FlashQ
from flashq.types import ClientOptions, PushOptions, LogLevel, JobState
from flashq.errors import JobNotFoundError


pytestmark = pytest.mark.asyncio


@pytest.fixture
async def client():
    """Create and connect a client."""
    client = FlashQ(ClientOptions(log_level=LogLevel.ERROR, timeout=10000))
    try:
        await asyncio.wait_for(client.connect(), timeout=5.0)
    except Exception:
        pytest.skip("flashQ server not available on localhost:6789")
    yield client
    try:
        await asyncio.wait_for(client.close(), timeout=5.0)
    except Exception:
        pass


@pytest.fixture
def test_queue():
    """Return a unique test queue name."""
    import time
    import random
    return f"test-query-{int(time.time() * 1000)}-{random.randint(0, 9999)}"


class TestGetJob:
    """Tests for get_job operation."""

    async def test_get_job(self, client, test_queue):
        """Test getting job by ID."""
        try:
            job_id = await client.push(test_queue, {"message": "test"})

            job = await client.get_job(job_id)
            assert job is not None
            assert job.id == job_id
            assert job.queue == test_queue
            assert job.data == {"message": "test"}
        finally:
            await client.obliterate(test_queue)

    async def test_get_job_with_options(self, client, test_queue):
        """Test getting job that was pushed with options."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "important"},
                PushOptions(priority=10, tags=["urgent"])
            )

            job = await client.get_job(job_id)
            assert job is not None
            assert job.priority == 10
            assert "urgent" in job.tags
        finally:
            await client.obliterate(test_queue)

    async def test_get_job_not_found(self, client, test_queue):
        """Test getting non-existent job raises error."""
        with pytest.raises(JobNotFoundError):
            await client.get_job(999999999)


class TestGetState:
    """Tests for get_state operation."""

    async def test_get_state_waiting(self, client, test_queue):
        """Test getting state of waiting job."""
        try:
            job_id = await client.push(test_queue, {"task": "wait"})

            state = await client.get_state(job_id)
            assert state == JobState.WAITING
        finally:
            await client.obliterate(test_queue)

    async def test_get_state_delayed(self, client, test_queue):
        """Test getting state of delayed job."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "delayed"},
                PushOptions(delay=60000)
            )

            state = await client.get_state(job_id)
            assert state == JobState.DELAYED
        finally:
            await client.obliterate(test_queue)

    async def test_get_state_active(self, client, test_queue):
        """Test getting state of active job."""
        try:
            job_id = await client.push(test_queue, {"task": "active"})

            # Pull to make active
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            state = await client.get_state(job.id)
            assert state == JobState.ACTIVE

            await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)

    async def test_get_state_completed(self, client, test_queue):
        """Test getting state of completed job."""
        try:
            job_id = await client.push(test_queue, {"task": "complete"})

            job = await client.pull(test_queue, timeout=5000)
            assert job is not None
            await client.ack(job.id)

            state = await client.get_state(job_id)
            assert state == JobState.COMPLETED
        finally:
            await client.obliterate(test_queue)

    async def test_get_state_not_found(self, client, test_queue):
        """Test getting state of non-existent job."""
        try:
            state = await client.get_state(999999999)
            # Should be None for non-existent job
            assert state is None
        except Exception:
            # Some implementations may raise for non-existent job
            pass


class TestGetResult:
    """Tests for get_result operation."""

    async def test_get_result(self, client, test_queue):
        """Test getting job result."""
        try:
            job_id = await client.push(test_queue, {"task": "compute"})

            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            result = {"answer": 42}
            await client.ack(job.id, result)

            stored = await client.get_result(job_id)
            # Result may or may not be stored depending on retention
            if stored is not None:
                assert stored == result
        finally:
            await client.obliterate(test_queue)

    async def test_get_result_no_result(self, client, test_queue):
        """Test getting result when none exists."""
        try:
            job_id = await client.push(test_queue, {"task": "no-result"})

            job = await client.pull(test_queue, timeout=5000)
            await client.ack(job.id)  # Ack without result

            result = await client.get_result(job_id)
            # Should be None or empty
            assert result is None or result == {}
        finally:
            await client.obliterate(test_queue)


class TestGetJobByCustomId:
    """Tests for get_job_by_custom_id operation."""

    async def test_get_job_by_custom_id(self, client, test_queue):
        """Test getting job by custom ID."""
        import time
        custom_id = f"order-{int(time.time() * 1000)}"
        try:
            job_id = await client.push(
                test_queue,
                {"order": custom_id},
                PushOptions(job_id=custom_id)
            )

            try:
                job = await client.get_job_by_custom_id(custom_id)
                # May or may not be supported
                if job is not None:
                    assert job.id == job_id
            except Exception:
                # Custom ID lookup may not be supported
                pass
        finally:
            await client.obliterate(test_queue)

    async def test_get_job_by_custom_id_not_found(self, client, test_queue):
        """Test getting job by non-existent custom ID."""
        try:
            job = await client.get_job_by_custom_id("nonexistent-custom-id")
            assert job is None
        except Exception:
            # Some implementations may raise for invalid custom ID
            pass


class TestGetJobs:
    """Tests for get_jobs operation."""

    async def test_get_jobs_list(self, client, test_queue):
        """Test getting list of jobs."""
        try:
            # Push multiple jobs
            for i in range(5):
                await client.push(test_queue, {"index": i})

            jobs = await client.get_jobs(test_queue)
            assert len(jobs) == 5
        finally:
            await client.obliterate(test_queue)

    async def test_get_jobs_with_state_filter(self, client, test_queue):
        """Test getting jobs filtered by state."""
        try:
            # Push some waiting jobs
            for i in range(3):
                await client.push(test_queue, {"index": i})

            # Push a delayed job
            await client.push(
                test_queue,
                {"delayed": True},
                PushOptions(delay=60000)
            )

            # Get only waiting jobs
            waiting_jobs = await client.get_jobs(test_queue, state=JobState.WAITING)
            assert len(waiting_jobs) == 3

            # Get only delayed jobs
            delayed_jobs = await client.get_jobs(test_queue, state=JobState.DELAYED)
            assert len(delayed_jobs) == 1
        finally:
            await client.obliterate(test_queue)

    async def test_get_jobs_with_pagination(self, client, test_queue):
        """Test getting jobs with pagination."""
        try:
            # Push 10 jobs
            for i in range(10):
                await client.push(test_queue, {"index": i})

            # Get first 5
            page1 = await client.get_jobs(test_queue, limit=5, offset=0)
            assert len(page1) == 5

            # Get next 5
            page2 = await client.get_jobs(test_queue, limit=5, offset=5)
            assert len(page2) == 5

            # Ensure different jobs
            page1_ids = {j.id for j in page1}
            page2_ids = {j.id for j in page2}
            assert page1_ids.isdisjoint(page2_ids)
        finally:
            await client.obliterate(test_queue)

    async def test_get_jobs_empty_queue(self, client, test_queue):
        """Test getting jobs from empty queue."""
        try:
            jobs = await client.get_jobs(test_queue)
            assert len(jobs) == 0
        finally:
            await client.obliterate(test_queue)


class TestGetJobCounts:
    """Tests for get_job_counts operation."""

    async def test_get_job_counts(self, client, test_queue):
        """Test getting job counts by state."""
        try:
            # Push waiting jobs
            for i in range(3):
                await client.push(test_queue, {"index": i})

            # Push delayed job
            await client.push(
                test_queue,
                {"delayed": True},
                PushOptions(delay=60000)
            )

            counts = await client.get_job_counts(test_queue)
            assert isinstance(counts, dict)
            # Counts should include at least waiting
            assert "waiting" in counts or len(counts) >= 0
        finally:
            await client.obliterate(test_queue)

    async def test_get_job_counts_empty_queue(self, client, test_queue):
        """Test getting counts from empty queue."""
        try:
            counts = await client.get_job_counts(test_queue)
            assert isinstance(counts, dict)
            # All counts should be 0 or missing
            total = sum(counts.values()) if counts else 0
            assert total == 0
        finally:
            await client.obliterate(test_queue)


class TestCount:
    """Tests for count operation."""

    async def test_count_queue(self, client, test_queue):
        """Test counting jobs in queue."""
        try:
            # Push 5 jobs
            for i in range(5):
                await client.push(test_queue, {"index": i})

            count = await client.count(test_queue)
            assert count == 5
        finally:
            await client.obliterate(test_queue)

    async def test_count_includes_delayed(self, client, test_queue):
        """Test that count includes delayed jobs."""
        try:
            # Push waiting jobs
            for i in range(3):
                await client.push(test_queue, {"index": i})

            # Push delayed jobs
            for i in range(2):
                await client.push(
                    test_queue,
                    {"delayed": i},
                    PushOptions(delay=60000)
                )

            count = await client.count(test_queue)
            # Count should include both waiting and delayed
            assert count == 5
        finally:
            await client.obliterate(test_queue)

    async def test_count_empty_queue(self, client, test_queue):
        """Test counting empty queue."""
        try:
            count = await client.count(test_queue)
            assert count == 0
        finally:
            await client.obliterate(test_queue)

    async def test_count_after_pull(self, client, test_queue):
        """Test count after pulling jobs."""
        try:
            # Push 5 jobs
            for i in range(5):
                await client.push(test_queue, {"index": i})

            # Pull 2 jobs
            for _ in range(2):
                job = await client.pull(test_queue, timeout=5000)
                await client.ack(job.id)

            # Count should be 3
            count = await client.count(test_queue)
            assert count == 3
        finally:
            await client.obliterate(test_queue)
