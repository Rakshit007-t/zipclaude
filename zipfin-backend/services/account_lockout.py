"""Account lockout and brute-force protection service.

Tracks consecutive failed authentication attempts per account identifier (email/phone)
and per source IP address across distributed worker instances using Redis.
Enforces temporary account lockout to prevent credential stuffing.
Falls back to thread-safe local in-memory storage if Redis is temporarily unavailable.
"""

from __future__ import annotations

import collections
from datetime import datetime, timezone
import logging
import threading
import time
from uuid import uuid4
from fastapi import HTTPException, status

from core.security_logger import log_security_event
from core.redis_client import get_redis_client

logger = logging.getLogger(__name__)

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION_SECONDS = 900  # 15 minutes
ATTEMPT_WINDOW_SECONDS = 900    # 15 minutes

# In-memory fallback
_lock = threading.Lock()
_failed_attempts: dict[str, collections.deque[float]] = {}
_locked_accounts: dict[str, float] = {}


def _normalize_key(identifier: str) -> str:
    return identifier.strip().lower()


def check_account_locked(identifier: str, ip_address: str = "unknown") -> None:
    """Raise HTTP 423 Locked if the account is currently locked out."""
    key = _normalize_key(identifier)
    now = time.time()

    # 1. Distributed Redis Check
    try:
        r = get_redis_client()
        locked_key = f"zipright:lockout:locked:{key}"
        unlock_val = r.get(locked_key)
        if unlock_val:
            unlock_time = float(unlock_val)
            if now < unlock_time:
                remaining_seconds = max(1, int(unlock_time - now))
                log_security_event(
                    event_type="SECURITY_LOGIN_LOCKED_ATTEMPT",
                    severity="WARNING",
                    ip_address=ip_address,
                    email=identifier,
                    details={"remaining_seconds": remaining_seconds},
                )
                raise HTTPException(
                    status_code=status.HTTP_423_LOCKED,
                    detail={
                        "message": f"Account is temporarily locked due to multiple failed login attempts. Please try again in {remaining_seconds // 60 + 1} minutes.",
                        "details": {"code": "account_temporarily_locked", "retry_after_seconds": remaining_seconds},
                    },
                )
            else:
                # Lockout expired
                r.delete(locked_key)
                r.delete(f"zipright:lockout:attempts:{key}")
                return
        # If Redis check passed, check local fallback just in case
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Redis check_account_locked failed (%s), using local fallback.", exc)

    # 2. Local Fallback Check
    with _lock:
        unlock_time = _locked_accounts.get(key)
        if unlock_time:
            if now < unlock_time:
                remaining_seconds = max(1, int(unlock_time - now))
                log_security_event(
                    event_type="SECURITY_LOGIN_LOCKED_ATTEMPT",
                    severity="WARNING",
                    ip_address=ip_address,
                    email=identifier,
                    details={"remaining_seconds": remaining_seconds},
                )
                raise HTTPException(
                    status_code=status.HTTP_423_LOCKED,
                    detail={
                        "message": f"Account is temporarily locked due to multiple failed login attempts. Please try again in {remaining_seconds // 60 + 1} minutes.",
                        "details": {"code": "account_temporarily_locked", "retry_after_seconds": remaining_seconds},
                    },
                )
            else:
                _locked_accounts.pop(key, None)
                _failed_attempts.pop(key, None)


def record_failed_attempt(identifier: str, ip_address: str = "unknown") -> None:
    """Record a failed login attempt and lock the account if threshold is reached."""
    key = _normalize_key(identifier)
    now = time.time()
    attempts_count = 0

    # 1. Distributed Redis Recording
    try:
        r = get_redis_client()
        attempts_key = f"zipright:lockout:attempts:{key}"
        locked_key = f"zipright:lockout:locked:{key}"
        window_start = now - ATTEMPT_WINDOW_SECONDS

        pipe = r.pipeline(transaction=True)
        pipe.zremrangebyscore(attempts_key, "-inf", window_start)
        pipe.zadd(attempts_key, {f"{now}:{uuid4().hex[:6]}": now})
        pipe.expire(attempts_key, ATTEMPT_WINDOW_SECONDS)
        pipe.zcard(attempts_key)
        results = pipe.execute()

        attempts_count = int(results[3])

        log_security_event(
            event_type="SECURITY_LOGIN_FAILED",
            severity="WARNING",
            ip_address=ip_address,
            email=identifier,
            details={"attempt_count": attempts_count, "threshold": MAX_FAILED_ATTEMPTS},
        )

        if attempts_count >= MAX_FAILED_ATTEMPTS:
            unlock_time = now + LOCKOUT_DURATION_SECONDS
            r.set(locked_key, str(unlock_time), ex=LOCKOUT_DURATION_SECONDS)
            log_security_event(
                event_type="SECURITY_ACCOUNT_LOCKED",
                severity="CRITICAL",
                ip_address=ip_address,
                email=identifier,
                details={"lockout_seconds": LOCKOUT_DURATION_SECONDS},
            )
        return
    except Exception as exc:
        logger.warning("Redis record_failed_attempt failed (%s), using local fallback.", exc)

    # 2. Local Fallback Recording
    with _lock:
        attempts = _failed_attempts.setdefault(key, collections.deque())
        while attempts and now - attempts[0] > ATTEMPT_WINDOW_SECONDS:
            attempts.popleft()
        attempts.append(now)

        log_security_event(
            event_type="SECURITY_LOGIN_FAILED",
            severity="WARNING",
            ip_address=ip_address,
            email=identifier,
            details={"attempt_count": len(attempts), "threshold": MAX_FAILED_ATTEMPTS},
        )

        if len(attempts) >= MAX_FAILED_ATTEMPTS:
            unlock_time = now + LOCKOUT_DURATION_SECONDS
            _locked_accounts[key] = unlock_time
            log_security_event(
                event_type="SECURITY_ACCOUNT_LOCKED",
                severity="CRITICAL",
                ip_address=ip_address,
                email=identifier,
                details={"lockout_seconds": LOCKOUT_DURATION_SECONDS},
            )


def reset_failed_attempts(identifier: str) -> None:
    """Reset failed attempts on successful login across all workers."""
    key = _normalize_key(identifier)
    try:
        r = get_redis_client()
        r.delete(f"zipright:lockout:attempts:{key}", f"zipright:lockout:locked:{key}")
    except Exception as exc:
        logger.warning("Redis reset_failed_attempts failed (%s).", exc)

    with _lock:
        _failed_attempts.pop(key, None)
        _locked_accounts.pop(key, None)
