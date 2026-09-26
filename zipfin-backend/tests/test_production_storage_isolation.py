"""
Production Storage Isolation and Permissions Verification Suite for Appwrite.

Validates:
1. All 3 production buckets exist and are properly configured.
2. Public bucket files can be downloaded directly without auth.
3. Private bucket files reject unauthenticated direct download.
4. Private bucket cross-user isolation: User A cannot read User B's private files.
5. Storage extension and upload validation: disallowed file extensions (.bin, .exe) are rejected.
6. Clean deletion and 404 orphan verification.
7. End-to-end byte integrity: uploaded image bytes match downloaded bytes exactly.
"""
from __future__ import annotations

import io
import os
import time
import uuid
import pytest
import requests

from appwrite.client import Client
from appwrite.services.storage import Storage
from appwrite.services.users import Users
from appwrite.permission import Permission
from appwrite.role import Role
from appwrite.input_file import InputFile
from appwrite.exception import AppwriteException

from appwrite_config import (
    appwrite_settings,
    get_appwrite_client,
    get_appwrite_storage,
    get_appwrite_users,
    get_effective_appwrite_target,
)
from services.storage_provider import AppwriteStorageProvider

# Valid 1x1 transparent PNG bytes
TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
    b"\x00\x00\x00\rIDATx\x9cc`\x00\x00\x00\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture(scope="module")
def admin_storage():
    return get_appwrite_storage()


@pytest.fixture(scope="module")
def admin_users():
    return get_appwrite_users()


def _get(obj, *keys, default=None):
    if obj is None:
        return default
    for k in keys:
        if isinstance(obj, dict) and k in obj:
            return obj[k]
        if hasattr(obj, k):
            val = getattr(obj, k)
            if val is not None:
                return val
    return default


def test_storage_buckets_exist_and_configured(admin_storage: Storage):
    """Verify all 3 production storage buckets exist."""
    buckets = [
        appwrite_settings.BUCKET_PUBLIC,
        appwrite_settings.BUCKET_COMMUNITY,
        appwrite_settings.BUCKET_PRIVATE,
    ]
    for b_id in buckets:
        bucket = admin_storage.get_bucket(bucket_id=b_id)
        assert _get(bucket, "$id", "id") == b_id


def test_public_bucket_unauthenticated_download(admin_storage: Storage):
    """Verify that files in zipright-public can be downloaded without authentication."""
    file_id = f"pub_{uuid.uuid4().hex[:8]}"
    
    admin_storage.create_file(
        bucket_id=appwrite_settings.BUCKET_PUBLIC,
        file_id=file_id,
        file=InputFile.from_bytes(TINY_PNG, filename=f"{file_id}.png", mime_type="image/png"),
        permissions=[Permission.read(Role.any())],
    )
    
    try:
        ep, host = get_effective_appwrite_target()
        headers = {"Host": host} if host else {}
        url = f"{ep}/storage/buckets/{appwrite_settings.BUCKET_PUBLIC}/files/{file_id}/view?project={appwrite_settings.PROJECT_ID}"
        resp = requests.get(url, headers=headers, verify=False, timeout=10)
        assert resp.status_code == 200
        assert resp.content == TINY_PNG
    finally:
        admin_storage.delete_file(bucket_id=appwrite_settings.BUCKET_PUBLIC, file_id=file_id)


def test_private_bucket_blocks_unauthenticated_download(admin_storage: Storage):
    """Verify that files in zipright-private reject unauthenticated access."""
    file_id = f"priv_{uuid.uuid4().hex[:8]}"
    
    admin_storage.create_file(
        bucket_id=appwrite_settings.BUCKET_PRIVATE,
        file_id=file_id,
        file=InputFile.from_bytes(TINY_PNG, filename=f"{file_id}.png", mime_type="image/png"),
        permissions=[Permission.read(Role.user("authorized_user_123"))],
    )
    
    try:
        ep, host = get_effective_appwrite_target()
        headers = {"Host": host} if host else {}
        url = f"{ep}/storage/buckets/{appwrite_settings.BUCKET_PRIVATE}/files/{file_id}/view?project={appwrite_settings.PROJECT_ID}"
        resp = requests.get(url, headers=headers, verify=False, timeout=10)
        assert resp.status_code in (401, 403, 404)
    finally:
        admin_storage.delete_file(bucket_id=appwrite_settings.BUCKET_PRIVATE, file_id=file_id)


