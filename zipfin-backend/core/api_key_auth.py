import logging

import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException, Request, status
from firebase_admin import firestore

from firebase_config import get_firestore_client
from services.developer_service import KEYS_COLLECTION, verify_api_key_hash

logger = logging.getLogger(__name__)

# Simple in-memory sliding window rate limiter: key_id -> list of timestamps
_RATE_LIMIT_WINDOW_SECONDS = 60
_RATE_LIMIT_MAX_REQUESTS = 100
_request_timestamps: dict[str, list[float]] = defaultdict(list)


@dataclass
class AuthenticatedApiKey:
    key_id: str
    user_id: str
    name: str
    environment: str


def _check_rate_limit(key_id: str) -> None:
    now = time.time()
    cutoff = now - _RATE_LIMIT_WINDOW_SECONDS

    # Clean old entries
    timestamps = [t for t in _request_timestamps[key_id] if t > cutoff]
    timestamps.append(now)
    _request_timestamps[key_id] = timestamps

    if len(timestamps) > _RATE_LIMIT_MAX_REQUESTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "message": f"Rate limit exceeded. Maximum {_RATE_LIMIT_MAX_REQUESTS} requests per minute allowed.",
                "details": {"code": "rate_limit_exceeded"},
            },
            headers={"Retry-After": "60"},
        )


def _update_key_usage_async(key_id: str) -> None:
    """Update last_used_at and increment usage_count in Firestore."""
    try:
        db = get_firestore_client()
        now_iso = datetime.now(timezone.utc).isoformat()
        db.collection(KEYS_COLLECTION).document(key_id).update(
            {
                "last_used_at": now_iso,
                "usage_count": firestore.Increment(1),
            }
        )
    except Exception as exc:
        logger.warning(f"Failed to update usage count for API key {key_id}: {exc}")


async def verify_api_key(request: Request) -> AuthenticatedApiKey:
    """FastAPI Dependency for authenticating Public API requests with an API Key."""

    # 1. Extract API Key from header: X-API-Key or Authorization: Bearer zr_...
    raw_key = request.headers.get("X-API-Key", "").strip()
    if not raw_key:
        auth_header = request.headers.get("Authorization", "").strip()
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
            if token.startswith("zr_"):
                raw_key = token

    if not raw_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "message": "API key required. Pass 'X-API-Key' header or 'Authorization: Bearer zr_...' token.",
                "details": {"code": "api_key_required"},
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not (raw_key.startswith("zr_test_") or raw_key.startswith("zr_live_")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "message": "Invalid API key format. Key must start with 'zr_test_' or 'zr_live_'.",
                "details": {"code": "invalid_key_format"},
            },
        )

    lookup_prefix = raw_key[:16]
    db = get_firestore_client()

    try:
        # 2. Fast O(1) query by lookup_prefix
        docs = (
            db.collection(KEYS_COLLECTION)
            .where(filter=firestore.FieldFilter("lookup_prefix", "==", lookup_prefix))
            .where(filter=firestore.FieldFilter("status", "==", "active"))
            .get()
        )

        matching_doc = None
        for doc in docs:
            data = doc.to_dict()
            stored_hash = data.get("hashed_key", "")
            if verify_api_key_hash(raw_key, stored_hash):
                matching_doc = data
                break

        if not matching_doc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "message": "Invalid or revoked API key.",
                    "details": {"code": "invalid_api_key"},
                },
            )

        key_id = matching_doc.get("id", "")
        user_id = matching_doc.get("user_id", "")
        name = matching_doc.get("name", "API Key")
        environment = matching_doc.get("environment", "test")

        # 3. Rate limiting check
        _check_rate_limit(key_id)

        # 4. Update usage stats asynchronously
        _update_key_usage_async(key_id)

        # 5. Store on request state
        authenticated_key = AuthenticatedApiKey(
            key_id=key_id,
            user_id=user_id,
            name=name,
            environment=environment,
        )
        request.state.api_key = authenticated_key
        return authenticated_key

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error during API key authentication.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to authenticate API key.",
        ) from exc
