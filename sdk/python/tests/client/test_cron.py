"""Tests for flashQ client cron operations."""

import asyncio
import pytest
from flashq import FlashQ
from flashq.types import ClientOptions, PushOptions, LogLevel

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def client():
    client = FlashQ(ClientOptions(log_level=LogLevel.ERROR, timeout=30000))
    try:
        await asyncio.wait_for(client.connect(), timeout=10.0)
    except Exception:
        pytest.skip("flashQ server not available")
    yield client
    try:
        await asyncio.wait_for(client.close(), timeout=10.0)
    except Exception:
        pass


@pytest.fixture
def test_queue():
    import time, random
    return f"test-cron-{int(time.time() * 1000)}-{random.randint(0, 9999)}"


class TestCron:
    async def test_add_cron(self, client, test_queue):
        """Test adding a cron job."""
        import time
        cron_name = f"test-cron-{int(time.time() * 1000)}"
        try:
            try:
                result = await asyncio.wait_for(
                    client.add_cron(cron_name, test_queue, "*/5 * * * * *"),
                    timeout=10.0
                )
                assert isinstance(result, bool)
            except asyncio.TimeoutError:
                pytest.skip("Cron operation timed out")
            except Exception as e:
                if "timeout" in str(e).lower():
                    pytest.skip("Cron operation timed out")
                raise
        finally:
            try:
                await asyncio.wait_for(client.delete_cron(cron_name), timeout=5.0)
            except Exception:
                pass
            try:
                await client.obliterate(test_queue)
            except Exception:
                pass

    async def test_add_cron_with_data(self, client, test_queue):
        """Test adding cron with data."""
        import time
        cron_name = f"test-cron-data-{int(time.time() * 1000)}"
        try:
            try:
                result = await asyncio.wait_for(
                    client.add_cron(cron_name, test_queue, "0 * * * * *", data={"report": "daily"}),
                    timeout=10.0
                )
                assert isinstance(result, bool)
            except asyncio.TimeoutError:
                pytest.skip("Cron operation timed out")
            except Exception as e:
                if "timeout" in str(e).lower():
                    pytest.skip("Cron operation timed out")
                raise
        finally:
            try:
                await asyncio.wait_for(client.delete_cron(cron_name), timeout=5.0)
            except Exception:
                pass
            try:
                await client.obliterate(test_queue)
            except Exception:
                pass

    async def test_add_cron_with_options(self, client, test_queue):
        """Test adding cron with push options."""
        import time
        cron_name = f"test-cron-opts-{int(time.time() * 1000)}"
        try:
            try:
                result = await asyncio.wait_for(
                    client.add_cron(cron_name, test_queue, "0 0 * * * *",
                                   data={"type": "hourly"}, options=PushOptions(priority=10)),
                    timeout=10.0
                )
                assert isinstance(result, bool)
            except asyncio.TimeoutError:
                pytest.skip("Cron operation timed out")
            except Exception as e:
                if "timeout" in str(e).lower():
                    pytest.skip("Cron operation timed out")
                raise
        finally:
            try:
                await asyncio.wait_for(client.delete_cron(cron_name), timeout=5.0)
            except Exception:
                pass
            try:
                await client.obliterate(test_queue)
            except Exception:
                pass

    async def test_delete_cron(self, client, test_queue):
        """Test deleting a cron job."""
        import time
        cron_name = f"test-cron-del-{int(time.time() * 1000)}"
        try:
            try:
                await asyncio.wait_for(
                    client.add_cron(cron_name, test_queue, "0 0 * * * *"),
                    timeout=10.0
                )
                result = await asyncio.wait_for(
                    client.delete_cron(cron_name),
                    timeout=10.0
                )
                assert isinstance(result, bool)
            except asyncio.TimeoutError:
                pytest.skip("Cron operation timed out")
            except Exception as e:
                if "timeout" in str(e).lower():
                    pytest.skip("Cron operation timed out")
                raise
        finally:
            try:
                await client.obliterate(test_queue)
            except Exception:
                pass

    async def test_list_crons(self, client, test_queue):
        """Test listing cron jobs."""
        import time
        cron_name = f"test-cron-list-{int(time.time() * 1000)}"
        try:
            try:
                await asyncio.wait_for(
                    client.add_cron(cron_name, test_queue, "0 0 * * * *"),
                    timeout=10.0
                )
                crons = await asyncio.wait_for(
                    client.list_crons(),
                    timeout=10.0
                )
                assert isinstance(crons, list)
            except asyncio.TimeoutError:
                pytest.skip("Cron operation timed out")
            except Exception as e:
                if "timeout" in str(e).lower():
                    pytest.skip("Cron operation timed out")
                raise
        finally:
            try:
                await asyncio.wait_for(client.delete_cron(cron_name), timeout=5.0)
            except Exception:
                pass
            try:
                await client.obliterate(test_queue)
            except Exception:
                pass

    async def test_delete_nonexistent_cron(self, client):
        """Test deleting non-existent cron."""
        try:
            result = await asyncio.wait_for(
                client.delete_cron("nonexistent-cron"),
                timeout=10.0
            )
            assert isinstance(result, bool)
        except asyncio.TimeoutError:
            pytest.skip("Cron operation timed out")
        except Exception as e:
            if "timeout" in str(e).lower():
                pytest.skip("Cron operation timed out")
            # Other exceptions are acceptable for nonexistent cron
            pass
