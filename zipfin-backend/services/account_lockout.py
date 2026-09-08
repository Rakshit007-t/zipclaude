"""Account lockout and brute-force protection service.

Tracks consecutive failed authentication attempts per account identifier (email/phone)
and per source IP address. Enforces temporary account lockout to prevent credential stuffing.
"""

from __future__ import annotations

import collections
from datetime import datetime, timezone
import logging
import threading
from fastapi import HTTPException, status

from core.security_logger import log_security_event

logger = logging.getLogger(__name__)

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION_SECONDS = 900  # 15 minutes
ATTEMPT_WINDOW_SECONDS = 900    # 15 minutes

_lock = threading.Lock()
# email/identifier -> list of failure timestamps
_failed_attempts: dict[str, collections.deque[float]] = {}
# email/identifier -> lockout expiration timestamp
_locked_accounts: dict[str, float] = {}


def _normalize_key(identifier: str) -> str:
    return identifier.strip().lower()


def check_account_locked(identifier: str, ip_address: str = "unknown") -> None:
    """Raise HTTP 423 Locked if the account is currently locked out."""
    key = _normalize_key(identifier)
    now = datetime.now(timezone.utc).timestamp()

    with _lock:
        unlock_time = _locked_accounts.get(key)
        if unlock_time:
            if now < unlock_time:
                remaining_seconds = int(unlock_time - now)
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
                _locked_accounts.pop(key, None)
                _failed_attempts.pop(key, None)


def record_failed_attempt(identifier: str, ip_address: str = "unknown") -> None:
    """Record a failed login attempt and lock the account if threshold is reached."""
    key = _normalize_key(identifier)
    now = datetime.now(timezone.utc).timestamp()

    with _lock:
        attempts = _failed_attempts.setdefault(key, collections.deque())
        # Prune attempts outside the window
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
    """Reset failed attempts on successful login."""
    key = _normalize_key(identifier)
    with _lock:
        _failed_attempts.pop(key, None)
        _locked_accounts.pop(key, None)
