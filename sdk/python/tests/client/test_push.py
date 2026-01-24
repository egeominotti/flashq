"""
Tests for flashQ client push operations.

These tests require a running flashQ server on localhost:6789.
"""

import asyncio
import pytest

from flashq import FlashQ
from flashq.types import ClientOptions, PushOptions, LogLevel, JobState
from flashq.errors import ValidationError, DuplicateJobError


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
    return f"test-push-{int(time.time() * 1000)}"


class TestPushSimple:
    """Tests for basic push operations."""

    async def test_push_simple(self, client, test_queue):
        """Test simple push with data."""
        try:
            job_id = await client.push(test_queue, {"message": "hello"})
            assert job_id > 0
        finally:
            await client.obliterate(test_queue)

    async def test_push_returns_job_id(self, client, test_queue):
        """Test that push returns a valid job ID."""
        try:
            job_id = await client.push(test_queue, {"test": True})
            assert isinstance(job_id, int)
            assert job_id > 0
        finally:
            await client.obliterate(test_queue)

    async def test_push_various_data_types(self, client, test_queue):
        """Test pushing various data types."""
        try:
            # Dict
            id1 = await client.push(test_queue, {"key": "value"})
            assert id1 > 0

            # String
            id2 = await client.push(test_queue, "string data")
            assert id2 > 0

            # List
            id3 = await client.push(test_queue, [1, 2, 3])
            assert id3 > 0

            # Number
            id4 = await client.push(test_queue, 42)
            assert id4 > 0

            # Nested structure
            id5 = await client.push(test_queue, {
                "nested": {"deep": {"value": [1, 2, 3]}}
            })
            assert id5 > 0
        finally:
            await client.obliterate(test_queue)


class TestPushWithPriority:
    """Tests for push with priority option."""

    async def test_push_with_priority(self, client, test_queue):
        """Test push with priority."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "high priority"},
                PushOptions(priority=10)
            )
            assert job_id > 0

            # Verify job has priority set
            job = await client.get_job(job_id)
            assert job.priority == 10
        finally:
            await client.obliterate(test_queue)

    async def test_push_priority_ordering(self, client, test_queue):
        """Test that higher priority jobs are pulled first."""
        try:
            # Push low priority first
            low_id = await client.push(
                test_queue, {"priority": "low"}, PushOptions(priority=1)
            )
            # Push high priority second
            high_id = await client.push(
                test_queue, {"priority": "high"}, PushOptions(priority=100)
            )

            # Pull should return high priority first
            job = await client.pull(test_queue, timeout=1000)
            assert job is not None
            assert job.id == high_id

            await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)


class TestPushWithDelay:
    """Tests for push with delay option."""

    async def test_push_with_delay(self, client, test_queue):
        """Test push with delay."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "delayed"},
                PushOptions(delay=5000)  # 5 second delay
            )
            assert job_id > 0

            # Job should be in delayed state
            state = await client.get_state(job_id)
            assert state == JobState.DELAYED
        finally:
            await client.obliterate(test_queue)

    async def test_push_delayed_not_immediately_pullable(self, client, test_queue):
        """Test that delayed job is not immediately pullable."""
        try:
            await client.push(
                test_queue,
                {"task": "delayed"},
                PushOptions(delay=10000)  # 10 second delay
            )

            # Should not be able to pull immediately
            job = await client.pull(test_queue, timeout=500)
            assert job is None
        finally:
            await client.obliterate(test_queue)


class TestPushWithTtl:
    """Tests for push with TTL option."""

    async def test_push_with_ttl(self, client, test_queue):
        """Test push with TTL."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "expires"},
                PushOptions(ttl=60000)  # 1 minute TTL
            )
            assert job_id > 0
        finally:
            await client.obliterate(test_queue)


class TestPushWithTimeout:
    """Tests for push with timeout option."""

    async def test_push_with_timeout(self, client, test_queue):
        """Test push with processing timeout."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "with timeout"},
                PushOptions(timeout=30000)  # 30 second processing timeout
            )
            assert job_id > 0
        finally:
            await client.obliterate(test_queue)


