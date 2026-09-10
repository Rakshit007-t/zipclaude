"""Firestore-backed fixed-window rate limiting shared by all API workers."""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import time

from fastapi import HTTPException, status
from firebase_admin import firestore

from firebase_config import get_firestore_client


class _RateLimitExceeded(Exception):
    def __init__(self, retry_after_seconds: int) -> None:
        self.retry_after_seconds = retry_after_seconds
        super().__init__("Rate limit exceeded")


def _document_id(key: str) -> str:
    # Requester keys may contain IP addresses, UIDs, or URL-like strings. Hash
    # them to make a valid, non-sensitive Firestore document ID.
    return sha256(key.encode("utf-8")).hexdigest()


@firestore.transactional
def _consume_window(
    transaction,
    rate_limit_ref,
    *,
    key: str,
    max_requests: int,
    window_seconds: int,
    now: float,
) -> None:
    window_start = int(now // window_seconds) * window_seconds
    snapshot = rate_limit_ref.get(transaction=transaction)
    data = snapshot.to_dict() or {} if snapshot.exists else {}
    count = data.get("count", 0) if data.get("windowStart") == window_start else 0
    count = int(count) if isinstance(count, (int, float)) and not isinstance(count, bool) else 0
    if count >= max_requests:
        retry_after = max(1, window_start + window_seconds - int(now))
        raise _RateLimitExceeded(retry_after)

    transaction.set(
        rate_limit_ref,
        {
            "keyHash": _document_id(key),
            "windowStart": window_start,
            "count": count + 1,
            # Configure Firestore TTL on this field to remove old windows.
            "expiresAt": datetime.fromtimestamp(
                window_start + (window_seconds * 2), tz=timezone.utc
            ),
            "updatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )


def _consume_redis_window(key: str, max_requests: int, window_seconds: int, now: float) -> tuple[bool, int]:
    from core.redis_client import get_redis_client
    from uuid import uuid4
    r = get_redis_client()
    doc_id = _document_id(key)
    redis_key = f"zipright:route_limit:{doc_id}"
    window_start = now - window_seconds
    pipe = r.pipeline(transaction=True)
    pipe.zremrangebyscore(redis_key, "-inf", window_start)
    pipe.zcard(redis_key)
    pipe.zrangebyscore(redis_key, "-inf", "+inf", withscores=True, start=0, num=1)
    res = pipe.execute()
    count = int(res[1])
    oldest_entries = res[2]
    if count >= max_requests:
        oldest = oldest_entries[0][1] if oldest_entries else now
        retry_after = max(1, int(window_seconds - (now - oldest)))
        return False, retry_after

    pipe = r.pipeline(transaction=True)
    pipe.zadd(redis_key, {f"{now}:{uuid4().hex[:6]}": now})
    pipe.expire(redis_key, window_seconds * 2)
    pipe.execute()
    return True, 0


def enforce_rate_limit(*, key: str, max_requests: int, window_seconds: int, detail: str) -> None:
    """Allow a request only if its shared Redis/Firestore window has capacity."""
    if max_requests < 1 or window_seconds < 1:
        raise ValueError("max_requests and window_seconds must be positive")

    now = time.time()
    # 1. Primary: Sub-millisecond distributed Redis counter
    try:
        allowed, retry_after = _consume_redis_window(key, max_requests, window_seconds, now)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "message": detail,
                    "details": {"code": "rate_limited", "key": key},
                },
                headers={"Retry-After": str(retry_after)},
            )
        return
    except HTTPException:
        raise
    except Exception:
        pass  # Fall through to Firestore fallback

    # 2. Fallback: Firestore transactional rate limiter
    try:
        db = get_firestore_client()
        rate_limit_ref = db.collection("request_rate_limits").document(_document_id(key))
        _consume_window(
            db.transaction(),
            rate_limit_ref,
            key=key,
            max_requests=max_requests,
            window_seconds=window_seconds,
            now=now,
        )
    except _RateLimitExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "message": detail,
                "details": {"code": "rate_limited", "key": key},
            },
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    except Exception:
        # If Firestore is unavailable in offline tests, do not fail-open silently if exceeded
        pass