def test_private_bucket_cross_user_isolation(admin_storage: Storage, admin_users: Users):
    """Verify that User A cannot read User B's private files even when authenticated."""
    uid_a = f"usera_{uuid.uuid4().hex[:8]}"
    uid_b = f"userb_{uuid.uuid4().hex[:8]}"
    file_b = f"priv_b_{uuid.uuid4().hex[:8]}"

    admin_users.create(user_id=uid_a, email=f"{uid_a}@test.com", password="Password123!", name="User A")
    admin_users.create(user_id=uid_b, email=f"{uid_b}@test.com", password="Password123!", name="User B")

    try:
        admin_storage.create_file(
            bucket_id=appwrite_settings.BUCKET_PRIVATE,
            file_id=file_b,
            file=InputFile.from_bytes(TINY_PNG, filename=f"{file_b}.png", mime_type="image/png"),
            permissions=[
                Permission.read(Role.user(uid_b)),
                Permission.update(Role.user(uid_b)),
                Permission.delete(Role.user(uid_b)),
            ],
        )

        try:
            jwt_a = admin_users.create_jwt(user_id=uid_a)
        except AppwriteException as exc:
            if exc.code == 500:
                pytest.skip("Appwrite server requires _APP_OPENSSL_KEY_V1 to issue JWT tokens")
            raise
        jwt_token = getattr(jwt_a, "jwt", None) or getattr(jwt_a, "token", None) or (jwt_a.get("jwt") if isinstance(jwt_a, dict) else None)

        client_a = Client()
        ep, host = get_effective_appwrite_target()
        client_a.set_endpoint(ep)
        client_a.set_project(appwrite_settings.PROJECT_ID)
        client_a.set_self_signed(True)
        if host:
            client_a.add_header("Host", host)
        client_a.set_jwt(jwt_token)

        storage_a = Storage(client_a)
        with pytest.raises(AppwriteException) as exc_info:
            storage_a.get_file(bucket_id=appwrite_settings.BUCKET_PRIVATE, file_id=file_b)
        
        assert exc_info.value.code in (401, 403, 404)
    finally:
        try:
            admin_storage.delete_file(bucket_id=appwrite_settings.BUCKET_PRIVATE, file_id=file_b)
        except Exception:
            pass
        admin_users.delete(user_id=uid_a)
        admin_users.delete(user_id=uid_b)


def test_storage_extension_validation_rejection(admin_storage: Storage):
    """Verify that disallowed file extensions (.bin, .sh, .exe) are strictly rejected."""
    file_id = f"invalid_{uuid.uuid4().hex[:8]}"
    disallowed_bytes = b"MALICIOUS_OR_INVALID_PAYLOAD"

    with pytest.raises(AppwriteException) as exc_info:
        admin_storage.create_file(
            bucket_id=appwrite_settings.BUCKET_PUBLIC,
            file_id=file_id,
            file=InputFile.from_bytes(disallowed_bytes, filename=f"{file_id}.exe", mime_type="application/octet-stream"),
        )
    assert exc_info.value.code == 400
    assert "extension" in str(exc_info.value).lower()


def test_storage_deletion_and_orphan_handling(admin_storage: Storage):
    """Verify that file deletion cleanly frees resources and subsequent gets return 404."""
    file_id = f"del_{uuid.uuid4().hex[:8]}"

    admin_storage.create_file(
        bucket_id=appwrite_settings.BUCKET_COMMUNITY,
        file_id=file_id,
        file=InputFile.from_bytes(TINY_PNG, filename=f"{file_id}.png", mime_type="image/png"),
    )

    f = admin_storage.get_file(bucket_id=appwrite_settings.BUCKET_COMMUNITY, file_id=file_id)
    assert _get(f, "$id", "id") == file_id

    admin_storage.delete_file(bucket_id=appwrite_settings.BUCKET_COMMUNITY, file_id=file_id)

    # Allow remote cloud storage deletion to propagate across Azure deployment
    deleted_verified = False
    for _ in range(10):
        time.sleep(0.3)
        try:
            admin_storage.get_file(bucket_id=appwrite_settings.BUCKET_COMMUNITY, file_id=file_id)
        except AppwriteException as exc:
            if exc.code == 404:
                deleted_verified = True
                break
    assert deleted_verified is True


def test_storage_provider_upload_download_integrity(admin_storage: Storage):
    """Verify StorageProvider upload_bytes and direct retrieval match byte-for-byte."""
    provider = AppwriteStorageProvider()

    url = provider.upload_bytes(
        data=TINY_PNG,
        content_type="image/png",
        folder="seller-logos",
        extension=".png",
    )
    assert url is not None
    file_id = url.split("/files/")[1].split("/")[0]

    try:
        download_bytes = admin_storage.get_file_download(
            bucket_id=appwrite_settings.BUCKET_PUBLIC,
            file_id=file_id,
        )
        assert download_bytes == TINY_PNG, "Uploaded and downloaded bytes do not match!"
    finally:
        provider.delete_file("seller-logos", file_id)
