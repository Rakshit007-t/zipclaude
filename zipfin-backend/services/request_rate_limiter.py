from __future__ import annotations

import threading
import time
from collections import deque

from fastapi import HTTPException, status

_RATE_LIMIT_STATE: dict[str, deque[float]] = {}
_RATE_LIMIT_LOCK = threading.Lock()
_RATE_LIMIT_LAST_CLEANUP = 0.0
_RATE_LIMIT_CLEANUP_INTERVAL = 300  # 5 minutes
_RATE_LIMIT_KEY_MAX_AGE = 600  # 10 minutes — prune keys idle longer than this


def enforce_rate_limit(*, key: str, max_requests: int, window_seconds: int, detail: str) -> None:
    now = time.time()
    with _RATE_LIMIT_LOCK:
        _maybe_cleanup_stale_keys(now)
        bucket = _RATE_LIMIT_STATE.setdefault(key, deque())
        while bucket and now - bucket[0] > window_seconds:
            bucket.popleft()
        if len(bucket) >= max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "message": detail,
                    "details": {"code": "rate_limited", "key": key},
                },
                headers={"Retry-After": str(window_seconds)},
            )
        bucket.append(now)


def _maybe_cleanup_stale_keys(now: float) -> None:
    """Remove rate-limit keys that haven't been used for >10 minutes.

    Called inside the lock, gated to run at most once every 5 minutes.
    """
    global _RATE_LIMIT_LAST_CLEANUP
    if now - _RATE_LIMIT_LAST_CLEANUP < _RATE_LIMIT_CLEANUP_INTERVAL:
        return
    _RATE_LIMIT_LAST_CLEANUP = now
    stale_keys = [
        k for k, bucket in _RATE_LIMIT_STATE.items()
        if not bucket or now - bucket[-1] > _RATE_LIMIT_KEY_MAX_AGE
    ]
    for k in stale_keys:
        del _RATE_LIMIT_STATE[k]
