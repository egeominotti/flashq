"""
flashQ Connection Layer

Handles TCP and HTTP protocol communication with the flashQ server.
"""

import asyncio
import json
import struct
from typing import Any, TypeVar
from dataclasses import dataclass

import msgpack

from ..types import ClientOptions, LogLevel
from ..errors import (
    ConnectionError,
    AuthenticationError,
    TimeoutError,
    parse_server_error,
)
from ..utils.logger import Logger
from ..constants import (
    DEFAULT_HOST,
    DEFAULT_PORT,
    DEFAULT_HTTP_PORT,
    DEFAULT_TIMEOUT,
    DEFAULT_CONNECT_TIMEOUT,
    DEFAULT_RECONNECT_DELAY,
    MAX_RECONNECT_DELAY,
    MAX_RECONNECT_ATTEMPTS,
    RECONNECT_JITTER_FACTOR,
    DEFAULT_MAX_QUEUED_REQUESTS,
)

T = TypeVar("T")


@dataclass
class PendingRequest:
    """Pending request waiting for response."""

    future: asyncio.Future[Any]
    timeout_handle: asyncio.TimerHandle | None = None


class FlashQConnection:
    """
    Low-level connection to flashQ server.

    Supports TCP (with JSON or MessagePack) and HTTP protocols.
    """

    def __init__(self, options: ClientOptions | None = None):
        self._options = options or ClientOptions()
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._connected = False
        self._authenticated = False
        self._request_id = 0
        self._pending_requests: dict[int, PendingRequest] = {}
        self._read_task: asyncio.Task[None] | None = None
        self._reconnect_attempts = 0
        self._reconnecting = False
        self._closing = False
        self._request_queue: list[tuple[dict[str, Any], asyncio.Future[Any]]] = []

        self._logger = Logger(
            level=self._options.log_level,
            prefix="flashQ",
        )

    @property
    def connected(self) -> bool:
        """Check if connected to server."""
        return self._connected

    @property
    def authenticated(self) -> bool:
        """Check if authenticated."""
        return self._authenticated

    async def connect(self) -> None:
        """
        Connect to flashQ server.

        Establishes TCP connection and optionally authenticates.
        """
        if self._connected:
            return

        if self._options.use_http:
            # HTTP mode doesn't need persistent connection
            self._connected = True
            if self._options.token:
                self._authenticated = True
            return

        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(
                    self._options.host or DEFAULT_HOST,
                    self._options.port or DEFAULT_PORT,
                ),
                timeout=(self._options.connect_timeout or DEFAULT_CONNECT_TIMEOUT) / 1000,
            )

            self._connected = True
            self._reconnect_attempts = 0
            self._logger.debug(
                "Connected",
                host=self._options.host,
                port=self._options.port,
            )

            # Start read loop
            self._read_task = asyncio.create_task(self._read_loop())

            # Authenticate if token provided
            if self._options.token:
                await self.auth(self._options.token)

            # Process queued requests
            await self._process_queued_requests()

        except asyncio.TimeoutError:
            raise TimeoutError(
                f"Connection timeout after {self._options.connect_timeout}ms",
                timeout_ms=self._options.connect_timeout,
            )
        except OSError as e:
            raise ConnectionError(f"Failed to connect: {e}")

    async def close(self) -> None:
        """Close connection to server."""
        self._closing = True
        self._connected = False

        # Cancel pending requests
        for req_id, pending in self._pending_requests.items():
            if pending.timeout_handle:
                pending.timeout_handle.cancel()
            if not pending.future.done():
                pending.future.set_exception(
                    ConnectionError("Connection closed")
                )
        self._pending_requests.clear()

        # Cancel read task
        if self._read_task:
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass
            self._read_task = None

        # Close socket
        if self._writer:
            self._writer.close()
            try:
                await self._writer.wait_closed()
            except Exception:
                pass
            self._writer = None
            self._reader = None

        self._logger.debug("Connection closed")

    async def auth(self, token: str) -> bool:
        """
        Authenticate with the server.

        Args:
            token: Authentication token

        Returns:
            True if authentication succeeded

        Raises:
            AuthenticationError: If authentication fails
        """
        response = await self._send({"cmd": "AUTH", "token": token})

        if response.get("error"):
            raise AuthenticationError(response.get("error", "Authentication failed"))

        self._authenticated = True
        self._logger.debug("Authenticated")
        return True

    async def _send(
        self,
        command: dict[str, Any],
        timeout: int | None = None,
    ) -> dict[str, Any]:
        """
        Send command and wait for response.

        Args:
            command: Command dictionary
            timeout: Optional timeout override (ms)

        Returns:
            Response dictionary
        """
        if self._options.use_http:
            return await self._send_http(command, timeout)
        return await self._send_tcp(command, timeout)

    async def _send_tcp(
        self,
        command: dict[str, Any],
        timeout: int | None = None,
    ) -> dict[str, Any]:
        """Send command over TCP."""
        if not self._connected or not self._writer:
            if self._options.queue_on_disconnect and self._reconnecting:
                return await self._queue_request(command)
            raise ConnectionError("Not connected")

        # Generate request ID
        self._request_id += 1
        req_id = self._request_id
        command["reqId"] = req_id

        # Create pending request
        loop = asyncio.get_event_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        pending = PendingRequest(future=future)
        self._pending_requests[req_id] = pending

        # Set timeout
        timeout_ms = timeout or self._options.timeout or DEFAULT_TIMEOUT

        def on_timeout() -> None:
            if req_id in self._pending_requests:
                del self._pending_requests[req_id]
                if not future.done():
                    future.set_exception(
                        TimeoutError(f"Request timed out after {timeout_ms}ms", timeout_ms)
                    )

        pending.timeout_handle = loop.call_later(timeout_ms / 1000, on_timeout)

        # Serialize and send
        try:
            if self._options.use_binary:
                data = msgpack.packb(command)
                # Send with length prefix for binary protocol
                self._writer.write(struct.pack(">I", len(data)) + data)
            else:
                data = json.dumps(command).encode() + b"\n"
                self._writer.write(data)

            await self._writer.drain()
            self._logger.trace("Sent", cmd=command.get("cmd"), req_id=req_id)

        except Exception as e:
            if pending.timeout_handle:
                pending.timeout_handle.cancel()
            if req_id in self._pending_requests:
                del self._pending_requests[req_id]
            raise ConnectionError(f"Failed to send: {e}")

        # Wait for response
        return await future

    async def _send_http(
        self,
        command: dict[str, Any],
        timeout: int | None = None,
    ) -> dict[str, Any]:
        """Send command over HTTP."""
        import aiohttp

        url = f"http://{self._options.host}:{self._options.http_port or DEFAULT_HTTP_PORT}/api/command"
        timeout_ms = timeout or self._options.timeout or DEFAULT_TIMEOUT

        headers = {"Content-Type": "application/json"}
        if self._options.token:
            headers["Authorization"] = f"Bearer {self._options.token}"

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    json=command,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=timeout_ms / 1000),
                ) as response:
                    if response.status == 401:
                        raise AuthenticationError()
                    data = await response.json()
                    return data

        except asyncio.TimeoutError:
            raise TimeoutError(f"HTTP request timed out after {timeout_ms}ms", timeout_ms)
        except aiohttp.ClientError as e:
            raise ConnectionError(f"HTTP request failed: {e}")

    async def _read_loop(self) -> None:
        """Background task to read responses from TCP socket."""
        buffer = b""

        while self._connected and self._reader:
            try:
                data = await self._reader.read(65536)
                if not data:
                    break

                buffer += data

                # Process complete messages
                while buffer:
                    if self._options.use_binary:
                        # Binary protocol: 4-byte length prefix
                        if len(buffer) < 4:
                            break
                        msg_len = struct.unpack(">I", buffer[:4])[0]
                        if len(buffer) < 4 + msg_len:
                            break
                        msg_data = buffer[4 : 4 + msg_len]
                        buffer = buffer[4 + msg_len :]
                        response = msgpack.unpackb(msg_data, raw=False)
                    else:
                        # JSON protocol: newline-delimited
                        if b"\n" not in buffer:
                            break
                        line, buffer = buffer.split(b"\n", 1)
                        response = json.loads(line.decode())

                    self._handle_response(response)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self._logger.error("Read error", error=str(e))
                break

        # Connection lost
        if not self._closing:
            await self._handle_disconnect()

    def _handle_response(self, response: dict[str, Any]) -> None:
        """Handle incoming response."""
        req_id = response.get("reqId")
        if req_id is None:
            return

        pending = self._pending_requests.pop(req_id, None)
        if pending is None:
            return

        if pending.timeout_handle:
            pending.timeout_handle.cancel()

        if not pending.future.done():
            if response.get("error"):
                error = parse_server_error(response["error"])
                pending.future.set_exception(error)
            else:
                pending.future.set_result(response)

    async def _handle_disconnect(self) -> None:
        """Handle unexpected disconnection."""
        self._connected = False
        self._logger.warn("Disconnected from server")

        if self._options.auto_reconnect and not self._closing:
            await self._reconnect()

    async def _reconnect(self) -> None:
        """Attempt to reconnect to server."""
        if self._reconnecting:
            return

        self._reconnecting = True
        max_attempts = self._options.max_reconnect_attempts or MAX_RECONNECT_ATTEMPTS

        while self._reconnect_attempts < max_attempts and not self._closing:
            self._reconnect_attempts += 1

            # Calculate delay with exponential backoff and jitter
            base_delay = min(
                (self._options.reconnect_delay or DEFAULT_RECONNECT_DELAY)
                * (2 ** (self._reconnect_attempts - 1)),
                self._options.max_reconnect_delay or MAX_RECONNECT_DELAY,
            )
            import random
            jitter = random.uniform(0, RECONNECT_JITTER_FACTOR * base_delay)
            delay = (base_delay + jitter) / 1000

            self._logger.info(
                "Reconnecting",
                attempt=self._reconnect_attempts,
                delay_ms=int(delay * 1000),
            )

            await asyncio.sleep(delay)

            try:
                await self.connect()
                self._reconnecting = False
                self._logger.info("Reconnected")
                return
            except Exception as e:
                self._logger.warn(
                    "Reconnection failed",
                    attempt=self._reconnect_attempts,
                    error=str(e),
                )

        self._reconnecting = False
        self._logger.error("Max reconnection attempts reached")

    async def _queue_request(
        self,
        command: dict[str, Any],
    ) -> dict[str, Any]:
        """Queue request for later when reconnected."""
        if len(self._request_queue) >= (
            self._options.max_queued_requests or DEFAULT_MAX_QUEUED_REQUESTS
        ):
            raise ConnectionError("Request queue full")

        loop = asyncio.get_event_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._request_queue.append((command, future))
        return await future

    async def _process_queued_requests(self) -> None:
        """Process queued requests after reconnection."""
        while self._request_queue:
            command, future = self._request_queue.pop(0)
            try:
                result = await self._send(command)
                if not future.done():
                    future.set_result(result)
            except Exception as e:
                if not future.done():
                    future.set_exception(e)
