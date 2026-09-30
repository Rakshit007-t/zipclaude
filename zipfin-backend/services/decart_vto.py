"""Decart Lucy Realtime AI VTO Service Provider for ZipRIGHT.

Handles server-side token minting, session lifecycle guards, upstream error
normalization, and provider isolation for Decart Lucy VTON (lucy-vton-3.5).
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

from fastapi import HTTPException, status
import httpx

from core.config import settings
from models.schema import DecartTokenResponse

logger = logging.getLogger(__name__)

# Model metadata configuration
DECART_MODEL_METADATA: dict[str, dict[str, Any]] = {
    "lucy-vton-3.5": {
        "fps": 30,
        "width": 1280,
        "height": 720,
        "supported_speeds": ["fast"],
        "url_path": "/v1/stream",
    }
}

# In-memory active session tracking to prevent duplicate parallel sessions per user
_active_sessions_lock = threading.Lock()
_active_sessions: dict[str, float] = {}


def is_decart_enabled() -> bool:
    """Check if Decart AI VTO feature is enabled."""
    return bool(settings.DECART_VTO_ENABLED)


def has_decart_credentials() -> bool:
    """Check if Decart API key is configured."""
    return bool(settings.DECART_API_KEY and settings.DECART_API_KEY.strip())


def get_model_metadata(model_name: str | None = None) -> dict[str, Any]:
    """Return dimensions, fps, and supported specs for the target model."""
    target_model = model_name or settings.DECART_VTO_MODEL
    return DECART_MODEL_METADATA.get(
        target_model,
        {"fps": 30, "width": 1280, "height": 720, "supported_speeds": ["fast"]},
    )


def register_active_session(user_id: str, duration_seconds: int) -> None:
    """Register or verify an active session for the user."""
    now = time.time()
    with _active_sessions_lock:
        # Clean up expired sessions first
        expired = [uid for uid, expiry in _active_sessions.items() if expiry <= now]
        for uid in expired:
            del _active_sessions[uid]

        existing_expiry = _active_sessions.get(user_id)
        if existing_expiry and existing_expiry > now:
            remaining = int(existing_expiry - now)
            logger.warning(
                "Duplicate AI session rejected for user_id=%s. Active session has %ss remaining.",
                user_id,
                remaining,
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "An active AI Live session is already running for this user.",
                    "details": {
                        "code": "session_already_active",
                        "remaining_seconds": remaining,
                    },
                },
            )

        # Mark active with duration + 5s network grace
        _active_sessions[user_id] = now + duration_seconds + 5.0


def release_decart_session(user_id: str) -> None:
    """Release active session slot when user disconnects or session ends."""
    with _active_sessions_lock:
        if user_id in _active_sessions:
            del _active_sessions[user_id]
            logger.info("Released Decart session slot for user_id=%s", user_id)


def _send_decart_token_request(
    endpoint: str,
    headers: dict[str, str],
    payload: dict[str, Any],
) -> httpx.Response:
    with httpx.Client(timeout=10.0) as client:
        return client.post(endpoint, headers=headers, json=payload)


def mint_decart_client_token(
    user_id: str,
    requested_duration: int | None = None,
) -> DecartTokenResponse:
    """Mint a short-lived Decart client token for the browser WebRTC session.

    Never exposes the permanent DECART_API_KEY to the client.
    Enforces feature flags, credentials presence, session concurrency, and error sanitization.
    """
    if not is_decart_enabled():
        logger.info("Decart VTO requested but DECART_VTO_ENABLED is false.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "message": "AI Live Try-On is currently disabled.",
                "details": {"code": "decart_vto_disabled"},
            },
        )

    if not has_decart_credentials():
        logger.error("Decart VTO requested but DECART_API_KEY is not configured.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "message": "Decart realtime VTO service is not configured.",
                "details": {"code": "decart_not_configured"},
            },
        )

    model = settings.DECART_VTO_MODEL
    max_session_seconds = min(
        requested_duration or settings.DECART_VTO_MAX_SESSION_SECONDS,
        settings.DECART_VTO_MAX_SESSION_SECONDS,
    )
    if max_session_seconds <= 0:
        max_session_seconds = 60

    # Enforce anti-duplication guard
    register_active_session(user_id, max_session_seconds)

    # Call Decart Client Tokens API
    endpoint = f"{settings.DECART_API_BASE_URL.rstrip('/')}/v1/client/tokens"
    headers = {
        "X-API-KEY": settings.DECART_API_KEY,
        "Content-Type": "application/json",
        "User-Agent": "ZipRIGHT-Backend/1.0",
    }
    payload = {
        "expiresIn": 120,
        "allowedModels": [model],
        "constraints": {
            "realtime": {
                "maxSessionDuration": max_session_seconds,
            }
        },
        "metadata": {
            "user_id": user_id,
            "provider": "zipright",
        },
    }

    try:
        resp = _send_decart_token_request(endpoint, headers, payload)
    except httpx.TimeoutException as exc:
        release_decart_session(user_id)
        logger.error("Decart API timeout while minting token for user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail={
                "message": "Upstream Decart service timed out.",
                "details": {"code": "decart_timeout"},
            },
        ) from exc
    except Exception as exc:
        release_decart_session(user_id)
        logger.exception("Decart API connection error for user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": "Unable to connect to Decart realtime service.",
                "details": {"code": "decart_connection_failed"},
            },
        ) from exc

    if resp.status_code == status.HTTP_200_OK or resp.status_code == status.HTTP_201_CREATED:
        data = resp.json()
        client_token = data.get("apiKey") or data.get("token")
        if not client_token:
            release_decart_session(user_id)
            logger.error("Decart response missing apiKey/token field.")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "message": "Malformed response from Decart service.",
                    "details": {"code": "decart_invalid_response"},
                },
            )

        expires_at = data.get("expiresAt")
        meta = get_model_metadata(model)

        logger.info(
            "Decart client token successfully minted for user_id=%s, model=%s, max_session=%ss",
            user_id,
            model,
            max_session_seconds,
        )

        return DecartTokenResponse(
            client_token=client_token,
            model=model,
            expires_at=str(expires_at) if expires_at else None,
            max_session_seconds=max_session_seconds,
            fps=meta.get("fps", 30),
            width=meta.get("width", 1280),
            height=meta.get("height", 720),
        )

    # Handle upstream errors without leaking secrets or raw provider internals
    release_decart_session(user_id)
    logger.error(
        "Decart API token mint failed with HTTP status %s for user_id=%s",
        resp.status_code,
        user_id,
    )

    if resp.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": "Decart upstream authorization error. Please check provider credentials.",
                "details": {"code": "decart_upstream_auth_error"},
            },
        )
    elif resp.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "message": "Decart realtime capacity limit reached. Please try again later.",
                "details": {"code": "decart_quota_exceeded"},
            },
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": "Failed to initialize Decart realtime session.",
                "details": {"code": "decart_upstream_failure", "upstream_status": resp.status_code},
            },
        )
