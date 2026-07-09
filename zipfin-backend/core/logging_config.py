"""Structured logging configuration for ZipRIGHT.

In development (ENV != "production"):
    Human-readable format:  ``2026-07-07 12:00:00 INFO  main: message``

In production (ENV == "production"):
    JSON lines, one object per record::

        {"timestamp": "...", "level": "INFO", "logger": "main",
         "message": "...", "request_id": "...", "duration_ms": 12.3}

    This format is compatible with Google Cloud Logging, Datadog, Loki, etc.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone


class _JsonFormatter(logging.Formatter):
    """Emit log records as single-line JSON objects."""

    # Fields copied directly from LogRecord to the JSON envelope.
    _COPY_FIELDS = ("name", "levelname", "pathname", "lineno", "thread")

    def format(self, record: logging.LogRecord) -> str:
        self.formatException  # ensure exc_info is available

        payload: dict = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Optional contextual fields injected by middleware
        for field in ("request_id", "duration_ms", "method", "path", "status"):
            val = getattr(record, field, None)
            if val is not None:
                payload[field] = val

        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=False)


def configure_logging(env: str | None = None) -> None:
    """Configure root logger based on the current environment.

    Args:
        env: The environment name (e.g. ``"production"``). Defaults to the
             ``ENV`` environment variable, falling back to ``"development"``.
    """
    env = (env or os.getenv("ENV", "development")).strip().lower()
    log_level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_name, logging.INFO)

    root = logging.getLogger()
    root.setLevel(log_level)

    # Remove any existing handlers to avoid duplicates on re-call
    root.handlers.clear()

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(log_level)

    if env == "production":
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                fmt="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )

    root.addHandler(handler)
    logging.getLogger("uvicorn.access").propagate = False
