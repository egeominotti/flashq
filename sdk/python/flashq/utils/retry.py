"""
flashQ Retry Utilities

Retry logic with exponential backoff and jitter.
"""

import asyncio
import random
from dataclasses import dataclass
from typing import Callable, TypeVar, Awaitable, Any

from ..errors import FlashQError

T = TypeVar("T")


@dataclass
class RetryConfig:
    """Retry configuration."""

    max_attempts: int = 3
    delay: int = 1000  # ms
    max_delay: int = 30000  # ms
    backoff_multiplier: float = 2.0
    jitter: bool = True
    retry_condition: Callable[[Exception], bool] | None = None


class RetryPresets:
    """Common retry configurations."""

    @staticmethod
    def aggressive() -> RetryConfig:
        """Aggressive retry: 5 attempts, short delays."""
        return RetryConfig(
            max_attempts=5,
            delay=500,
            max_delay=5000,
            backoff_multiplier=1.5,
        )

    @staticmethod
    def conservative() -> RetryConfig:
        """Conservative retry: 3 attempts, longer delays."""
        return RetryConfig(
            max_attempts=3,
            delay=2000,
            max_delay=60000,
            backoff_multiplier=2.0,
        )

    @staticmethod
    def network() -> RetryConfig:
        """Network retry: handles connection issues."""
        return RetryConfig(
            max_attempts=5,
            delay=1000,
            max_delay=30000,
            backoff_multiplier=2.0,
            retry_condition=lambda e: isinstance(e, FlashQError) and e.retryable,
        )

    @staticmethod
    def none() -> RetryConfig:
        """No retry."""
        return RetryConfig(max_attempts=1)


def calculate_delay(
    attempt: int,
    config: RetryConfig,
) -> float:
    """Calculate delay for retry attempt with exponential backoff and jitter."""
    base_delay = config.delay * (config.backoff_multiplier ** (attempt - 1))
    delay = min(base_delay, config.max_delay)

    if config.jitter:
        jitter = random.uniform(0, 0.3 * delay)
        delay += jitter

    return delay / 1000  # Convert to seconds


def should_retry(error: Exception, config: RetryConfig) -> bool:
    """Determine if an error should trigger a retry."""
    if config.retry_condition:
        return config.retry_condition(error)

    if isinstance(error, FlashQError):
        return error.retryable

    # Retry on common transient errors
    return isinstance(error, (ConnectionError, TimeoutError, OSError))


async def retry(
    fn: Callable[[], Awaitable[T]],
    config: RetryConfig | None = None,
    on_retry: Callable[[int, Exception], Any] | None = None,
) -> T:
    """
    Execute an async function with retry logic.

    Args:
        fn: Async function to execute
        config: Retry configuration
        on_retry: Callback on each retry (attempt, error)

    Returns:
        Result of the function

    Raises:
        The last error if all retries fail
    """
    if config is None:
        config = RetryConfig()

    last_error: Exception | None = None

    for attempt in range(1, config.max_attempts + 1):
        try:
            return await fn()
        except Exception as e:
            last_error = e

            if attempt >= config.max_attempts:
                raise

            if not should_retry(e, config):
                raise

            delay = calculate_delay(attempt, config)

            if on_retry:
                on_retry(attempt, e)

            await asyncio.sleep(delay)

    # Should never reach here, but satisfy type checker
    assert last_error is not None
    raise last_error


def retry_sync(
    fn: Callable[[], T],
    config: RetryConfig | None = None,
    on_retry: Callable[[int, Exception], Any] | None = None,
) -> T:
    """
    Execute a sync function with retry logic.

    Args:
        fn: Function to execute
        config: Retry configuration
        on_retry: Callback on each retry (attempt, error)

    Returns:
        Result of the function

    Raises:
        The last error if all retries fail
    """
    import time

    if config is None:
        config = RetryConfig()

    last_error: Exception | None = None

    for attempt in range(1, config.max_attempts + 1):
        try:
            return fn()
        except Exception as e:
            last_error = e

            if attempt >= config.max_attempts:
                raise

            if not should_retry(e, config):
                raise

            delay = calculate_delay(attempt, config)

            if on_retry:
                on_retry(attempt, e)

            time.sleep(delay)

    assert last_error is not None
    raise last_error