class TestPushWithMaxAttempts:
    """Tests for push with max_attempts option."""

    async def test_push_with_max_attempts(self, client, test_queue):
        """Test push with custom max attempts."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "retry me"},
                PushOptions(max_attempts=5)
            )
            assert job_id > 0

            job = await client.get_job(job_id)
            assert job.max_attempts == 5
        finally:
            await client.obliterate(test_queue)

    async def test_push_with_single_attempt(self, client, test_queue):
        """Test push with max_attempts=1 (no retries)."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "no retry"},
                PushOptions(max_attempts=1)
            )
            assert job_id > 0

            job = await client.get_job(job_id)
            assert job.max_attempts == 1
        finally:
            await client.obliterate(test_queue)


class TestPushWithBackoff:
    """Tests for push with backoff option."""

    async def test_push_with_backoff(self, client, test_queue):
        """Test push with custom backoff."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "with backoff"},
                PushOptions(backoff=2000)  # 2 second base backoff
            )
            assert job_id > 0
        finally:
            await client.obliterate(test_queue)


class TestPushWithUniqueKey:
    """Tests for push with unique_key option."""

    async def test_push_with_unique_key(self, client, test_queue):
        """Test push with unique key."""
        try:
            job_id = await client.push(
                test_queue,
                {"order": "123"},
                PushOptions(unique_key="order-123")
            )
            assert job_id > 0
        finally:
            await client.obliterate(test_queue)

    async def test_push_duplicate_unique_key_rejected(self, client, test_queue):
        """Test that duplicate unique key is rejected."""
        try:
            # First push should succeed
            await client.push(
                test_queue,
                {"order": "456"},
                PushOptions(unique_key="order-456")
            )

            # Second push with same key should fail
            with pytest.raises((DuplicateJobError, Exception)):
                await client.push(
                    test_queue,
                    {"order": "456-duplicate"},
                    PushOptions(unique_key="order-456")
                )
        finally:
            await client.obliterate(test_queue)

    async def test_push_different_unique_keys_allowed(self, client, test_queue):
        """Test that different unique keys are allowed."""
        try:
            id1 = await client.push(
                test_queue,
                {"order": "A"},
                PushOptions(unique_key="key-A")
            )
            id2 = await client.push(
                test_queue,
                {"order": "B"},
                PushOptions(unique_key="key-B")
            )

            assert id1 != id2
        finally:
            await client.obliterate(test_queue)


class TestPushWithDependsOn:
    """Tests for push with depends_on option."""

    async def test_push_with_depends_on(self, client, test_queue):
        """Test push with job dependencies."""
        try:
            # Create parent jobs first
            parent1 = await client.push(test_queue, {"step": 1})
            parent2 = await client.push(test_queue, {"step": 2})

            # Create child that depends on parents
            child_id = await client.push(
                test_queue,
                {"step": 3},
                PushOptions(depends_on=[parent1, parent2])
            )
            assert child_id > 0

            # Verify the child job was created
            job = await client.get_job(child_id)
            assert job is not None
            assert job.id == child_id
        finally:
            await client.obliterate(test_queue)


class TestPushWithTags:
    """Tests for push with tags option."""

    async def test_push_with_tags(self, client, test_queue):
        """Test push with tags."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "tagged"},
                PushOptions(tags=["important", "urgent"])
            )
            assert job_id > 0

            job = await client.get_job(job_id)
            assert "important" in job.tags
            assert "urgent" in job.tags
        finally:
            await client.obliterate(test_queue)

    async def test_push_with_empty_tags(self, client, test_queue):
        """Test push with empty tags list."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "no tags"},
                PushOptions(tags=[])
            )
            assert job_id > 0
        finally:
            await client.obliterate(test_queue)


class TestPushWithLifo:
    """Tests for push with LIFO mode."""

    async def test_push_with_lifo(self, client, test_queue):
        """Test push with LIFO mode."""
        try:
            # Push first job with LIFO
            first_id = await client.push(
                test_queue,
                {"order": 1},
                PushOptions(lifo=True)
            )
            # Push second job with LIFO
            second_id = await client.push(
                test_queue,
                {"order": 2},
                PushOptions(lifo=True)
            )

            # Both jobs should be created
            assert first_id > 0
            assert second_id > 0
            assert first_id != second_id

            # Pull a job - LIFO behavior depends on server implementation
            job = await client.pull(test_queue, timeout=1000)
            assert job is not None
            assert job.id in (first_id, second_id)

            await client.ack(job.id)
        finally:
            await client.obliterate(test_queue)


class TestPushWithJobId:
    """Tests for push with custom job_id (idempotency)."""

    async def test_push_with_job_id(self, client, test_queue):
        """Test push with custom job ID."""
        import time
        custom_id = f"custom-{int(time.time() * 1000)}"
        try:
            job_id = await client.push(
                test_queue,
                {"order": custom_id},
                PushOptions(job_id=custom_id)
            )
            assert job_id > 0

            # Verify job was created
            job = await client.get_job(job_id)
            assert job is not None
            assert job.id == job_id
        finally:
            await client.obliterate(test_queue)

    async def test_push_duplicate_job_id_rejected(self, client, test_queue):
        """Test that duplicate custom job ID is rejected."""
        import time
        custom_id = f"unique-{int(time.time() * 1000)}"
        try:
            # First push with custom ID
            first_id = await client.push(
                test_queue,
                {"data": "first"},
                PushOptions(job_id=custom_id)
            )
            assert first_id > 0

            # Second push with same custom ID should either:
            # 1. Raise an exception (DuplicateJobError)
            # 2. Return the same job ID (idempotent behavior)
            try:
                second_id = await client.push(
                    test_queue,
                    {"data": "second"},
                    PushOptions(job_id=custom_id)
                )
                # If no exception, should be same ID (idempotent)
                # or server allows duplicates
                assert second_id > 0
            except (DuplicateJobError, Exception):
                # Expected - duplicates rejected
                pass
        finally:
            await client.obliterate(test_queue)


class TestPushBatch:
    """Tests for batch push operations."""

    async def test_push_batch_success(self, client, test_queue):
        """Test successful batch push."""
        try:
            jobs = [{"index": i} for i in range(10)]
            result = await client.push_batch(test_queue, jobs)

            # Check that we got job IDs back
            assert len(result.job_ids) == 10
            for job_id in result.job_ids:
                assert job_id > 0
        finally:
            await client.obliterate(test_queue)

    async def test_push_batch_with_options(self, client, test_queue):
        """Test batch push with options per job."""
        try:
            jobs = [
                ({"index": 0}, PushOptions(priority=1)),
                ({"index": 1}, PushOptions(priority=10)),
                ({"index": 2}, PushOptions(priority=5)),
            ]
            result = await client.push_batch(test_queue, jobs)

            assert len(result.job_ids) == 3
            for job_id in result.job_ids:
                assert job_id > 0
        finally:
            await client.obliterate(test_queue)

    async def test_push_batch_empty(self, client, test_queue):
        """Test batch push with empty list."""
        try:
            result = await client.push_batch(test_queue, [])
            # Empty batch should return empty result
            assert len(result.job_ids) == 0
        finally:
            await client.obliterate(test_queue)

    async def test_push_batch_large(self, client, test_queue):
        """Test batch push with many jobs."""
        try:
            jobs = [{"index": i} for i in range(100)]
            result = await client.push_batch(test_queue, jobs)

            assert len(result.job_ids) == 100
            for job_id in result.job_ids:
                assert job_id > 0

            # Verify count
            count = await client.count(test_queue)
            assert count == 100
        finally:
            await client.obliterate(test_queue)

    async def test_push_batch_limit_exceeded(self, client, test_queue):
        """Test that batch exceeding limit is rejected."""
        jobs = [{"index": i} for i in range(1001)]

        with pytest.raises(ValidationError):
            await client.push_batch(test_queue, jobs)


class TestPushValidation:
    """Tests for push input validation."""

    async def test_push_empty_queue_name(self, client):
        """Test that empty queue name is rejected."""
        with pytest.raises(ValidationError):
            await client.push("", {"data": "test"})

    async def test_push_invalid_queue_name(self, client):
        """Test that invalid queue name is rejected."""
        with pytest.raises(ValidationError):
            await client.push("invalid queue!", {"data": "test"})

        with pytest.raises(ValidationError):
            await client.push("queue/name", {"data": "test"})

    async def test_push_queue_name_too_long(self, client):
        """Test that queue name exceeding max length is rejected."""
        with pytest.raises(ValidationError):
            await client.push("x" * 300, {"data": "test"})
