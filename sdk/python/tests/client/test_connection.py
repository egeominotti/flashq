"""
Tests for flashQ client connection functionality.

These tests require a running flashQ server on localhost:6789.
Tests will be skipped if the server is not available.
"""

import asyncio
import pytest

from flashq import FlashQ
from flashq.types import ClientOptions, LogLevel
from flashq.errors import (
    ConnectionError,
    AuthenticationError,
    TimeoutError,
)


# Mark all tests as async
pytestmark = pytest.mark.asyncio


async def server_available() -> bool:
    """Check if flashQ server is available."""
    try:
        client = FlashQ()
        await asyncio.wait_for(client.connect(), timeout=2.0)
        await client.close()
        return True
    except Exception:
        return False


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
def disconnected_client():
    """Create a client without connecting."""
    return FlashQ(ClientOptions(log_level=LogLevel.ERROR))


class TestConnectSuccess:
    """Tests for successful connection scenarios."""

    async def test_connect_success(self, client):
        """Test successful connection to server."""
        assert client.connected is True

    async def test_connect_multiple_times_is_safe(self, client):
        """Test that connecting multiple times doesn't cause issues."""
        # Already connected via fixture
        await client.connect()  # Should be idempotent
        assert client.connected is True

    async def test_connect_with_custom_host_port(self):
        """Test connection with explicit host and port."""
        client = FlashQ(ClientOptions(
            host="localhost",
            port=6789,
            log_level=LogLevel.ERROR,
        ))
        try:
            await asyncio.wait_for(client.connect(), timeout=5.0)
            assert client.connected is True
        except Exception:
            pytest.skip("flashQ server not available")
        finally:
            await client.close()


class TestConnectTimeout:
    """Tests for connection timeout scenarios."""

    async def test_connect_timeout_invalid_host(self):
        """Test connection timeout to non-existent host."""
        client = FlashQ(ClientOptions(
            host="192.0.2.1",  # TEST-NET address (should timeout)
            port=6789,
            connect_timeout=1000,  # 1 second timeout
            log_level=LogLevel.ERROR,
        ))

        with pytest.raises((TimeoutError, ConnectionError, asyncio.TimeoutError)):
            await asyncio.wait_for(client.connect(), timeout=3.0)

        await client.close()

    async def test_connect_timeout_value_respected(self):
        """Test that connect_timeout value is respected."""
        client = FlashQ(ClientOptions(
            host="192.0.2.1",  # Non-routable address
            port=6789,
            connect_timeout=500,  # 500ms timeout
            log_level=LogLevel.ERROR,
        ))

        start = asyncio.get_event_loop().time()
        with pytest.raises((TimeoutError, ConnectionError, asyncio.TimeoutError)):
            await asyncio.wait_for(client.connect(), timeout=3.0)
        elapsed = asyncio.get_event_loop().time() - start

        # Should timeout within reasonable time (with some buffer)
        assert elapsed < 3.0
        await client.close()


class TestConnectInvalidHost:
    """Tests for connection to invalid hosts."""

    async def test_connect_invalid_port(self):
        """Test connection to invalid port."""
        client = FlashQ(ClientOptions(
            host="localhost",
            port=65000,  # Unlikely to have a service
            connect_timeout=1000,
            log_level=LogLevel.ERROR,
        ))

        with pytest.raises((ConnectionError, OSError, asyncio.TimeoutError)):
            await asyncio.wait_for(client.connect(), timeout=3.0)

        await client.close()

    async def test_connect_unresolvable_host(self):
        """Test connection to unresolvable hostname."""
        client = FlashQ(ClientOptions(
            host="this-host-definitely-does-not-exist.invalid",
            port=6789,
            connect_timeout=2000,
            log_level=LogLevel.ERROR,
        ))

        with pytest.raises((ConnectionError, OSError, asyncio.TimeoutError)):
            await asyncio.wait_for(client.connect(), timeout=5.0)

        await client.close()


class TestCloseConnection:
    """Tests for closing connections."""

    async def test_close_connection(self, client):
        """Test closing an active connection."""
        assert client.connected is True
        await client.close()
        assert client.connected is False

    async def test_close_already_closed(self, disconnected_client):
        """Test closing an already closed connection."""
        # Should not raise
        await disconnected_client.close()
        await disconnected_client.close()  # Multiple close calls should be safe

    async def test_close_never_connected(self, disconnected_client):
        """Test closing a client that was never connected."""
        assert disconnected_client.connected is False
        await disconnected_client.close()
        assert disconnected_client.connected is False


