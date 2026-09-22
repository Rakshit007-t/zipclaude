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
import re
import threading
from typing import Any, Union
from urllib.parse import urlparse, unquote

import redis

logger = logging.getLogger(__name__)

_CLIENT: Union[redis.Redis, Any, None] = None
_LOCK = threading.Lock()
_USING_FAKE = False


def _normalize_redis_url(redis_url: str) -> str:
    """Ensure REDIS_URL has an explicit username (defaulting to 'default').

    Azure Managed Redis (and Redis 6+ ACLs) requires the two-argument ACL AUTH:
    AUTH default <password>. When REDIS_URL has an empty username segment
    (e.g. 'rediss://:key@host'), redis-py's from_url() parses username as ''
    and issues single-argument AUTH <password>, which Azure rejects with
    'invalid username-password pair'. Normalising to 'rediss://default:key@host'
    ensures the two-argument ACL AUTH is sent.
    """
    if re.search(r"://:(?=[^@]+@)", redis_url):
        return re.sub(r"://:(?=[^@]+@)", "://default:", redis_url, count=1)
    return redis_url


def _parse_redis_url_to_kwargs(redis_url: str) -> dict:
    """Parse a REDIS_URL into explicit redis connection kwargs.

    Handles edge cases:
    - Normalises empty username to 'default'.
    - Percent-decodes passwords containing %2B, %2F, %3D.
    - Uses regex extraction to protect raw characters (+, /, =, @, :) from urlparse path-splitting.
    """
    norm_url = _normalize_redis_url(redis_url)

    # First attempt: regex parser to preserve raw slashes in Base64 keys from being treated as URL path
    m = re.match(
        r"^(?P<scheme>rediss?)://(?:(?P<userinfo>.*)@)(?P<host>[^@:/]+)(?::(?P<port>\d+))?(?P<path>/.*)?$",
        norm_url,
    )
    if m:
        d = m.groupdict()
        userinfo = d.get("userinfo") or ""
        if ":" in userinfo:
            u, p = userinfo.split(":", 1)
        else:
            u, p = userinfo, ""
        username = u if u else "default"
        raw_password = p if p else None
        password = unquote(raw_password) if raw_password else None
        scheme = d["scheme"]
        ssl = (scheme == "rediss")
        host = d["host"]
        port = int(d["port"]) if d["port"] else (10000 if ssl else 6379)
        path = (d.get("path") or "").lstrip("/")
        db = int(path) if path.isdigit() else 0
        return {
            "host": host,
            "port": port,
            "db": db,
            "username": username,
            "password": password,
            "ssl": ssl,
        }

    # Standard fallback if regex did not match (e.g. URL without userinfo segment)
    try:
        from redis.connection import parse_url
        kwargs = parse_url(norm_url)
    except Exception:
        kwargs = {}

    if not kwargs or not kwargs.get("host"):
        parsed = urlparse(norm_url)
        username = parsed.username or "default"
        password = unquote(parsed.password) if parsed.password else None
        try:
            db = int(parsed.path.lstrip("/")) if parsed.path and parsed.path != "/" else 0
        except ValueError:
            db = 0
        ssl = parsed.scheme == "rediss"
        kwargs = {
            "host": parsed.hostname or "localhost",
            "port": parsed.port or (10000 if ssl else 6379),
            "db": db,
            "username": username,
            "password": password,
            "ssl": ssl,
        }

    conn_class = kwargs.pop("connection_class", None)
    ssl = kwargs.get("ssl", conn_class is not None and "SSL" in getattr(conn_class, "__name__", ""))
    kwargs["ssl"] = ssl
    if "username" not in kwargs or not kwargs["username"]:
        kwargs["username"] = "default"
    return kwargs


