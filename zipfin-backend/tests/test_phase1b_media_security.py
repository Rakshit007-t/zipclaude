"""Phase 1B: Private Media, Photo, Avatar & Biometric-Data Protection Security Test Suite.

Validates the security invariants and requirements for Phase 1B:
- MEDIA-01: Anonymous user cannot retrieve private customer media (401 Unauthorized).
- MEDIA-02: Customer A cannot retrieve Customer B's private media (403 Forbidden).
- MEDIA-03: Customer A cannot retrieve Customer B's avatar (403 Forbidden).
- MEDIA-04: Customer A cannot retrieve Customer B's try-on output (403 Forbidden).
- MEDIA-05: Customer A cannot retrieve Customer B's SmartFit scans/photos (403 Forbidden).
- MEDIA-06: Changing a media URL/path/filename/signature does not bypass authorization.
- MEDIA-07: Changing a try-on job ID does not reveal another user's result.
- MEDIA-08: Storage rules verify private Firebase objects are not publicly readable.
- MEDIA-09: Private media responses contain 'Cache-Control: private, no-cache, no-store, must-revalidate'.
- MEDIA-10: Private media access does not expose cloud credentials or storage tokens.
- MEDIA-11: Existing customer can retrieve their own authorized media.
- MEDIA-12: Existing avatar and try-on operational flows remain intact.
- MEDIA-13: Admin role cannot bypass owner-only check on private customer biometric media.
- MEDIA-14: Public seller assets remain accessible at /media/public/....
"""

from __future__ import annotations

import io
import time
from pathlib import Path
from unittest.mock import AsyncMock, patch
import pytest
from fastapi import status
from fastapi.testclient import TestClient

from main import app
from models.schema import AvatarCreateResponse
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.media_access import (
    create_signed_media_url,
    generate_media_signature,
    verify_media_signature,
)
from services.tryon_jobs import start_tryon_job
from services.tryon_engine import _resolve_user_image_path, _store_tryon_image_locally

CUSTOMER_A = AuthenticatedUser(uid="cust-user-a", email="alice@example.com")
CUSTOMER_B = AuthenticatedUser(uid="cust-user-b", email="bob@example.com")
ADMIN_USER = AuthenticatedUser(uid="admin-1", email="admin@zipright.com")


