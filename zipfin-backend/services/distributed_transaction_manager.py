"""Distributed Transaction & Concurrency Manager for ZipRIGHT.

Provides ACID-like isolation and concurrency control for multi-document operations
(such as wallet debits, try-on quota consumption, and idempotent refund sentinels)
across both Cloud Firestore and Appwrite Databases.
"""

from __future__ import annotations

import contextlib
import logging
import threading
import time
import uuid
from typing import Any, Callable, Generator, Optional

logger = logging.getLogger(__name__)

# Fallback local in-memory lock table for test / offline / single-process environments
_LOCAL_LOCKS: dict[str, threading.Lock] = {}
_LOCAL_LOCKS_MUTEX = threading.Lock()


def _get_local_lock(key: str) -> threading.Lock:
    with _LOCAL_LOCKS_MUTEX:
        if key not in _LOCAL_LOCKS:
            _LOCAL_LOCKS[key] = threading.Lock()
        return _LOCAL_LOCKS[key]


class DistributedTransactionManager:
    """Coordinates distributed locking across Redis with graceful in-memory fallback."""

    def __init__(self, lock_timeout_seconds: float = 10.0, retry_delay: float = 0.05) -> None:
        self.lock_timeout_seconds = lock_timeout_seconds
        self.retry_delay = retry_delay
        self._redis_client = None
        self._redis_checked = False

    def _get_redis(self):
        if not self._redis_checked:
            try:
                from core.redis_client import get_redis_client
                client = get_redis_client()
                if client is not None:
                    client.ping()
                    self._redis_client = client
            except Exception:
                self._redis_client = None
            self._redis_checked = True
        return self._redis_client

    @contextlib.contextmanager
    def acquire_lock(self, resource_key: str) -> Generator[str, None, None]:
        """Acquire an exclusive distributed lock on resource_key."""
        token = str(uuid.uuid4())
        redis_client = self._get_redis()
        lock_name = f"lock:{resource_key}"

        if redis_client is not None:
            # Distributed Redis Lock with auto-expiry
            timeout_ms = int(self.lock_timeout_seconds * 1000)
            deadline = time.time() + self.lock_timeout_seconds
            acquired = False

            while time.time() < deadline:
                # SET key token NX PX timeout_ms
                if redis_client.set(lock_name, token, nx=True, px=timeout_ms):
                    acquired = True
                    break
                time.sleep(self.retry_delay)

            if not acquired:
                raise TimeoutError(f"Failed to acquire distributed lock on {resource_key} within {self.lock_timeout_seconds}s")

            try:
                yield token
            finally:
                # Atomic unlock using Lua script to prevent releasing another worker's lock
                lua_unlock = """
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end
                """
                try:
                    redis_client.eval(lua_unlock, 1, lock_name, token)
                except Exception as exc:
                    try:
                        val = redis_client.get(lock_name)
                        if val == token or (isinstance(val, bytes) and val.decode() == token):
                            redis_client.delete(lock_name)
                    except Exception:
                        logger.warning("Error releasing Redis lock %s: %s", lock_name, exc)
        else:
            # In-memory fallback
            lock = _get_local_lock(resource_key)
            acquired = lock.acquire(timeout=self.lock_timeout_seconds)
            if not acquired:
                raise TimeoutError(f"Failed to acquire in-memory lock on {resource_key} within {self.lock_timeout_seconds}s")
            try:
                yield token
            finally:
                lock.release()

    def run_in_transaction(self, resource_key: str, operation: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        """Execute a callable inside an exclusive locked boundary."""
        with self.acquire_lock(resource_key):
            return operation(*args, **kwargs)


_TX_MANAGER: Optional[DistributedTransactionManager] = None


def get_transaction_manager() -> DistributedTransactionManager:
    global _TX_MANAGER
    if _TX_MANAGER is None:
        _TX_MANAGER = DistributedTransactionManager()
    return _TX_MANAGER
