"""Provider-agnostic object storage for seller assets (logos, and later
product images / verification documents).

    Storage Service -> StorageProvider interface -> Firebase (current)
                                                  -> future: S3 / R2 / GCS / Azure

Seller routes depend only on the StorageProvider interface via
`get_storage_provider`, so swapping the backing store is an env change
(STORAGE_PROVIDER) plus one new subclass — no route, schema, or frontend
change. Every provider returns a plain URL string; callers never learn which
backend produced it.
"""

from __future__ import annotations

import logging
import os
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)

LOCAL_UPLOAD_DIR = Path("uploads")


class StorageProvider(ABC):
    @abstractmethod
    def upload_bytes(
        self,
        data: bytes,
        *,
        content_type: str,
        folder: str,
        extension: str,
    ) -> str:
        """Persist bytes and return a publicly reachable URL."""


class LocalStorageProvider(StorageProvider):
    """Writes under uploads/ (already mounted at /uploads by main.py).

    Serves as the dev/offline backend and as the resilient fallback when a
    cloud provider is misconfigured (e.g. the known Firebase Storage 403).
    """

    def __init__(self, directory: Path = LOCAL_UPLOAD_DIR, url_prefix: str = "/media/public") -> None:
        self._directory = directory
        self._url_prefix = url_prefix.rstrip("/")

    def upload_bytes(self, data: bytes, *, content_type: str, folder: str, extension: str) -> str:
        safe_folder = folder.strip().strip("/") or "misc"
        target_dir = self._directory / safe_folder
        target_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid.uuid4()}{extension}"
        (target_dir / filename).write_bytes(data)
        return f"{self._url_prefix}/{safe_folder}/{filename}"


class FirebaseStorageProvider(StorageProvider):
    """Firebase Storage, reusing the existing upload_to_firebase helper.

    On any upload failure it degrades to LocalStorageProvider — matching the
    resilience the try-on pipeline already relies on — so a storage outage
    never blocks a seller from saving a logo.
    """

    def __init__(
        self,
        uploader: Callable[..., str] | None = None,
        fallback: StorageProvider | None = None,
    ) -> None:
        self._uploader = uploader
        self._fallback = fallback or LocalStorageProvider()

    def upload_bytes(self, data: bytes, *, content_type: str, folder: str, extension: str) -> str:
        uploader = self._uploader
        if uploader is None:
            from firebase_upload import upload_to_firebase

            uploader = upload_to_firebase
        try:
            try:
                return uploader(
                    data,
                    folder=folder,
                    content_type=content_type,
                    file_extension=extension,
                    is_private=False,
                )
            except TypeError:
                return uploader(
                    data,
                    folder=folder,
                    content_type=content_type,
                    file_extension=extension,
                )
        except Exception as exc:
            logger.warning("Firebase storage failed; falling back to local. reason=%s", exc)
            return self._fallback.upload_bytes(
                data, content_type=content_type, folder=folder, extension=extension
            )


class AppwriteStorageProvider(StorageProvider):
    """Appwrite Storage provider with bucket-type segregation.

    Maps public catalog media, community posts, and private biometrics
    to their respective Appwrite buckets.
    """

    PUBLIC_FOLDERS = {"seller-logos", "seller-products", "products", "test"}
    COMMUNITY_FOLDERS = {"profiles", "banners", "looks", "dm"}

    def __init__(self, fallback: StorageProvider | None = None) -> None:
        self._fallback = fallback or LocalStorageProvider()

    def _resolve_bucket(self, folder: str) -> str:
        from appwrite_config import appwrite_settings
        clean_folder = folder.strip().strip("/").lower()
        if clean_folder in self.PUBLIC_FOLDERS:
            return appwrite_settings.BUCKET_PUBLIC
        if clean_folder in self.COMMUNITY_FOLDERS:
            return appwrite_settings.BUCKET_COMMUNITY
        return appwrite_settings.BUCKET_PRIVATE

    def upload_bytes(self, data: bytes, *, content_type: str, folder: str, extension: str) -> str:
        from appwrite.input_file import InputFile
        from appwrite_config import appwrite_settings, get_appwrite_storage

        bucket_id = self._resolve_bucket(folder)
        file_id = str(uuid.uuid4()).replace("-", "")[:32]
        filename = f"{file_id}{extension}"

        try:
            storage = get_appwrite_storage()
            input_file = InputFile.from_bytes(data, filename=filename, mime_type=content_type)
            result = storage.create_file(
                bucket_id=bucket_id,
                file_id=file_id,
                file=input_file,
            )
            created_id = getattr(result, "id", None) or getattr(result, "$id", None) or (result.get("$id", file_id) if isinstance(result, dict) else file_id)
            endpoint = appwrite_settings.ENDPOINT
            project_id = appwrite_settings.PROJECT_ID
            return f"{endpoint}/storage/buckets/{bucket_id}/files/{created_id}/view?project={project_id}"
        except Exception as exc:
            logger.warning("Appwrite storage upload failed; falling back to local. reason=%s", exc)
            return self._fallback.upload_bytes(
                data, content_type=content_type, folder=folder, extension=extension
            )

    def delete_file(self, bucket_id_or_folder: str, file_id: str | None = None) -> bool:
        from appwrite_config import get_appwrite_storage
        try:
            storage = get_appwrite_storage()
            if file_id is None:
                # If single argument provided like 'seller-logos/file_id' or bucket_id
                parts = bucket_id_or_folder.strip("/").split("/")
                if len(parts) >= 2:
                    bucket_id = self._resolve_bucket(parts[0])
                    target_file = parts[-1].split(".")[0]
                else:
                    bucket_id = self._resolve_bucket("test")
                    target_file = parts[0]
            else:
                bucket_id = self._resolve_bucket(bucket_id_or_folder)
                target_file = file_id.split(".")[0]

            storage.delete_file(bucket_id=bucket_id, file_id=target_file)
            return True
        except Exception as exc:
            logger.warning("Failed to delete Appwrite storage file: %s", exc)
            return False


def _build_provider() -> StorageProvider:
    provider = os.getenv("STORAGE_PROVIDER", "firebase").strip().lower()
    if provider == "local":
        return LocalStorageProvider()
    if provider == "appwrite":
        return AppwriteStorageProvider()
    # "firebase" (default) — extend here for s3 / r2 / gcs / azure.
    return FirebaseStorageProvider()


_PROVIDER: StorageProvider | None = None


def get_storage_provider() -> StorageProvider:
    """FastAPI dependency; override in tests via app.dependency_overrides."""
    global _PROVIDER
    if _PROVIDER is None:
        _PROVIDER = _build_provider()
    return _PROVIDER
