"""Firebase Storage upload helper with private vs. public asset separation.

Phase 1B hardening:
- Private customer media (try-on results, avatars, biometric data) does NOT
  use permanent public download tokens or 1-year public CDN caching.
- Private media uses short-lived signed URLs or authenticated media routes with
  'private, no-cache, no-store, must-revalidate' cache headers.
- Public catalog assets (seller logos, product images) remain public with safe caching.
"""

from __future__ import annotations

import datetime
import logging
import uuid
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from firebase_config import get_storage_bucket, get_storage_bucket_name

logger = logging.getLogger(__name__)

PUBLIC_FOLDERS = {"seller-logos", "seller-products", "products", "test"}


class FirebaseUploadError(RuntimeError):
    """Raised when upload to Firebase Storage fails."""


def upload_to_firebase(
    image_bytes: bytes,
    *,
    folder: str = "tryons",
    content_type: str = "image/png",
    file_extension: str = ".png",
    user_id: Optional[str] = None,
    is_private: Optional[bool] = None,
) -> str:
    """Upload image bytes to Firebase Storage.

    For private customer media:
    - Stored under users/{user_id}/{folder}/
    - Strictly private cache-control: no-cache, no-store, must-revalidate
    - No permanent download tokens
    - Returns a short-lived signed URL or proxy URL

    For public assets (seller logos, products):
    - Stored under public/{folder}/
    - Public cache-control
    """
    if not isinstance(image_bytes, (bytes, bytearray)) or not image_bytes:
        raise ValueError("image_bytes must be non-empty bytes.")
    folder_clean = folder.strip().strip("/")
    if not folder_clean:
        raise ValueError("folder must be a non-empty string.")

    # Determine privacy: explicit flag wins, otherwise infer from folder
    if is_private is None:
        is_private = folder_clean.lower() not in PUBLIC_FOLDERS

    try:
        bucket = get_storage_bucket()
        unique_id = uuid.uuid4()

        if is_private:
            safe_uid = (user_id or "").strip() or "anonymous"
            blob_name = f"users/{safe_uid}/{folder_clean}/{unique_id}{file_extension}"
            blob = bucket.blob(blob_name)
            blob.cache_control = "private, no-cache, no-store, must-revalidate"
            blob.upload_from_string(image_bytes, content_type=content_type)

            # Generate short-lived signed access URL (15 minutes)
            try:
                signed_url = blob.generate_signed_url(
                    version="v4",
                    expiration=datetime.timedelta(minutes=15),
                    method="GET",
                )
                return str(signed_url)
            except Exception as sign_exc:
                logger.debug(
                    "Cloud signed URL generation unavailable (offline/local creds): %s; using media route.",
                    sign_exc,
                )
                from services.media_access import create_signed_media_url

                leaf_name = f"{unique_id}{file_extension}"
                return create_signed_media_url(folder_clean, safe_uid, leaf_name)

        else:
            # Public catalog/seller media
            blob_name = f"{folder_clean}/{unique_id}{file_extension}"
            blob = bucket.blob(blob_name)
            download_token = str(uuid.uuid4())
            blob.cache_control = "public, max-age=86400"
            blob.upload_from_string(image_bytes, content_type=content_type)
            blob.metadata = {
                **(blob.metadata or {}),
                "firebaseStorageDownloadTokens": download_token,
            }
            blob.patch()
            return _build_download_url(blob.name, download_token)

    except (FileNotFoundError, RuntimeError, ValueError):
        raise
    except Exception as exc:
        raise FirebaseUploadError(
            f"Failed to upload image to Firebase Storage: {exc}"
        ) from exc


def _build_download_url(blob_name: str, download_token: str) -> str:
    encoded_blob_name = quote(blob_name, safe="")
    bucket_name = get_storage_bucket_name()
    return (
        f"https://firebasestorage.googleapis.com/v0/b/{bucket_name}/o/"
        f"{encoded_blob_name}?alt=media&token={download_token}"
    )