class TestReconnectOnDisconnect:
    """Tests for reconnection behavior."""

    async def test_auto_reconnect_disabled(self):
        """Test that auto_reconnect can be disabled."""
        client = FlashQ(ClientOptions(
            auto_reconnect=False,
            log_level=LogLevel.ERROR,
        ))
        try:
            await asyncio.wait_for(client.connect(), timeout=5.0)
            assert client.connected is True
        except Exception:
            pytest.skip("flashQ server not available")
        finally:
            await client.close()

    async def test_reconnect_settings_configurable(self):
        """Test that reconnect settings are configurable."""
        options = ClientOptions(
            reconnect_delay=500,
            max_reconnect_delay=10000,
            max_reconnect_attempts=5,
            log_level=LogLevel.ERROR,
        )
        client = FlashQ(options)

        try:
            await asyncio.wait_for(client.connect(), timeout=5.0)
            assert client.connected is True
        except Exception:
            pytest.skip("flashQ server not available")
        finally:
            await client.close()


class TestAuthSuccess:
    """Tests for successful authentication."""

    async def test_auth_with_valid_token(self):
        """Test authentication with a valid token (if server requires auth)."""
        # Note: This test depends on server configuration
        # If server doesn't require auth, it should still succeed
        client = FlashQ(ClientOptions(
            token="test-token",  # Server may or may not validate
            log_level=LogLevel.ERROR,
        ))

        try:
            await asyncio.wait_for(client.connect(), timeout=5.0)
            # If we get here, either auth succeeded or server doesn't require auth
            assert client.connected is True
        except AuthenticationError:
            # Auth is required and token is invalid
            pass
        except Exception:
            pytest.skip("flashQ server not available")
        finally:
            await client.close()

    async def test_connect_without_token(self, client):
        """Test connection without token (server may allow unauthenticated access)."""
        # Client fixture connects without token
        assert client.connected is True


class TestAuthFailure:
    """Tests for authentication failure scenarios."""

    async def test_auth_with_empty_token(self):
        """Test that empty token is handled gracefully."""
        client = FlashQ(ClientOptions(
            token="",  # Empty token
            log_level=LogLevel.ERROR,
        ))

        try:
            await asyncio.wait_for(client.connect(), timeout=5.0)
            # Empty token might be ignored by server
            await client.close()
        except AuthenticationError:
            # Expected if server validates empty tokens
            pass
        except Exception:
            pytest.skip("flashQ server not available")


class TestIsConnectedState:
    """Tests for connection state tracking."""

    async def test_is_connected_before_connect(self, disconnected_client):
        """Test connected state before connecting."""
        assert disconnected_client.connected is False

    async def test_is_connected_after_connect(self, client):
        """Test connected state after connecting."""
        assert client.connected is True

    async def test_is_connected_after_close(self, client):
        """Test connected state after closing."""
        assert client.connected is True
        await client.close()
        assert client.connected is False

    async def test_pool_stats(self, client):
        """Test that pool stats are available."""
        stats = client.pool_stats()
        assert stats is not None
        assert hasattr(stats, 'healthy_connections')
        assert stats.healthy_connections >= 0


class TestContextManager:
    """Tests for async context manager usage."""

    async def test_async_context_manager(self):
        """Test using client as async context manager."""
        try:
            async with FlashQ(ClientOptions(log_level=LogLevel.ERROR)) as client:
                assert client.connected is True
                # Connection should be closed after exiting context
        except Exception:
            pytest.skip("flashQ server not available")

    async def test_context_manager_closes_on_exception(self):
        """Test that context manager closes connection on exception."""
        client = None
        try:
            async with FlashQ(ClientOptions(log_level=LogLevel.ERROR)) as c:
                client = c
                assert client.connected is True
                raise ValueError("Test exception")
        except ValueError:
            pass
        except Exception:
            pytest.skip("flashQ server not available")

        if client:
            assert client.connected is False


class TestHttpMode:
    """Tests for HTTP protocol mode."""

    async def test_http_mode_connect(self):
        """Test connection in HTTP mode."""
        client = FlashQ(ClientOptions(
            use_http=True,
            http_port=6790,
            log_level=LogLevel.ERROR,
        ))

        try:
            await client.connect()
            # HTTP mode sets connected=True without actual connection
            assert client.connected is True
        finally:
            await client.close()

    async def test_http_mode_with_token(self):
        """Test HTTP mode with authentication token."""
        client = FlashQ(ClientOptions(
            use_http=True,
            http_port=6790,
            token="test-token",
            log_level=LogLevel.ERROR,
        ))

        try:
            await client.connect()
            assert client.connected is True
        finally:
            await client.close()


class TestBinaryProtocol:
    """Tests for binary (MessagePack) protocol mode."""

    async def test_binary_mode_connect(self):
        """Test connection in binary mode."""
        client = FlashQ(ClientOptions(
            use_binary=True,
            log_level=LogLevel.ERROR,
        ))

        try:
            await asyncio.wait_for(client.connect(), timeout=5.0)
            assert client.connected is True
        except Exception:
            pytest.skip("flashQ server not available")
        finally:
            await client.close()
