"""Protected and public media delivery routes.

Enforces:
1. Strict server-side authorization for private customer media.
2. Short-lived signed URL or Firebase token authentication.
3. Strict resource ownership: Customer A cannot access Customer B's media.
4. Zero admin bypass: Admin/seller roles cannot access raw biometric media.
5. Cache-Control: private, no-cache, no-store, must-revalidate.
6. Public asset segregation for seller logos and product imagery.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, Response

from services.firebase_auth import AuthenticatedUser, get_current_user, verify_firebase_token
from services.media_access import (
    validate_path_safety,
    verify_media_signature,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/media", tags=["media"])

UPLOAD_DIR = Path("uploads")
ALLOWED_PRIVATE_CATEGORIES = {"avatars", "tryons", "smartfit"}
ALLOWED_PUBLIC_CATEGORIES = {"seller-logos", "seller-products", "products", "misc"}

PRIVATE_CACHE_HEADERS = {
    "Cache-Control": "private, no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
}

PUBLIC_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
}


def get_media_user(request: Request) -> Optional[AuthenticatedUser]:
    """Extract and verify user from Authorization header or ?token query param."""
    if get_media_user in request.app.dependency_overrides:
        return request.app.dependency_overrides[get_media_user]()
    if get_current_user in request.app.dependency_overrides:
        return request.app.dependency_overrides[get_current_user]()

    authorization = request.headers.get("Authorization", "").strip()
    token = ""
    if authorization:
        scheme, _, token_val = authorization.partition(" ")
        if scheme.lower() == "bearer" and token_val.strip():
            token = token_val.strip()

    if not token:
        query_token = request.query_params.get("token", "").strip()
        if query_token:
            token = query_token

    if not token:
        return None

    return verify_firebase_token(token)


@router.get("/private/{category}/{user_id}/{filename}")
async def get_private_media(
    category: str,
    user_id: str,
    filename: str,
    request: Request,
    user: Optional[AuthenticatedUser] = Depends(get_media_user),
    expires: Optional[str] = Query(default=None),
    signature: Optional[str] = Query(default=None),
) -> Response:
    """Retrieve private customer media with server-authoritative ownership check."""
    # 1. Validate category
    category_normalized = category.strip().lower()
    if category_normalized not in ALLOWED_PRIVATE_CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid private media category '{category}'.",
        )

    # 2. Strict path safety & directory traversal protection
    validate_path_safety(user_id, filename)

    # 3. Authentication & Ownership Verification
    # Check HMAC signed URL first
    is_signed_authorized = False
    if expires and signature:
        try:
            expires_at = int(expires)
            if verify_media_signature(category_normalized, user_id, filename, expires_at, signature):
                is_signed_authorized = True
        except (ValueError, TypeError):
            is_signed_authorized = False

    if not is_signed_authorized:
        # Fall back to Firebase ID token verification
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required to access private media.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # STRICT OWNERSHIP CHECK: user can only access their own files
        # No admin bypass for raw customer biometric/photo media!
        if user.uid != user_id:
            logger.warning(
                "Cross-user private media access blocked: auth_uid=%s target_uid=%s file=%s/%s",
                user.uid,
                user_id,
                category_normalized,
                filename,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied. You do not have permission to view this media.",
            )

    # 4. Resolve file path securely
    private_base = (UPLOAD_DIR / "private" / category_normalized / user_id).resolve()
    target_path = (private_base / filename).resolve()

    # Prevent escaping private_base
    try:
        target_path.relative_to(private_base)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path traversal detected.",
        )

    if target_path.is_file():
        return FileResponse(path=target_path, headers=PRIVATE_CACHE_HEADERS)

    # Legacy local fallback resolution
    if category_normalized == "tryons":
        legacy_path = (UPLOAD_DIR / "tryons" / filename).resolve()
        try:
            legacy_path.relative_to((UPLOAD_DIR / "tryons").resolve())
            if legacy_path.is_file():
                return FileResponse(path=legacy_path, headers=PRIVATE_CACHE_HEADERS)
        except ValueError:
            pass

    if category_normalized == "avatars":
        legacy_path = (UPLOAD_DIR / filename).resolve()
        try:
            legacy_path.relative_to(UPLOAD_DIR.resolve())
            if legacy_path.is_file():
                return FileResponse(path=legacy_path, headers=PRIVATE_CACHE_HEADERS)
        except ValueError:
            pass

    # Fallback to Firebase Storage if available
    try:
        from firebase_config import get_storage_bucket

        bucket = get_storage_bucket()
        blob_path = f"users/{user_id}/{category_normalized}/{filename}"
        blob = bucket.blob(blob_path)
        if blob.exists():
            content = blob.download_as_bytes()
            content_type = blob.content_type or "image/png"
            return Response(content=content, media_type=content_type, headers=PRIVATE_CACHE_HEADERS)
    except Exception as exc:
        logger.debug("Firebase Storage resolution fallback skipped or failed: %s", exc)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Requested media was not found.",
    )


@router.get("/public/{category}/{filename}")
async def get_public_media(category: str, filename: str) -> Response:
    """Retrieve public assets (seller logos, product images)."""
    category_normalized = category.strip().lower()
    if category_normalized not in ALLOWED_PUBLIC_CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid public media category '{category}'.",
        )

    # Path traversal validation
    validate_path_safety("public", filename)

    upload_root = UPLOAD_DIR.resolve()
    # Check public folder first, then direct folder
    candidates = [
        (upload_root / "public" / category_normalized / filename).resolve(),
        (upload_root / category_normalized / filename).resolve(),
    ]

    for candidate in candidates:
        try:
            candidate.relative_to(upload_root)
            if candidate.is_file():
                return FileResponse(path=candidate, headers=PUBLIC_CACHE_HEADERS)
        except ValueError:
            continue

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Public media not found.",
    )
