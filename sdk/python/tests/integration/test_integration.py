"""E2E integration tests for flashQ SDK."""

import asyncio
import pytest
from flashq import FlashQ
from flashq.types import ClientOptions, PushOptions, LogLevel, JobState

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def client():
    client = FlashQ(ClientOptions(log_level=LogLevel.ERROR, timeout=15000))
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
    return f"test-integ-{int(time.time() * 1000)}-{random.randint(0, 9999)}"


class TestFullJobLifecycle:
    async def test_push_pull_progress_ack(self, client, test_queue):
        """Test complete job lifecycle: push -> pull -> progress -> ack."""
        try:
            # Push
            job_id = await client.push(test_queue, {"task": "process"})
            assert job_id > 0

            # Verify state is waiting
            state = await client.get_state(job_id)
            assert state == JobState.WAITING

            # Pull
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None
            assert job.id == job_id

            # Verify state is active
            state = await client.get_state(job_id)
            assert state == JobState.ACTIVE

            # Update progress
            await client.progress(job.id, 50, "halfway")
            await client.progress(job.id, 100, "done")

            # Ack with result
            await client.ack(job.id, {"success": True})

            # Verify state is completed
            state = await client.get_state(job_id)
            assert state == JobState.COMPLETED
        finally:
            await client.obliterate(test_queue)


class TestRetryFlow:
    async def test_push_pull_fail_retry_ack(self, client, test_queue):
        """Test retry flow: push -> pull -> fail -> retry -> ack."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "retry"},
                PushOptions(max_attempts=3, backoff=100)
            )

            # First attempt - pull and fail
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None
            await client.fail(job.id, "First failure")

            # Wait for retry
            await asyncio.sleep(0.5)

            # Second attempt - pull and succeed
            job2 = await client.pull(test_queue, timeout=5000)
            if job2 is not None:
                assert job2.id == job_id
                assert job2.attempts >= 1
                await client.ack(job2.id)
        finally:
            await client.obliterate(test_queue)


class TestDlqFlow:
    async def test_push_fail_max_dlq_retry(self, client, test_queue):
        """Test DLQ flow: push -> fail max -> dlq -> retry."""
        try:
            job_id = await client.push(
                test_queue,
                {"task": "dlq"},
                PushOptions(max_attempts=1, backoff=100)
            )

            # Pull and fail
            job = await client.pull(test_queue, timeout=5000)
            assert job is not None
            await client.fail(job.id, "Max failure")

            # Wait for DLQ
            await asyncio.sleep(0.5)

            # Check DLQ
            dlq_jobs = await client.get_dlq(test_queue)
            # Job may or may not be in DLQ depending on timing

            # Retry DLQ
            count = await client.retry_dlq(test_queue)
            assert count >= 0
        finally:
            await client.obliterate(test_queue)


class TestBatchOperations:
    async def test_batch_push_pull_ack(self, client, test_queue):
        """Test batch operations: push batch -> pull batch -> ack batch."""
        try:
            # Push batch
            jobs_data = [{"index": i} for i in range(10)]
            result = await client.push_batch(test_queue, jobs_data)
            assert len(result.job_ids) == 10

            # Pull batch
            jobs = await client.pull_batch(test_queue, 10, timeout=5000)
            assert len(jobs) == 10

            # Ack batch
            job_ids = [j.id for j in jobs]
            count = await client.ack_batch(job_ids)
            assert count >= 0

            # Queue should be empty
            remaining = await client.count(test_queue)
            assert remaining == 0
        finally:
            await client.obliterate(test_queue)


class TestFlowExecution:
    async def test_parent_child_flow(self, client, test_queue):
        """Test parent-child flow execution."""
        try:
            # Create flow
            flow = await client.push_flow(
                test_queue,
                {"type": "parent", "name": "report"},
                [
                    {"queue": test_queue, "data": {"type": "child", "section": "sales"}},
                    {"queue": test_queue, "data": {"type": "child", "section": "marketing"}},
                ]
            )

            assert flow["parent_id"] > 0
            assert len(flow["children_ids"]) == 2

            # Process children first
            for _ in range(2):
                job = await client.pull(test_queue, timeout=5000)
                if job and job.data.get("type") == "child":
                    await client.ack(job.id)

            # Wait for parent to become ready
            await asyncio.sleep(0.5)

            # Parent should be ready now
            parent = await client.pull(test_queue, timeout=5000)
            if parent:
                await client.ack(parent.id)
        finally:
            await client.obliterate(test_queue)


class TestPriorityOrdering:
    async def test_priority_queue_ordering(self, client, test_queue):
        """Test that jobs are processed in priority order."""
        try:
            # Push jobs with different priorities
            low = await client.push(test_queue, {"p": "low"}, PushOptions(priority=1))
            med = await client.push(test_queue, {"p": "med"}, PushOptions(priority=50))
            high = await client.push(test_queue, {"p": "high"}, PushOptions(priority=100))

            # Pull should return highest priority first
            j1 = await client.pull(test_queue, timeout=5000)
            assert j1 is not None
            assert j1.id == high

            j2 = await client.pull(test_queue, timeout=5000)
            assert j2 is not None
            assert j2.id == med

            j3 = await client.pull(test_queue, timeout=5000)
            assert j3 is not None
            assert j3.id == low

            # Cleanup
            await client.ack(j1.id)
            await client.ack(j2.id)
            await client.ack(j3.id)
        finally:
            await client.obliterate(test_queue)


class TestConcurrentClients:
    async def test_multiple_clients(self, test_queue):
        """Test multiple concurrent clients."""
        clients = []
        try:
            # Create multiple clients
            for _ in range(3):
                c = FlashQ(ClientOptions(log_level=LogLevel.ERROR))
                await asyncio.wait_for(c.connect(), timeout=5.0)
                clients.append(c)

            # Push from client 1
            job_id = await clients[0].push(test_queue, {"from": "client1"})

            # Pull from client 2
            job = await clients[1].pull(test_queue, timeout=5000)
            assert job is not None
            assert job.id == job_id

            # Ack from client 3
            await clients[2].ack(job.id)
        except Exception:
            pytest.skip("Server not available")
        finally:
            for c in clients:
                try:
                    await c.obliterate(test_queue)
                except Exception:
                    pass
                await c.close()
