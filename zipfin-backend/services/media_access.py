"""Cryptographic signing and validation service for private customer media.

Implements short-lived HMAC-SHA256 signed access URLs and strict path traversal
defenses for customer private media (avatars, try-ons, and scans).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import time
from pathlib import Path
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

# Regular expressions for safe identifiers
_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_SAFE_FILENAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")

# Default expiration for signed media access: 15 minutes
DEFAULT_MEDIA_EXPIRATION_SECONDS = 900


def get_signing_secret() -> bytes:
    """Resolve the secret key for HMAC media URL signing."""
    secret = (
        os.getenv("MEDIA_SIGNING_SECRET", "").strip()
        or os.getenv("SECRET_KEY", "").strip()
        or "zipright-private-media-hmac-key-v1"
    )
    return secret.encode("utf-8")


def validate_path_safety(user_id: str, filename: str) -> None:
    """Validate that user_id and filename do not contain traversal or unsafe characters."""
    if not user_id or not _SAFE_ID_RE.match(user_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid user identifier.",
        )
    if not filename or not _SAFE_FILENAME_RE.match(filename) or ".." in filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid filename.",
        )


def generate_media_signature(
    category: str,
    user_id: str,
    filename: str,
    expires_at: int,
) -> str:
    """Generate an HMAC-SHA256 signature for a private media item."""
    secret = get_signing_secret()
    payload = f"{category.strip()}:{user_id.strip()}:{filename.strip()}:{expires_at}".encode(
        "utf-8"
    )
    return hmac.new(secret, payload, hashlib.sha256).hexdigest()


def verify_media_signature(
    category: str,
    user_id: str,
    filename: str,
    expires_at: int,
    signature: str,
) -> bool:
    """Verify HMAC signature and check that the URL has not expired."""
    if not signature or not isinstance(signature, str):
        return False

    current_time = int(time.time())
    if current_time > expires_at:
        logger.debug(
            "Media signature expired: current=%d expires_at=%d",
            current_time,
            expires_at,
        )
        return False

    expected_sig = generate_media_signature(category, user_id, filename, expires_at)
    return hmac.compare_digest(expected_sig, signature)


def create_signed_media_url(
    category: str,
    user_id: str,
    filename: str,
    expires_in_seconds: int = DEFAULT_MEDIA_EXPIRATION_SECONDS,
) -> str:
    """Create a short-lived signed access URL for private media."""
    validate_path_safety(user_id, filename)
    expires_at = int(time.time()) + expires_in_seconds
    signature = generate_media_signature(category, user_id, filename, expires_at)
    return f"/media/private/{category}/{user_id}/{filename}?expires={expires_at}&signature={signature}"
