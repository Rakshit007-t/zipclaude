"""Centralized Redis client provider for distributed state management.

Supports connection to external Redis (GCP Memorystore, Redis Cloud, Docker)
via REDIS_URL, with automatic fallback to an in-process fakeredis instance
for frictionless local development and testing when no external server is running.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any

import redis

logger = logging.getLogger(__name__)

_CLIENT: redis.Redis | None = None
_LOCK = threading.Lock()
_USING_FAKE = False


def _create_client() -> redis.Redis:
    global _USING_FAKE
    redis_url = os.getenv("REDIS_URL", "").strip()
    timeout = float(os.getenv("REDIS_TIMEOUT_SECONDS", "2.0"))

    if redis_url:
        try:
            client = redis.Redis.from_url(
                redis_url,
                decode_responses=True,
                socket_timeout=timeout,
                socket_connect_timeout=timeout,
                retry_on_timeout=True,
            )
            client.ping()
            _USING_FAKE = False
            logger.info("Connected to distributed Redis server at %s", redis_url.split("@")[-1])
            return client
        except Exception as exc:
            logger.warning(
                "Failed to connect to Redis at %s: %s. Falling back to in-process Redis emulation.",
                redis_url.split("@")[-1],
                exc,
            )

    # In-process fakeredis fallback for local development & testing
    try:
        import fakeredis
        # Using a shared FakeServer so multiple client instances in the same process share state
        if not hasattr(_create_client, "_fake_server"):
            _create_client._fake_server = fakeredis.FakeServer()
        client = fakeredis.FakeRedis(server=_create_client._fake_server, decode_responses=True)
        _USING_FAKE = True
        logger.info("Initialized in-process Redis emulation (fakeredis) for local development/testing.")
        return client
    except Exception as exc:
        logger.error("Failed to initialize fakeredis: %s", exc)
        # Fallback to standard client without connection
        return redis.Redis(decode_responses=True)


def get_redis_client() -> redis.Redis:
    """Return the thread-safe singleton Redis client."""
    global _CLIENT
    if _CLIENT is None:
        with _LOCK:
            if _CLIENT is None:
                _CLIENT = _create_client()
    return _CLIENT


def is_using_fake_redis() -> bool:
    """Return whether the current client is using in-process fakeredis."""
    global _USING_FAKE
    get_redis_client()
    return _USING_FAKE


def is_redis_healthy() -> bool:
    """Check if the Redis client responds to a ping."""
    try:
        client = get_redis_client()
        return bool(client.ping())
    except Exception:
        return False


def reset_redis_client_for_testing(new_client: redis.Redis | None = None) -> None:
    """Reset or override the client singleton (useful for test isolation)."""
    global _CLIENT, _USING_FAKE
    with _LOCK:
        if new_client is not None:
            _CLIENT = new_client
            _USING_FAKE = False
        else:
            if hasattr(_create_client, "_fake_server"):
                delattr(_create_client, "_fake_server")
            _CLIENT = None
            _USING_FAKE = False
