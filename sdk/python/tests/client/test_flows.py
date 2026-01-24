"""Tests for flashQ client flow operations."""

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
    return f"test-flow-{int(time.time() * 1000)}-{random.randint(0, 9999)}"


class TestFlows:
    async def test_push_flow_simple(self, client, test_queue):
        """Test pushing a simple flow."""
        try:
            result = await client.push_flow(
                test_queue,
                {"type": "parent"},
                [
                    {"queue": test_queue, "data": {"type": "child1"}},
                    {"queue": test_queue, "data": {"type": "child2"}},
                ]
            )
            assert "parent_id" in result
            assert "children_ids" in result
            assert result["parent_id"] > 0
            assert len(result["children_ids"]) == 2
        finally:
            await client.obliterate(test_queue)

    async def test_push_flow_with_options(self, client, test_queue):
        """Test pushing flow with options."""
        try:
            result = await client.push_flow(
                test_queue,
                {"type": "parent"},
                [{"queue": test_queue, "data": {"type": "child"}}],
                parent_options=PushOptions(priority=10)
            )
            assert result["parent_id"] > 0
        finally:
            await client.obliterate(test_queue)

    async def test_push_flow_empty_children(self, client, test_queue):
        """Test pushing flow without children."""
        try:
            result = await client.push_flow(
                test_queue,
                {"type": "parent"},
                []
            )
            assert result["parent_id"] > 0
            assert len(result["children_ids"]) == 0
        finally:
            await client.obliterate(test_queue)

    async def test_flow_child_in_different_queue(self, client, test_queue):
        """Test flow with child in different queue."""
        import time, random
        child_queue = f"test-flow-child-{int(time.time() * 1000)}-{random.randint(0, 9999)}"
        try:
            result = await client.push_flow(
                test_queue,
                {"type": "parent"},
                [{"queue": child_queue, "data": {"type": "child"}}]
            )
            assert result["parent_id"] > 0
            assert len(result["children_ids"]) == 1
        finally:
            await client.obliterate(test_queue)
            await client.obliterate(child_queue)

    async def test_depends_on_direct(self, client, test_queue):
        """Test direct depends_on usage."""
        try:
            dep1 = await client.push(test_queue, {"step": 1})
            dep2 = await client.push(test_queue, {"step": 2})
            child = await client.push(
                test_queue,
                {"step": 3},
                PushOptions(depends_on=[dep1, dep2])
            )
            assert child > 0
            job = await client.get_job(child)
            assert job is not None
        finally:
            await client.obliterate(test_queue)
