"""Centralized Redis client provider for distributed state management.

Supports connection to external Redis (GCP Memorystore, Redis Cloud, Docker)
via REDIS_URL, with automatic fallback to an in-process fakeredis instance
for frictionless local development and testing when no external server is running.

Azure Managed Redis note
------------------------
Azure Managed Redis (OSSCluster policy, Access Key auth) requires the two-argument
ACL AUTH command:  AUTH default <password>
redis-py >= 5 issues only the single-argument form AUTH <password> when the username
in the URL is empty (the common ``rediss://:<key>@host`` pattern), which Azure rejects
with "invalid username-password pair".

_parse_redis_url_to_kwargs() works around this by:
  1. Normalising an empty/missing username to 'default'.
  2. Percent-decoding the password so Azure Base64 keys containing +, / or =
     that were percent-encoded in the URL arrive at AUTH unchanged.
  3. Setting ssl=True for rediss:// without going through from_url().
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any
from urllib.parse import urlparse, unquote

import redis

logger = logging.getLogger(__name__)

_CLIENT: redis.Redis | None = None
_LOCK = threading.Lock()
_USING_FAKE = False


def _parse_redis_url_to_kwargs(redis_url: str) -> dict:
    """Parse a REDIS_URL into explicit redis.Redis() constructor kwargs.

    This replaces ``redis.Redis.from_url()`` to work around two Azure-specific
    authentication issues:

    1. **Empty username → AUTH mismatch**: A URL of the form
       ``rediss://:<password>@host`` gives an empty userinfo segment that
       redis-py maps to ``username=''``, causing it to issue the single-argument
       form ``AUTH <password>``.  Azure Managed Redis requires the two-argument
       ACL form ``AUTH default <password>`` and responds with
       "invalid username-password pair" when it receives the single-arg form.
       Fix: normalise any empty/missing username to ``'default'``.

    2. **Percent-encoded password**: Azure access keys are Base64 strings that
       often contain ``+``, ``/`` and ``=``.  When stored inside a URI these
       characters must be percent-encoded (``%2B``, ``%2F``, ``%3D``).  redis-py's
       ``from_url()`` passes the raw URL-encoded string to AUTH without decoding,
       so the key the server receives never matches the one it issued.
       Fix: ``unquote()`` the password component before handing it to redis-py.
    """
    parsed = urlparse(redis_url)

    # --- username: normalise empty string to 'default' for Azure ACL AUTH ---
    username: str | None = parsed.username or "default"

    # --- password: percent-decode Base64 chars (+, /, =) ---
    password: str | None = unquote(parsed.password) if parsed.password else None

    # --- database index from the URL path (e.g. /0) ---
    try:
        db = int(parsed.path.lstrip("/")) if parsed.path and parsed.path != "/" else 0
    except ValueError:
        db = 0

    ssl = parsed.scheme == "rediss"

    kwargs: dict = {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or (10000 if ssl else 6379),
        "db": db,
        "username": username,
        "password": password,
        "ssl": ssl,
    }
    return kwargs


def _create_client() -> redis.Redis:
    global _USING_FAKE
    redis_url = os.getenv("REDIS_URL", "").strip()
    timeout = float(os.getenv("REDIS_TIMEOUT_SECONDS", "2.0"))
    env = os.getenv("ENV", "development").strip().lower()

    if redis_url:
        try:
            conn_kwargs = _parse_redis_url_to_kwargs(redis_url)
            client = redis.Redis(
                **conn_kwargs,
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
                "Failed to connect to Redis at %s: %s.",
                redis_url.split("@")[-1],
                exc,
            )
            if env in ("staging", "production") or os.getenv("STRICT_REDIS_SECURITY", "").lower() in ("true", "1"):
                logger.error("Fakeredis fallback is forbidden in %s environment. Redis is unavailable.", env)
                _USING_FAKE = False
                return client

    if env in ("staging", "production") or os.getenv("STRICT_REDIS_SECURITY", "").lower() in ("true", "1"):
        logger.error("REDIS_URL is required in %s environment. In-process fakeredis fallback is forbidden.", env)
        _USING_FAKE = False
        return redis.Redis(host="unconfigured-redis-host", port=6379, socket_timeout=timeout, socket_connect_timeout=timeout, decode_responses=True)

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