@pytest.fixture(autouse=True)
def setup_media_directories(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Ensure tests run against a clean temporary uploads directory."""
    monkeypatch.setattr("routes.media.UPLOAD_DIR", tmp_path)
    monkeypatch.setattr("services.tryon_engine.UPLOAD_DIR", tmp_path)
    monkeypatch.setattr("services.face_engine.UPLOAD_DIR", tmp_path)
    monkeypatch.setattr("services.storage_provider.LOCAL_UPLOAD_DIR", tmp_path)

    # Pre-seed private media for testing
    user_a_tryon_dir = tmp_path / "private" / "tryons" / CUSTOMER_A.uid
    user_a_tryon_dir.mkdir(parents=True, exist_ok=True)
    (user_a_tryon_dir / "tryon-a.png").write_bytes(b"PNG-ALICE-TRYON-RENDER")

    user_b_tryon_dir = tmp_path / "private" / "tryons" / CUSTOMER_B.uid
    user_b_tryon_dir.mkdir(parents=True, exist_ok=True)
    (user_b_tryon_dir / "tryon-b.png").write_bytes(b"PNG-BOB-TRYON-RENDER")

    user_b_avatar_dir = tmp_path / "private" / "avatars" / CUSTOMER_B.uid
    user_b_avatar_dir.mkdir(parents=True, exist_ok=True)
    (user_b_avatar_dir / "avatar.jpg").write_bytes(b"JPEG-BOB-FACE-PHOTO")

    user_b_smartfit_dir = tmp_path / "private" / "smartfit" / CUSTOMER_B.uid
    user_b_smartfit_dir.mkdir(parents=True, exist_ok=True)
    (user_b_smartfit_dir / "scan.png").write_bytes(b"PNG-BOB-BODY-SCAN")

    # Seed public seller logo
    public_logos_dir = tmp_path / "public" / "seller-logos"
    public_logos_dir.mkdir(parents=True, exist_ok=True)
    (public_logos_dir / "brand-logo.png").write_bytes(b"PNG-PUBLIC-SELLER-LOGO")

    yield tmp_path


def _client_for(user: AuthenticatedUser | None = None) -> TestClient:
    app.dependency_overrides.clear()
    if user:
        app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


# ── MEDIA-01: Anonymous Access Denied & Public Mount Removed ─────────────────

def test_media_01_anonymous_cannot_retrieve_private_media():
    """Anonymous user without token or signature receives 401 Unauthorized."""
    client = _client_for(None)
    response = client.get(f"/media/private/tryons/{CUSTOMER_B.uid}/tryon-b.png")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    assert "Authentication required" in response.text


def test_media_01_unauthenticated_uploads_mount_is_removed():
    """Legacy /uploads static mount is completely removed and returns 404."""
    client = _client_for(None)
    response = client.get("/uploads/private/tryons/cust-user-b/tryon-b.png")
    assert response.status_code == status.HTTP_404_NOT_FOUND


# ── MEDIA-02, MEDIA-03, MEDIA-04, MEDIA-05: Cross-Customer Isolation ─────────

def test_media_02_customer_a_cannot_retrieve_customer_b_private_media():
    """Customer A cannot retrieve any private media belonging to Customer B."""
    client = _client_for(CUSTOMER_A)
    response = client.get(f"/media/private/tryons/{CUSTOMER_B.uid}/tryon-b.png")
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert "Access denied" in response.text


def test_media_03_customer_a_cannot_retrieve_customer_b_avatar():
    """Customer A cannot retrieve Customer B's facial avatar photo."""
    client = _client_for(CUSTOMER_A)
    response = client.get(f"/media/private/avatars/{CUSTOMER_B.uid}/avatar.jpg")
    assert response.status_code == status.HTTP_403_FORBIDDEN


def test_media_04_customer_a_cannot_retrieve_customer_b_tryon():
    """Customer A cannot retrieve Customer B's virtual try-on output."""
    client = _client_for(CUSTOMER_A)
    response = client.get(f"/media/private/tryons/{CUSTOMER_B.uid}/tryon-b.png")
    assert response.status_code == status.HTTP_403_FORBIDDEN


def test_media_05_customer_a_cannot_retrieve_customer_b_smartfit_scan():
    """Customer A cannot retrieve Customer B's SmartFit body scan."""
    client = _client_for(CUSTOMER_A)
    response = client.get(f"/media/private/smartfit/{CUSTOMER_B.uid}/scan.png")
    assert response.status_code == status.HTTP_403_FORBIDDEN


# ── MEDIA-06: Tamper & Path Traversal Resistance ─────────────────────────────

def test_media_06_path_traversal_attempts_blocked():
    """Directory traversal patterns (../, .., /) are rejected with HTTP 400."""
    client = _client_for(CUSTOMER_A)
    # Attempting to escape user directory to fetch another user's file
    response = client.get(f"/media/private/tryons/{CUSTOMER_A.uid}/..%2F..%2F{CUSTOMER_B.uid}%2Ftryon-b.png")
    assert response.status_code in {status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND}

    # Malicious characters in user_id
    response2 = client.get("/media/private/tryons/../../etc/passwd")
    assert response2.status_code in {status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND}


def test_media_06_forged_or_expired_signatures_rejected():
    """Forged or expired HMAC signatures fail authentication with 401."""
    client = _client_for(None)

    # Forged signature
    response = client.get(
        f"/media/private/tryons/{CUSTOMER_B.uid}/tryon-b.png?expires={int(time.time()) + 600}&signature=deadbeef123456"
    )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED

    # Expired signature (expired 10 seconds ago)
    past_timestamp = int(time.time()) - 10
    valid_past_sig = generate_media_signature("tryons", CUSTOMER_B.uid, "tryon-b.png", past_timestamp)
    response_expired = client.get(
        f"/media/private/tryons/{CUSTOMER_B.uid}/tryon-b.png?expires={past_timestamp}&signature={valid_past_sig}"
    )
    assert response_expired.status_code == status.HTTP_401_UNAUTHORIZED


# ── MEDIA-07: Try-On Job ID Isolation ────────────────────────────────────────

def test_media_07_changing_job_id_does_not_reveal_another_users_result():
    """Customer A cannot view Customer B's try-on job by guessing job_id."""
    victim_job_id = start_tryon_job(
        user_id=CUSTOMER_B.uid,
        product_image_url="https://example.com/shirt.jpg",
        cloth_type="upper_body",
        quality="fast",
        person_image=None,
        garment_image=None,
    )

    client_a = _client_for(CUSTOMER_A)
    res = client_a.get(f"/tryon-job/{victim_job_id}")
    assert res.status_code == status.HTTP_403_FORBIDDEN
    assert "belongs to another user" in res.text


# ── MEDIA-08: Firebase Storage Rules Audit ───────────────────────────────────

def test_media_08_storage_rules_prevent_public_private_reads():
    """Verify that storage.rules enforces strict owner-only access for private objects."""
    rules_path = Path(__file__).resolve().parents[2] / "zipfend" / "storage.rules"
    assert rules_path.is_file(), f"storage.rules not found at {rules_path}"
    content = rules_path.read_text(encoding="utf-8")

    # Private and users paths must be owner-only
    assert "match /private/{uid}/{allPaths=**}" in content
    assert "match /users/{uid}/{allPaths=**}" in content
    assert "request.auth.uid == uid" in content

    # Default deny rule must exist
    assert "match /{allPaths=**} { allow read, write: if false; }" in content


# ── MEDIA-09: Cache Control Verification ─────────────────────────────────────

def test_media_09_private_media_responses_enforce_no_cache_no_store():
    """Private customer media responses must not be publicly cached."""
    client = _client_for(CUSTOMER_A)
    res = client.get(f"/media/private/tryons/{CUSTOMER_A.uid}/tryon-a.png")
    assert res.status_code == status.HTTP_200_OK

    cache_control = res.headers.get("Cache-Control", "")
    assert "private" in cache_control
    assert "no-store" in cache_control
    assert "no-cache" in cache_control
    assert "must-revalidate" in cache_control
    # Must NEVER be publicly cached
    assert "public" not in cache_control
    assert "max-age=31536000" not in cache_control


# ── MEDIA-10: No Credential or Permanent Token Leaks ────────────────────────

def test_media_10_media_access_does_not_leak_cloud_credentials_or_tokens():
    """Private media access returns clean headers without cloud credentials or permanent tokens."""
    client = _client_for(CUSTOMER_A)
    res = client.get(f"/media/private/tryons/{CUSTOMER_A.uid}/tryon-a.png")
    assert res.status_code == status.HTTP_200_OK

    all_headers = " ".join(f"{k}: {v}" for k, v in res.headers.items())
    assert "firebaseStorageDownloadTokens" not in all_headers
    assert "private_key" not in all_headers
    assert "service_account" not in all_headers


# ── MEDIA-11: Authorized Retrieval Works ─────────────────────────────────────

def test_media_11_customer_can_retrieve_own_media_via_token():
    """Customer A with valid auth token can retrieve their own media."""
    client = _client_for(CUSTOMER_A)
    res = client.get(f"/media/private/tryons/{CUSTOMER_A.uid}/tryon-a.png")
    assert res.status_code == status.HTTP_200_OK
    assert res.content == b"PNG-ALICE-TRYON-RENDER"


def test_media_11_customer_can_retrieve_own_media_via_signed_url():
    """Signed media URL allows browser image loading without Authorization header."""
    signed_url = create_signed_media_url("tryons", CUSTOMER_A.uid, "tryon-a.png", expires_in_seconds=300)
    client_unauthed = _client_for(None)
    res = client_unauthed.get(signed_url)
    assert res.status_code == status.HTTP_200_OK
    assert res.content == b"PNG-ALICE-TRYON-RENDER"


# ── MEDIA-12: Operational Integrity of Try-On & Avatar Flows ─────────────────

def test_media_12_tryon_engine_stores_and_resolves_private_avatar(tmp_path: Path):
    """Try-on engine correctly resolves private avatars and stores private try-on images."""
    user_id = "test-user-op"
    avatar_dir = tmp_path / "private" / "avatars" / user_id
    avatar_dir.mkdir(parents=True, exist_ok=True)
    (avatar_dir / "avatar.png").write_bytes(b"AVATAR-BYTES")

    resolved_path = _resolve_user_image_path(user_id)
    assert resolved_path.is_file()
    assert resolved_path.read_bytes() == b"AVATAR-BYTES"

    # Store tryon locally
    stored_url = _store_tryon_image_locally(image_bytes=b"TRYON-OUTPUT-BYTES", user_id=user_id)
    assert stored_url.startswith(f"/media/private/tryons/{user_id}/")
    assert "expires=" in stored_url
    assert "signature=" in stored_url


# ── MEDIA-13: Zero Admin Bypass on Customer Biometric Media ──────────────────

def test_media_13_admin_cannot_bypass_owner_check_on_private_media():
    """Admin role CANNOT view customer biometric/try-on media (no admin bypass)."""
    admin_client = _client_for(ADMIN_USER)
    res = admin_client.get(f"/media/private/tryons/{CUSTOMER_B.uid}/tryon-b.png")
    assert res.status_code == status.HTTP_403_FORBIDDEN
    assert "Access denied" in res.text

    res_avatar = admin_client.get(f"/media/private/avatars/{CUSTOMER_B.uid}/avatar.jpg")
    assert res_avatar.status_code == status.HTTP_403_FORBIDDEN


# ── MEDIA-14: Public Assets Remain Accessible ────────────────────────────────

def test_media_14_public_seller_assets_accessible_without_auth():
    """Seller brand logos and public product images remain publicly readable."""
    client = _client_for(None)
    res = client.get("/media/public/seller-logos/brand-logo.png")
    assert res.status_code == status.HTTP_200_OK
    assert res.content == b"PNG-PUBLIC-SELLER-LOGO"
    assert "public" in res.headers.get("Cache-Control", "")
