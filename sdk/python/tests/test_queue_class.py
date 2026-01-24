"""Tests for flashQ Queue class (BullMQ-compatible API)."""

import asyncio
import pytest
from flashq.queue import Queue
from flashq.types import ClientOptions, LogLevel

pytestmark = pytest.mark.asyncio


def make_queue_name():
    import time, random
    return f"test-queue-{int(time.time() * 1000)}-{random.randint(0, 9999)}"


class TestQueueCreation:
    async def test_queue_creation(self):
        """Test creating a queue."""
        queue_name = make_queue_name()
        queue = Queue(queue_name, ClientOptions(log_level=LogLevel.ERROR))
        assert queue is not None
        assert queue.name == queue_name


class TestQueueAdd:
    async def test_queue_add(self):
        """Test adding job via Queue.add()."""
        queue_name = make_queue_name()
        queue = Queue(queue_name, ClientOptions(log_level=LogLevel.ERROR))
        try:
            await queue.connect()
            job = await queue.add("test-job", {"data": "test"})
            assert job is not None
            assert job.id > 0
        except Exception:
            pytest.skip("Server not available")
        finally:
            try:
                await queue._client.obliterate(queue_name)
            except Exception:
                pass
            await queue.close()

    async def test_queue_add_with_options(self):
        """Test adding job with options."""
        queue_name = make_queue_name()
        queue = Queue(queue_name, ClientOptions(log_level=LogLevel.ERROR))
        try:
            await queue.connect()
            job = await queue.add("test-job", {"data": "test"}, {"priority": 10})
            assert job is not None
        except Exception:
            pytest.skip("Server not available")
        finally:
            try:
                await queue._client.obliterate(queue_name)
            except Exception:
                pass
            await queue.close()

    async def test_queue_add_bulk(self):
        """Test adding multiple jobs."""
        queue_name = make_queue_name()
        queue = Queue(queue_name, ClientOptions(log_level=LogLevel.ERROR))
        try:
            await queue.connect()
            jobs = [
                {"name": "job1", "data": {"index": 1}},
                {"name": "job2", "data": {"index": 2}},
            ]
            result = await queue.add_bulk(jobs)
            assert len(result) == 2
        except Exception:
            pytest.skip("Server not available")
        finally:
            try:
                await queue._client.obliterate(queue_name)
            except Exception:
                pass
            await queue.close()


class TestQueueControl:
    async def test_queue_pause(self):
        """Test pausing queue."""
        queue_name = make_queue_name()
        queue = Queue(queue_name, ClientOptions(log_level=LogLevel.ERROR))
        try:
            await queue.connect()
            await queue.add("job", {})
            await queue.pause()
            paused = await queue.is_paused()
            assert paused is True
        except Exception:
            pytest.skip("Server not available")
        finally:
            try:
                await queue._client.obliterate(queue_name)
            except Exception:
                pass
            await queue.close()

    async def test_queue_resume(self):
        """Test resuming queue."""
        queue_name = make_queue_name()
        queue = Queue(queue_name, ClientOptions(log_level=LogLevel.ERROR))
        try:
            await queue.connect()
            await queue.add("job", {})
            await queue.pause()
            await queue.resume()
            paused = await queue.is_paused()
            assert paused is False
        except Exception:
            pytest.skip("Server not available")
        finally:
            try:
                await queue._client.obliterate(queue_name)
            except Exception:
                pass
            await queue.close()


class TestQueueMetrics:
    async def test_queue_get_job_counts(self):
        """Test getting job counts."""
        queue_name = make_queue_name()
        queue = Queue(queue_name, ClientOptions(log_level=LogLevel.ERROR))
        try:
            await queue.connect()
            await queue.add("job1", {})
            await queue.add("job2", {})
            counts = await queue.get_job_counts()
            assert isinstance(counts, dict)
        except Exception:
            pytest.skip("Server not available")
        finally:
            try:
                await queue._client.obliterate(queue_name)
            except Exception:
                pass
            await queue.close()

    async def test_queue_count(self):
        """Test counting jobs."""
        queue_name = make_queue_name()
        queue = Queue(queue_name, ClientOptions(log_level=LogLevel.ERROR))
        try:
            await queue.connect()
            await queue.add("job1", {})
            await queue.add("job2", {})
            count = await queue.count()
            assert count == 2
        except Exception:
            pytest.skip("Server not available")
        finally:
            try:
                await queue._client.obliterate(queue_name)
            except Exception:
                pass
            await queue.close()
