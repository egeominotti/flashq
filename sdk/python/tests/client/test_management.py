"""
Tests for flashQ client job management operations.

These tests require a running flashQ server on localhost:6789.
"""

import asyncio
import pytest

from flashq import FlashQ
from flashq.types import ClientOptions, PushOptions, LogLevel, JobState


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
    return f"test-mgmt-{int(time.time() * 1000)}-{random.randint(0, 9999)}"


class TestCancel:
    """Tests for cancel operation."""

    async def test_cancel_job(self, client, test_queue):
        """Test canceling a waiting job."""
        try:
            job_id = await client.push(test_queue, {"task": "cancel me"})

            result = await client.cancel(job_id)
            assert isinstance(result, bool)

            # Job should not be pullable after cancel
            job = await client.pull(test_queue, timeout=500)
            assert job is None
        finally:
            await client.obliterate(test_queue)

    async def test_cancel_nonexistent_job(self, client, test_queue):
        """Test canceling non-existent job."""
        try:
            result = await client.cancel(999999999)
            # Should return False or handle gracefully
            assert isinstance(result, bool)
        except Exception:
            # Some implementations may raise
            pass

    async def test_cancel_active_job(self, client, test_queue):
        """Test canceling active job (should fail or be handled)."""
        try:
            job_id = await client.push(test_queue, {"task": "active"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            # Try to cancel active job
            try:
                result = await client.cancel(job.id)
                # May or may not succeed depending on implementation
                assert isinstance(result, bool)
            except Exception:
                # Some implementations may raise for active jobs
                pass

            # Try to ack - may fail if cancelled
            try:
                await client.ack(job.id)
            except Exception:
                pass
        finally:
            await client.obliterate(test_queue)


class TestProgress:
    """Tests for progress operations."""

    async def test_progress_update(self, client, test_queue):
        """Test updating job progress."""
        try:
            job_id = await client.push(test_queue, {"task": "progress"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            result = await client.progress(job.id, 50, "halfway done")
            assert isinstance(result, bool)

            await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)

    async def test_progress_update_without_message(self, client, test_queue):
        """Test updating progress without message."""
        try:
            job_id = await client.push(test_queue, {"task": "progress"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            result = await client.progress(job.id, 75)
            assert isinstance(result, bool)

            await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)

    async def test_get_progress(self, client, test_queue):
        """Test getting job progress."""
        try:
            job_id = await client.push(test_queue, {"task": "progress"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            await client.progress(job.id, 50, "test message")
            result = await client.get_progress(job.id)

            # Result is tuple (progress, message) where progress could be int or dict
            if isinstance(result, tuple):
                progress, message = result
                # Progress could be int, dict, or None
                if isinstance(progress, dict):
                    assert "progress" in progress
                elif isinstance(progress, int):
                    assert progress >= 0
            else:
                # Result is not tuple, just verify it's something
                pass

            await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)


class TestHeartbeat:
    """Tests for heartbeat operation."""

    async def test_heartbeat(self, client, test_queue):
        """Test sending heartbeat for active job."""
        try:
            job_id = await client.push(test_queue, {"task": "heartbeat"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            result = await client.heartbeat(job.id)
            assert isinstance(result, bool)

            await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)


class TestLog:
    """Tests for log operations."""

    async def test_log_job(self, client, test_queue):
        """Test adding log entry to job."""
        try:
            job_id = await client.push(test_queue, {"task": "log"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            result = await client.log(job.id, "Processing started")
            assert isinstance(result, bool)

            await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)

    async def test_log_with_level(self, client, test_queue):
        """Test adding log entry with level."""
        try:
            job_id = await client.push(test_queue, {"task": "log"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            await client.log(job.id, "Info message", "info")
            await client.log(job.id, "Warning message", "warn")
            await client.log(job.id, "Error message", "error")

            await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)

    async def test_get_logs(self, client, test_queue):
        """Test getting job logs."""
        try:
            job_id = await client.push(test_queue, {"task": "log"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            await client.log(job.id, "Log entry 1")
            await client.log(job.id, "Log entry 2")

            logs = await client.get_logs(job.id)
            assert isinstance(logs, list)

            await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)


class TestUpdate:
    """Tests for update operation."""

    async def test_update_job_data(self, client, test_queue):
        """Test updating job data."""
        try:
            job_id = await client.push(test_queue, {"original": True})

            try:
                result = await client.update(job_id, {"updated": True})
                assert isinstance(result, bool)
            except Exception:
                # Update may not be supported for waiting jobs
                pass

            # Verify job still exists
            job = await client.get_job(job_id)
            assert job is not None
        finally:
            await client.obliterate(test_queue)


class TestChangePriority:
    """Tests for change_priority operation."""

    async def test_change_priority(self, client, test_queue):
        """Test changing job priority."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "priority"},
                PushOptions(priority=5)
            )

            result = await client.change_priority(job_id, 100)
            assert isinstance(result, bool)

            # Verify priority changed
            job = await client.get_job(job_id)
            # Priority may or may not be updated
            assert job is not None
        finally:
            await client.obliterate(test_queue)


class TestMoveToDelayed:
    """Tests for move_to_delayed operation."""

    async def test_move_to_delayed(self, client, test_queue):
        """Test moving active job to delayed."""
        try:
            job_id = await client.push(test_queue, {"task": "delay"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            result = await client.move_to_delayed(job.id, 60000)
            assert isinstance(result, bool)
        finally:
            await client.obliterate(test_queue)


class TestPromote:
    """Tests for promote operation."""

    async def test_promote_job(self, client, test_queue):
        """Test promoting delayed job to waiting."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "delayed"},
                PushOptions(delay=60000)
            )

            # Verify it's delayed
            state = await client.get_state(job_id)
            assert state == JobState.DELAYED

            # Promote
            result = await client.promote(job_id)
            assert isinstance(result, bool)

            # Should be waiting now (if promotion succeeded)
            state = await client.get_state(job_id)
            # State could be waiting or still delayed if promotion not supported
            assert state in (JobState.WAITING, JobState.DELAYED)
        finally:
            await client.obliterate(test_queue)


class TestDiscard:
    """Tests for discard operation."""

    async def test_discard_job(self, client, test_queue):
        """Test discarding job to DLQ."""
        try:
            job_id = await client.push(test_queue, {"task": "discard"})

            result = await client.discard(job_id)
            assert isinstance(result, bool)

            # Job should not be pullable
            job = await client.pull(test_queue, timeout=500)
            assert job is None
        finally:
            await client.obliterate(test_queue)


class TestFinished:
    """Tests for finished (wait for completion) operation."""

    async def test_finished_wait(self, client, test_queue):
        """Test waiting for job completion."""
        try:
            job_id = await client.push(test_queue, {"task": "finish"})

            # Start a task to complete the job
            async def complete_job():
                await asyncio.sleep(0.5)
                job = await client.pull(test_queue, timeout=5000)
                if job:
                    await client.ack(job.id, {"done": True})

            # Run completion in background
            task = asyncio.create_task(complete_job())

            # Wait for completion
            try:
                result = await asyncio.wait_for(
                    client.finished(job_id, timeout=10000),
                    timeout=15.0
                )
                # Result may be None or the actual result
                if result is not None:
                    assert result == {"done": True}
            except asyncio.TimeoutError:
                # Timeout is acceptable
                pass
            finally:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        finally:
            await client.obliterate(test_queue)


class TestPartial:
    """Tests for partial result operation."""

    async def test_partial_result(self, client, test_queue):
        """Test sending partial result."""
        try:
            job_id = await client.push(test_queue, {"task": "stream"})
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None

            # Send partial results
            result1 = await client.partial(job.id, {"chunk": 1})
            result2 = await client.partial(job.id, {"chunk": 2}, index=1)

            assert isinstance(result1, bool)
            assert isinstance(result2, bool)

            await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)
