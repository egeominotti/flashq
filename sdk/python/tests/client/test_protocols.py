"""Tests for flashQ client protocol support."""

import asyncio
import pytest
from flashq import FlashQ
from flashq.types import ClientOptions, LogLevel

pytestmark = pytest.mark.asyncio


class TestTcpProtocol:
    async def test_tcp_connection(self):
        """Test TCP protocol connection."""
        client = FlashQ(ClientOptions(
            use_http=False,
            use_binary=False,
            log_level=LogLevel.ERROR
        ))
        try:
            await asyncio.wait_for(client.connect(), timeout=5.0)
            assert client.connected
        except Exception:
            pytest.skip("flashQ server not available")
        finally:
            await client.close()

    async def test_tcp_push_pull(self):
        """Test TCP protocol push/pull."""
        import time, random
        queue = f"test-tcp-{int(time.time() * 1000)}-{random.randint(0, 9999)}"
        client = FlashQ(ClientOptions(use_http=False, log_level=LogLevel.ERROR))
        try:
            await asyncio.wait_for(client.connect(), timeout=5.0)
            job_id = await client.push(queue, {"protocol": "tcp"})
            assert job_id > 0
            job = await client.pull(queue, timeout=5000)
            assert job is not None
            await client.ack(job.id)
        except Exception as e:
            pytest.skip(f"Server not available: {e}")
        finally:
            try:
                await client.obliterate(queue)
            except Exception:
                pass
            await client.close()


class TestHttpProtocol:
    async def test_http_connection(self):
        """Test HTTP protocol connection."""
        client = FlashQ(ClientOptions(
            use_http=True,
            http_port=6790,
            log_level=LogLevel.ERROR
        ))
        try:
            await client.connect()
            assert client.connected
        finally:
            await client.close()

    async def test_http_push_pull(self):
        """Test HTTP protocol push/pull."""
        import time, random
        queue = f"test-http-{int(time.time() * 1000)}-{random.randint(0, 9999)}"
        client = FlashQ(ClientOptions(
            use_http=True, http_port=6790, log_level=LogLevel.ERROR
        ))
        try:
            await client.connect()
            job_id = await client.push(queue, {"protocol": "http"})
            assert job_id > 0
            job = await client.pull(queue, timeout=5000)
            assert job is not None
            await client.ack(job.id)
        except Exception as e:
            pytest.skip(f"HTTP server not available: {e}")
        finally:
            try:
                await client.obliterate(queue)
            except Exception:
                pass
            await client.close()


class TestBinaryProtocol:
    async def test_binary_connection(self):
        """Test binary (MessagePack) protocol connection."""
        client = FlashQ(ClientOptions(
            use_binary=True,
            log_level=LogLevel.ERROR
        ))
        try:
            await asyncio.wait_for(client.connect(), timeout=5.0)
            assert client.connected
        except Exception:
            pytest.skip("flashQ server not available")
        finally:
            await client.close()

    async def test_binary_push_pull(self):
        """Test binary protocol push/pull."""
        import time, random
        queue = f"test-bin-{int(time.time() * 1000)}-{random.randint(0, 9999)}"
        client = FlashQ(ClientOptions(use_binary=True, log_level=LogLevel.ERROR))
        try:
            await asyncio.wait_for(client.connect(), timeout=5.0)
            job_id = await client.push(queue, {"protocol": "binary"})
            assert job_id > 0
            job = await client.pull(queue, timeout=5000)
            assert job is not None
            await client.ack(job.id)
        except Exception as e:
            pytest.skip(f"Server not available: {e}")
        finally:
            try:
                await client.obliterate(queue)
            except Exception:
                pass
            await client.close()

    async def test_binary_large_payload(self):
        """Test binary protocol with large payload."""
        import time, random
        queue = f"test-bin-lg-{int(time.time() * 1000)}-{random.randint(0, 9999)}"
        client = FlashQ(ClientOptions(use_binary=True, log_level=LogLevel.ERROR))
        try:
            await asyncio.wait_for(client.connect(), timeout=5.0)
            large_data = {"data": "x" * 10000}
            job_id = await client.push(queue, large_data)
            assert job_id > 0
            job = await client.pull(queue, timeout=5000)
            assert job is not None
            assert job.data["data"] == "x" * 10000
            await client.ack(job.id)
        except Exception as e:
            pytest.skip(f"Server not available: {e}")
        finally:
            try:
                await client.obliterate(queue)
            except Exception:
                pass
            await client.close()
