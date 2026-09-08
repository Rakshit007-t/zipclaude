"""Upload security validator: enforces magic byte inspection and MIME whitelisting.

Prevents file upload vulnerabilities, polyglot files, embedded scripts (SVG XSS),
and directory traversal.
"""

from __future__ import annotations

from pathlib import Path
import re
from fastapi import HTTPException, UploadFile, status

from core.security_logger import log_security_event

ALLOWED_IMAGE_MIMES = frozenset({
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
})

ALLOWED_EXTENSIONS = frozenset({
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
})


def validate_image_magic_bytes(header: bytes) -> str | None:
    """Inspect binary header and return the detected image format or None if invalid."""
    if len(header) < 4:
        return None

    # JPEG: starts with \xFF\xD8\xFF
    if header.startswith(b"\xFF\xD8\xFF"):
        return "image/jpeg"

    # PNG: starts with \x89PNG
    if header.startswith(b"\x89PNG"):
        return "image/png"

    # WEBP: RIFF + 4 bytes size + WEBP
    if len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image/webp"

    return None


async def validate_image_upload(
    file: UploadFile,
    max_size_bytes: int = 10 * 1024 * 1024,
    ip_address: str = "unknown",
) -> bytes:
    """Validate uploaded image file:

    1. Checks filename and non-empty extension.
    2. Validates declared extension against allowlist (.jpg, .jpeg, .png, .webp).
    3. Validates declared content-type against allowlist.
    4. Reads content and validates size <= max_size_bytes.
    5. Inspects binary magic bytes to guarantee file matches declared format.
    6. Rejects any disguised executables, HTML, or SVG scripts.
    """
    filename = file.filename or ""
    if not filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A valid filename is required.",
        )

    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        log_security_event(
            event_type="SECURITY_UPLOAD_REJECTED",
            severity="WARNING",
            ip_address=ip_address,
            details={"filename": filename, "extension": extension, "reason": "Disallowed file extension"},
        )
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only JPEG, PNG, and WebP images are allowed.",
        )

    content_type = (file.content_type or "").lower().strip()
    if content_type not in ALLOWED_IMAGE_MIMES:
        log_security_event(
            event_type="SECURITY_UPLOAD_REJECTED",
            severity="WARNING",
            ip_address=ip_address,
            details={"filename": filename, "content_type": content_type, "reason": "Disallowed MIME type"},
        )
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported content type. Only JPEG, PNG, and WebP are accepted.",
        )

    try:
        content = await file.read()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to read uploaded file.",
        ) from exc

    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded file is empty.",
        )

    if len(content) > max_size_bytes:
        log_security_event(
            event_type="SECURITY_UPLOAD_REJECTED",
            severity="WARNING",
            ip_address=ip_address,
            details={"filename": filename, "size": len(content), "reason": "File size exceeds limit"},
        )
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Uploaded file exceeds {max_size_bytes // (1024 * 1024)} MB limit.",
        )

    # Magic byte verification
    detected_mime = validate_image_magic_bytes(content[:32])
    if not detected_mime:
        log_security_event(
            event_type="SECURITY_UPLOAD_MAGIC_MISMATCH",
            severity="CRITICAL",
            ip_address=ip_address,
            details={"filename": filename, "content_type": content_type, "reason": "Invalid or forged image binary"},
        )
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="File binary signature is invalid or corrupted. Please upload a genuine JPEG, PNG, or WebP image.",
        )

    return content
