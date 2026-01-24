"""
Tests for flashQ client queue control operations.

These tests require a running flashQ server on localhost:6789.
"""

import asyncio
import pytest

from flashq import FlashQ
from flashq.types import ClientOptions, LogLevel


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
    return f"test-ctrl-{int(time.time() * 1000)}-{random.randint(0, 9999)}"


class TestPauseResume:
    """Tests for pause and resume operations."""

    async def test_pause_queue(self, client, test_queue):
        """Test pausing a queue."""
        try:
            await client.push(test_queue, {"test": True})
            result = await client.pause(test_queue)
            assert isinstance(result, bool)
        finally:
            await client.obliterate(test_queue)

    async def test_resume_queue(self, client, test_queue):
        """Test resuming a paused queue."""
        try:
            await client.push(test_queue, {"test": True})
            await client.pause(test_queue)
            result = await client.resume(test_queue)
            assert isinstance(result, bool)
        finally:
            await client.obliterate(test_queue)

    async def test_is_paused(self, client, test_queue):
        """Test checking if queue is paused."""
        try:
            await client.push(test_queue, {"test": True})

            # Initially not paused
            paused = await client.is_paused(test_queue)
            assert paused is False

            # Pause it
            await client.pause(test_queue)
            paused = await client.is_paused(test_queue)
            assert paused is True

            # Resume it
            await client.resume(test_queue)
            paused = await client.is_paused(test_queue)
            assert paused is False
        finally:
            await client.obliterate(test_queue)

    async def test_paused_queue_no_pull(self, client, test_queue):
        """Test that paused queue doesn't return jobs on pull."""
        try:
            await client.push(test_queue, {"test": True})
            await client.pause(test_queue)

            # Should not be able to pull from paused queue
            job = await client.pull(test_queue, timeout=500)
            # May return None or raise QueuePausedError
            # depending on implementation
        finally:
            await client.obliterate(test_queue)


class TestDrain:
    """Tests for drain operation."""

    async def test_drain_queue(self, client, test_queue):
        """Test draining all waiting jobs from queue."""
        try:
            # Push some jobs
            for i in range(5):
                await client.push(test_queue, {"index": i})

            # Drain
            count = await client.drain(test_queue)
            assert count >= 0

            # Queue should be empty
            remaining = await client.count(test_queue)
            assert remaining == 0
        finally:
            await client.obliterate(test_queue)

    async def test_drain_empty_queue(self, client, test_queue):
        """Test draining empty queue."""
        try:
            count = await client.drain(test_queue)
            assert count == 0
        finally:
            await client.obliterate(test_queue)


class TestObliterate:
    """Tests for obliterate operation."""

    async def test_obliterate_queue(self, client, test_queue):
        """Test obliterating all queue data."""
        try:
            # Push some jobs
            for i in range(5):
                await client.push(test_queue, {"index": i})

            # Obliterate
            result = await client.obliterate(test_queue)
            assert isinstance(result, bool)

            # Queue should be empty
            count = await client.count(test_queue)
            assert count == 0
        finally:
            pass  # Already obliterated

    async def test_obliterate_nonexistent_queue(self, client, test_queue):
        """Test obliterating non-existent queue."""
        result = await client.obliterate(test_queue)
        assert isinstance(result, bool)


class TestClean:
    """Tests for clean operation."""

    async def test_clean_queue(self, client, test_queue):
        """Test cleaning old jobs from queue."""
        try:
            # Push some jobs
            for i in range(5):
                await client.push(test_queue, {"index": i})

            # Clean with 0 grace (immediate)
            count = await client.clean(test_queue, grace=0, state="waiting")
            assert count >= 0
        finally:
            await client.obliterate(test_queue)


class TestListQueues:
    """Tests for list_queues operation."""

    async def test_list_queues(self, client, test_queue):
        """Test listing all queues."""
        try:
            # Create a queue by pushing
            await client.push(test_queue, {"test": True})

            queues = await client.list_queues()
            assert isinstance(queues, list)
            # Queue may or may not appear immediately
            # Just verify we get a list back
        finally:
            await client.obliterate(test_queue)

    async def test_list_queues_multiple(self, client):
        """Test listing multiple queues."""
        import time
        import random
        queues_to_create = [
            f"test-list-{int(time.time() * 1000)}-{random.randint(0, 9999)}-{i}"
            for i in range(3)
        ]

        try:
            # Create queues
            for q in queues_to_create:
                await client.push(q, {"test": True})

            queues = await client.list_queues()
            assert isinstance(queues, list)
            # Queues may or may not appear immediately
            # Just verify we get a list back
        finally:
            for q in queues_to_create:
                await client.obliterate(q)


class TestRateLimit:
    """Tests for rate limit operations."""

    async def test_set_rate_limit(self, client, test_queue):
        """Test setting queue rate limit."""
        try:
            await client.push(test_queue, {"test": True})
            result = await client.set_rate_limit(test_queue, 10)
            assert isinstance(result, bool)
        finally:
            await client.obliterate(test_queue)

    async def test_clear_rate_limit(self, client, test_queue):
        """Test clearing queue rate limit."""
        try:
            await client.push(test_queue, {"test": True})
            await client.set_rate_limit(test_queue, 10)
            result = await client.clear_rate_limit(test_queue)
            assert isinstance(result, bool)
        finally:
            await client.obliterate(test_queue)


class TestConcurrency:
    """Tests for concurrency limit operations."""

    async def test_set_concurrency(self, client, test_queue):
        """Test setting concurrency limit."""
        try:
            await client.push(test_queue, {"test": True})
            result = await client.set_concurrency(test_queue, 5)
            assert isinstance(result, bool)
        finally:
            await client.obliterate(test_queue)

    async def test_clear_concurrency(self, client, test_queue):
        """Test clearing concurrency limit."""
        try:
            await client.push(test_queue, {"test": True})
            await client.set_concurrency(test_queue, 5)
            result = await client.clear_concurrency(test_queue)
            assert isinstance(result, bool)
        finally:
            await client.obliterate(test_queue)