def _resolve_redis_connection_config() -> dict[str, Any]:
    """Resolve Redis connection settings from discrete env vars or REDIS_URL.

    Prioritises discrete settings (REDIS_HOST, REDIS_PORT, REDIS_USERNAME,
    REDIS_PASSWORD, REDIS_SSL, REDIS_CLUSTER_MODE) to completely eliminate
    URL encoding, parsing, and delimiter collision bugs with Azure Managed Redis
    primary keys (which contain Base64 characters +, /, =).

    Falls back cleanly to REDIS_URL for local development, testing, and backward compatibility.
    """
    redis_host = os.getenv("REDIS_HOST", "").strip()
    redis_port_env = os.getenv("REDIS_PORT", "").strip()
    redis_username = os.getenv("REDIS_USERNAME", "").strip() or "default"
    redis_password = os.getenv("REDIS_PASSWORD", "").strip("\r\n")
    redis_ssl_env = os.getenv("REDIS_SSL", "").strip().lower()
    redis_cluster_env = os.getenv("REDIS_CLUSTER_MODE", "").strip().lower()
    redis_url = os.getenv("REDIS_URL", "").strip()

    # Safety check: if REDIS_PASSWORD was configured pointing to a full URL secret
    if redis_password.startswith(("redis://", "rediss://")):
        if not redis_url:
            redis_url = redis_password
            redis_password = ""

    config: dict[str, Any] = {
        "host": None,
        "port": None,
        "db": 0,
        "username": "default",
        "password": None,
        "ssl": False,
        "is_cluster": False,
        "configured": False,
    }

    if redis_host:
        config["host"] = redis_host
        is_azure = "redis.azure.net" in redis_host.lower()
        if redis_ssl_env:
            config["ssl"] = redis_ssl_env in ("true", "1", "yes")
        else:
            config["ssl"] = is_azure or (redis_port_env == "10000")

        if redis_port_env:
            try:
                config["port"] = int(redis_port_env)
            except ValueError:
                config["port"] = 10000 if config["ssl"] else 6379
        else:
            config["port"] = 10000 if config["ssl"] else 6379

        config["username"] = redis_username or "default"
        config["password"] = redis_password if redis_password else None

        if redis_cluster_env:
            config["is_cluster"] = redis_cluster_env in ("true", "1", "yes")
        else:
            config["is_cluster"] = is_azure

        # If discrete REDIS_PASSWORD was not set, but REDIS_URL was supplied, extract password from REDIS_URL
        if not config["password"] and redis_url:
            url_kwargs = _parse_redis_url_to_kwargs(redis_url)
            config["password"] = url_kwargs.get("password")

        config["configured"] = True
        return config

    if redis_url:
        url_kwargs = _parse_redis_url_to_kwargs(redis_url)
        config["host"] = url_kwargs.get("host")
        config["port"] = url_kwargs.get("port", 6379)
        config["db"] = url_kwargs.get("db", 0)
        config["username"] = url_kwargs.get("username", "default")
        # Discrete REDIS_PASSWORD overrides any password extracted from the URL
        config["password"] = redis_password if redis_password else url_kwargs.get("password")
        config["ssl"] = url_kwargs.get("ssl", False)

        is_azure = "redis.azure.net" in (config["host"] or "").lower()
        if redis_cluster_env:
            config["is_cluster"] = redis_cluster_env in ("true", "1", "yes")
        else:
            config["is_cluster"] = is_azure

        config["configured"] = bool(config["host"])
        return config

    return config


def _create_client() -> Union[redis.Redis, Any]:
    global _USING_FAKE
    timeout = float(os.getenv("REDIS_TIMEOUT_SECONDS", "2.0"))
    env = os.getenv("ENV", "development").strip().lower()
    strict_security = env in ("staging", "production") or os.getenv("STRICT_REDIS_SECURITY", "").lower() in ("true", "1")

    cfg = _resolve_redis_connection_config()

    if cfg["configured"]:
        host = cfg["host"]
        port = cfg["port"]
        username = cfg["username"]
        password = cfg["password"]
        ssl = cfg["ssl"]
        db = cfg["db"]
        use_cluster = cfg["is_cluster"]

        # Safe diagnostic logging (never log secret passwords or keys)
        pw_indicator = f"present (len={len(password)})" if password else "absent"
        logger.info(
            "Initializing Redis connection to %s:%s [cluster=%s, ssl=%s, user=%s, auth=%s]",
            host,
            port,
            use_cluster,
            ssl,
            username,
            pw_indicator,
        )

        if use_cluster:
            try:
                from redis.cluster import RedisCluster
                client = RedisCluster(
                    host=host,
                    port=port,
                    username=username,
                    password=password,
                    ssl=ssl,
                    decode_responses=True,
                    socket_timeout=timeout,
                    socket_connect_timeout=timeout,
                )
                client.ping()
                _USING_FAKE = False
                logger.info("Connected to Redis Cluster at %s:%s (user=%s)", host, port, username)
                return client
            except Exception as cluster_exc:
                logger.warning(
                    "Failed to connect to Redis Cluster at %s:%s: %s. Attempting standalone client...",
                    host,
                    port,
                    cluster_exc,
                )

        try:
            client = redis.Redis(
                host=host,
                port=port,
                db=db,
                username=username,
                password=password,
                ssl=ssl,
                decode_responses=True,
                socket_timeout=timeout,
                socket_connect_timeout=timeout,
                retry_on_timeout=True,
            )
            client.ping()
            _USING_FAKE = False
            logger.info("Connected to distributed Redis server at %s:%s (user=%s)", host, port, username)
            return client
        except Exception as exc:
            logger.warning(
                "Failed to connect to Redis at %s:%s: %s.",
                host,
                port,
                exc,
            )
            if strict_security:
                logger.error("Fakeredis fallback is forbidden in %s environment. Redis is unavailable.", env)
                _USING_FAKE = False
                return client

    if strict_security:
        logger.error(
            "Redis configuration (REDIS_HOST/REDIS_PASSWORD or REDIS_URL) is required in %s environment. "
            "In-process fakeredis fallback is forbidden.",
            env,
        )
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
