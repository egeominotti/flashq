"""
flashQ Connection Pool

High-performance connection pool with health checks and auto-reconnect.
"""

import asyncio
import random
from dataclasses import dataclass, field
from typing import Any

from .connection import FlashQConnection
from ..types import ClientOptions
from ..errors import ConnectionError
from ..utils.logger import Logger


@dataclass
class PooledConnection:
    """A connection in the pool with health tracking."""

    connection: FlashQConnection
    healthy: bool = True
    failures: int = 0
    last_use: float = 0.0

    def mark_healthy(self) -> None:
        self.healthy = True
        self.failures = 0

    def mark_unhealthy(self) -> None:
        self.healthy = False
        self.failures += 1


@dataclass
class PoolStats:
    """Connection pool statistics."""

    total_connections: int = 0
    healthy_connections: int = 0
    total_reconnects: int = 0
    total_failures: int = 0


class ConnectionPool:
    """
    Connection pool for flashQ with health checks.

    Features:
    - Multiple connections with round-robin selection
    - Background health checking
    - Auto-reconnect with exponential backoff
    - Request retry on connection failure

    Example:
        ```python
        pool = ConnectionPool(options, pool_size=4)
        await pool.connect()

        response = await pool.send({"cmd": "PUSH", ...})

        await pool.close()
        ```
    """

    DEFAULT_POOL_SIZE = 4
    HEALTH_CHECK_INTERVAL = 5.0  # seconds

    def __init__(
        self,
        options: ClientOptions | None = None,
        pool_size: int | None = None,
    ):
        self._options = options or ClientOptions()
        self._pool_size = pool_size or self._options.pool_size or self.DEFAULT_POOL_SIZE
        self._connections: list[PooledConnection] = []
        self._index = 0
        self._lock = asyncio.Lock()
        self._connected = False
        self._closing = False
        self._health_task: asyncio.Task[None] | None = None

        # Metrics
        self._total_reconnects = 0
        self._total_failures = 0

        self._logger = Logger(
            level=self._options.log_level,
            prefix="Pool",
        )

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def pool_size(self) -> int:
        return self._pool_size

    async def connect(self) -> None:
        """Connect all connections in the pool."""
        if self._connected:
            return

        async with self._lock:
            if self._connected:
                return

            # Create and connect all connections
            for i in range(self._pool_size):
                conn = FlashQConnection(self._options)
                try:
                    await conn.connect()
                    pc = PooledConnection(
                        connection=conn,
                        healthy=True,
                        last_use=asyncio.get_event_loop().time(),
                    )
                    self._connections.append(pc)
                except Exception as e:
                    # Close already created connections
                    for pc in self._connections:
                        await pc.connection.close()
                    self._connections.clear()
                    raise ConnectionError(f"Failed to create pool: {e}")

            self._connected = True
            self._logger.debug(
                "Pool connected",
                size=self._pool_size,
            )

            # Start health checker
            self._health_task = asyncio.create_task(self._health_checker())

    async def close(self) -> None:
        """Close all connections in the pool."""
        self._closing = True
        self._connected = False

        # Stop health checker
        if self._health_task:
            self._health_task.cancel()
            try:
                await self._health_task
            except asyncio.CancelledError:
                pass
            self._health_task = None

        # Close all connections
        async with self._lock:
            for pc in self._connections:
                try:
                    await pc.connection.close()
                except Exception:
                    pass
            self._connections.clear()

        self._logger.debug("Pool closed")

    def stats(self) -> PoolStats:
        """Get pool statistics."""
        healthy = sum(1 for pc in self._connections if pc.healthy)
        return PoolStats(
            total_connections=len(self._connections),
            healthy_connections=healthy,
            total_reconnects=self._total_reconnects,
            total_failures=self._total_failures,
        )

    async def send(
        self,
        command: dict[str, Any],
        timeout: int | None = None,
    ) -> dict[str, Any]:
        """
        Send command on next available connection.

        Automatically retries on different connection if first fails.
        """
        if not self._connected:
            raise ConnectionError("Pool not connected")

        # Get next healthy connection (round-robin)
        pc, idx = self._get_connection()
        if pc is None:
            raise ConnectionError("No available connections")

        try:
            response = await pc.connection._send(command, timeout)
            pc.mark_healthy()
            pc.last_use = asyncio.get_event_loop().time()
            return response

        except Exception as e:
            pc.mark_unhealthy()
            self._total_failures += 1

            # Try another connection
            pc2, _ = self._get_connection(exclude_idx=idx)
            if pc2 is not None and pc2 != pc:
                try:
                    response = await pc2.connection._send(command, timeout)
                    pc2.mark_healthy()
                    return response
                except Exception:
                    pc2.mark_unhealthy()

            raise ConnectionError(f"All connections failed: {e}")

    def _get_connection(
        self,
        exclude_idx: int | None = None,
    ) -> tuple[PooledConnection | None, int]:
        """Get next healthy connection using round-robin."""
        if not self._connections:
            return None, -1

        # Try to find a healthy connection
        for i in range(len(self._connections)):
            idx = (self._index + i) % len(self._connections)
            if exclude_idx is not None and idx == exclude_idx:
                continue

            pc = self._connections[idx]
            if pc.healthy and pc.connection.connected:
                self._index = (idx + 1) % len(self._connections)
                return pc, idx

        # Fallback to any connection
        self._index = (self._index + 1) % len(self._connections)
        idx = self._index
        if exclude_idx is not None and idx == exclude_idx:
            idx = (idx + 1) % len(self._connections)
        return self._connections[idx], idx

    async def _health_checker(self) -> None:
        """Background task to check and reconnect unhealthy connections."""
        while not self._closing:
            try:
                await asyncio.sleep(self.HEALTH_CHECK_INTERVAL)

                if self._closing:
                    break

                await self._check_and_reconnect()

            except asyncio.CancelledError:
                break
            except Exception as e:
                self._logger.warn("Health check error", error=str(e))

    async def _check_and_reconnect(self) -> None:
        """Check connections and reconnect unhealthy ones."""
        for i, pc in enumerate(self._connections):
            if self._closing:
                break

            if not pc.healthy or not pc.connection.connected or pc.failures > 0:
                await self._reconnect_connection(i)

    async def _reconnect_connection(self, idx: int) -> None:
        """Reconnect a specific connection with backoff."""
        if idx >= len(self._connections):
            return

        pc = self._connections[idx]

        # Close old connection
        try:
            await pc.connection.close()
        except Exception:
            pass

        # Exponential backoff
        max_attempts = self._options.max_reconnect_attempts or 10
        base_delay = (self._options.reconnect_delay or 1000) / 1000  # to seconds
        max_delay = (self._options.max_reconnect_delay or 30000) / 1000

        for attempt in range(max_attempts):
            if self._closing:
                return

            delay = min(base_delay * (2 ** attempt), max_delay)
            jitter = random.uniform(0, 0.1 * delay)

            await asyncio.sleep(delay + jitter)

            try:
                new_conn = FlashQConnection(self._options)
                await new_conn.connect()

                self._connections[idx] = PooledConnection(
                    connection=new_conn,
                    healthy=True,
                    last_use=asyncio.get_event_loop().time(),
                )
                self._total_reconnects += 1

                self._logger.info(
                    "Reconnected",
                    connection=idx,
                    attempt=attempt + 1,
                )
                return

            except Exception as e:
                self._logger.warn(
                    "Reconnection failed",
                    connection=idx,
                    attempt=attempt + 1,
                    error=str(e),
                )

        self._logger.error(
            "Max reconnection attempts reached",
            connection=idx,
        )
