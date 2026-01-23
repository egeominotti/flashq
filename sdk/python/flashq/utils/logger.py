"""
flashQ Logger

Simple, configurable logger for the SDK.
"""

import sys
from datetime import datetime
from typing import Any

from ..types import LogLevel


class Logger:
    """Simple logger with level filtering."""

    LEVEL_ORDER = {
        LogLevel.TRACE: 0,
        LogLevel.DEBUG: 1,
        LogLevel.INFO: 2,
        LogLevel.WARN: 3,
        LogLevel.ERROR: 4,
        LogLevel.SILENT: 5,
    }

    def __init__(
        self,
        level: LogLevel = LogLevel.INFO,
        prefix: str = "flashQ",
    ):
        self.level = level
        self.prefix = prefix
        self._request_id: str | None = None

    def set_level(self, level: LogLevel) -> None:
        """Set log level."""
        self.level = level

    def set_request_id(self, request_id: str | None) -> None:
        """Set request ID for correlation."""
        self._request_id = request_id

    def _should_log(self, level: LogLevel) -> bool:
        """Check if message should be logged."""
        return self.LEVEL_ORDER[level] >= self.LEVEL_ORDER[self.level]

    def _format(self, level: LogLevel, message: str, **kwargs: Any) -> str:
        """Format log message."""
        timestamp = datetime.now().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        level_str = level.value.upper().ljust(5)
        prefix = f"[{self.prefix}]" if self.prefix else ""

        parts = [timestamp, level_str, prefix, message]

        if self._request_id:
            kwargs["req_id"] = self._request_id

        if kwargs:
            extras = " ".join(f"{k}={v}" for k, v in kwargs.items())
            parts.append(extras)

        return " ".join(filter(None, parts))

    def _log(self, level: LogLevel, message: str, **kwargs: Any) -> None:
        """Log a message."""
        if not self._should_log(level):
            return
        formatted = self._format(level, message, **kwargs)
        stream = sys.stderr if level in (LogLevel.ERROR, LogLevel.WARN) else sys.stdout
        print(formatted, file=stream)

    def trace(self, message: str, **kwargs: Any) -> None:
        """Log trace message."""
        self._log(LogLevel.TRACE, message, **kwargs)

    def debug(self, message: str, **kwargs: Any) -> None:
        """Log debug message."""
        self._log(LogLevel.DEBUG, message, **kwargs)

    def info(self, message: str, **kwargs: Any) -> None:
        """Log info message."""
        self._log(LogLevel.INFO, message, **kwargs)

    def warn(self, message: str, **kwargs: Any) -> None:
        """Log warning message."""
        self._log(LogLevel.WARN, message, **kwargs)

    def error(self, message: str, **kwargs: Any) -> None:
        """Log error message."""
        self._log(LogLevel.ERROR, message, **kwargs)
