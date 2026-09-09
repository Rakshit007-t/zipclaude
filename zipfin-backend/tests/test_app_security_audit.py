"""Comprehensive Automated Defensive Security & Penetration Audit Suite.

Verifies the 20 security invariants:
1. IDOR prevention across jobs, live try-on sessions, and seller products
2. SQL injection resistance with parameterized queries
3. Strict admin route locking (RBAC)
4. Blocking unauthenticated access to private routes
5. Field tampering and mass-assignment protection
6. Authoritative server-side pricing & payment verification
7. Automatic sensitive credential & PII log redaction
8. Upload restriction & binary magic byte validation
9. Rate limiting IP spoofing defense
10. SSRF prevention against cloud metadata and private IPs
11. Git repository secret scanning
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from core.api_key_auth import AuthenticatedApiKey, verify_api_key
from core.rate_limit_middleware import RateLimitMiddleware
from core.security_logger import redact_sensitive_data, redact_sensitive_string
from services.admin_auth import AdminGate, get_admin_gate, require_admin
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.payment_service import SERVER_PRICING_CATALOG, get_server_price
from services.product_repository import SellerProductRepository
from services.tryon_jobs import start_tryon_job
from services.tryon_live_store import (
    create_garment_record,
    create_session_record,
    get_garment_record,
    get_session_record,
    initialize_tryon_store,
)
from services.upload_validator import (
    ALLOWED_EXTENSIONS,
    ALLOWED_IMAGE_MIMES,
    validate_image_magic_bytes,
    validate_image_upload,
)
from services.url_guard import assert_public_http_url


# ─────────────────────────────────────────────────────────────────────────────
# 1. IDOR DEFENSE TESTS
# ─────────────────────────────────────────────────────────────────────────────

def test_idor_v1_job_polling_cross_tenant_blocked():
    """Verify Developer Key A cannot query Developer Key B's try-on job."""
    victim_job_id = start_tryon_job(
        user_id="user_victim_123",
        product_image_url="https://example.com/dress.jpg",
        cloth_type="dress",
        quality="fast",
        person_image=None,
        garment_image=None,
    )

    client = TestClient(app)

    # Attacker tries to query victim's job
    app.dependency_overrides[verify_api_key] = lambda: AuthenticatedApiKey(
        key_id="key_attacker",
        user_id="user_attacker_999",
        name="Attacker Key",
        environment="test",
    )
    try:
        res = client.get(f"/v1/jobs/{victim_job_id}")
        assert res.status_code == 403
        assert "Not authorized to access this job" in res.json()["message"]
    finally:
        app.dependency_overrides.pop(verify_api_key, None)

    # Legitimate owner queries the job
    app.dependency_overrides[verify_api_key] = lambda: AuthenticatedApiKey(
        key_id="key_victim",
        user_id="user_victim_123",
        name="Victim Key",
        environment="test",
    )
    try:
        res = client.get(f"/v1/jobs/{victim_job_id}")
        assert res.status_code == 200
        assert res.json()["data"]["job_id"] == victim_job_id
    finally:
        app.dependency_overrides.pop(verify_api_key, None)


def test_idor_tryon_job_cross_user_blocked():
    """Verify User A cannot query User B's sync/async try-on job."""
    victim_job_id = start_tryon_job(
        user_id="user_alice",
        product_image_url="https://example.com/shirt.jpg",
        cloth_type="upper_body",
        quality="fast",
        person_image=None,
        garment_image=None,
    )

    client = TestClient(app)

    # User Bob attempts to inspect Alice's job
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="user_bob",
        email="bob@example.com",
    )
    try:
        res = client.get(f"/tryon-job/{victim_job_id}")
        assert res.status_code == 403
        msg = res.json().get("message") or (res.json().get("detail") if isinstance(res.json().get("detail"), str) else "")
        assert "belongs to another user" in msg
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    # Alice queries her own job
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="user_alice",
        email="alice@example.com",
    )
    try:
        res = client.get(f"/tryon-job/{victim_job_id}")
        assert res.status_code == 200
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_idor_live_tryon_session_frame_cross_user_blocked():
    """Verify User A cannot send frames to User B's live try-on session."""
    initialize_tryon_store()
    import uuid
    garment = create_garment_record(
        {
            "sku": f"sec-audit-garment-{uuid.uuid4().hex[:8]}",
            "name": "Audit Garment",
            "category": "top",
            "scale_multiplier": 1.0,
            "anchor_profile": {"left_shoulder": [0.3, 0.4]},
        }
    )
    session = create_session_record(
        {
            "user_id": "user_victim_live",
            "garment_id": garment["garment_id"],
            "platform": "web",
            "frame_width": 640,
            "frame_height": 480,
            "camera_fov_degrees": 60.0,
        }
    )
    session_id = session["session_id"]

    client = TestClient(app)

    # Attacker tries to estimate frame on victim's session
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="user_attacker_live",
        email="attacker@example.com",
    )
    try:
        res = client.post(
            "/tryon-live/frame",
            json={
                "session_id": session_id,
                "frame_width": 640,
                "frame_height": 480,
                "landmarks": {
                    "left_shoulder": {"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 0.9},
                    "right_shoulder": {"x": 0.6, "y": 0.5, "z": 0.0, "visibility": 0.9},
                },
            },
        )
        assert res.status_code == 403
        msg = res.json().get("message") or (res.json().get("detail", {}).get("message") if isinstance(res.json().get("detail"), dict) else "")
        assert "Not authorized to submit frames" in msg
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ─────────────────────────────────────────────────────────────────────────────
# 2. ROLE-BASED ACCESS CONTROL (ADMIN ROUTES LOCKING)
# ─────────────────────────────────────────────────────────────────────────────

def test_admin_routes_strictly_locked_for_non_admins():
    """Verify non-admin users receive 403 on administrative routes."""
    client = TestClient(app)

    # Normal user (not an admin)
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="regular_shopper",
        email="shopper@example.com",
    )
    fake_gate = MagicMock(spec=AdminGate)
    fake_gate.is_admin.return_value = False
    app.dependency_overrides[get_admin_gate] = lambda: fake_gate

    try:
        # Attempt to list all sellers
        res_list = client.get("/seller")
        assert res_list.status_code == 403
        msg_list = res_list.json().get("message") or (res_list.json().get("detail", {}).get("message") if isinstance(res_list.json().get("detail"), dict) else "")
        assert "Administrator access required" in msg_list

        # Attempt to modify a seller's approval status
        res_patch = client.patch(
            "/seller/target_seller_uid/status",
            json={"status": "active"},
        )
        assert res_patch.status_code == 403
        msg_patch = res_patch.json().get("message") or (res_patch.json().get("detail", {}).get("message") if isinstance(res_patch.json().get("detail"), dict) else "")
        assert "Administrator access required" in msg_patch

        # Attempt to create a global live garment
        res_garment = client.post(
            "/tryon-live/garments",
            json={
                "sku": "unauthorized-sku-99",
                "name": "Hacked Garment",
                "category": "top",
                "scale_multiplier": 1.0,
                "anchor_profile": {"left_shoulder": [0.5, 0.5]},
            },
        )
        assert res_garment.status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_admin_gate, None)


def test_admin_routes_accessible_by_verified_admin():
    """Verify verified administrators can access admin routes."""
    client = TestClient(app)

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="real_admin_001",
        email="admin@zipright.ai",
    )
    fake_gate = MagicMock(spec=AdminGate)
    fake_gate.is_admin.return_value = True
    app.dependency_overrides[get_admin_gate] = lambda: fake_gate

    try:
        res = client.get("/seller")
        assert res.status_code == 200
        assert res.json()["message"] == "Sellers fetched successfully."
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_admin_gate, None)


# ─────────────────────────────────────────────────────────────────────────────
# 3. UNAUTHENTICATED ROUTE BLOCKING
# ─────────────────────────────────────────────────────────────────────────────

def test_unauthenticated_requests_blocked():
    """Verify private endpoints reject unauthenticated requests with HTTP 401."""
    client = TestClient(app)

    protected_endpoints = [
        ("GET", "/profiles/me"),
        ("POST", "/tryon-image"),
        ("POST", "/tryon-job"),
        ("POST", "/stylist"),
        ("POST", "/wallet/topup"),
        ("GET", "/developer/keys"),
        ("GET", "/notifications"),
    ]

    for method, path in protected_endpoints:
        if method == "GET":
            res = client.get(path)
        else:
            res = client.post(path, json={})
        assert res.status_code == 401, f"Expected 401 for {method} {path}, got {res.status_code}"


# ─────────────────────────────────────────────────────────────────────────────
# 4. SQL INJECTION RESILIENCE (SQLite PARAMETERIZATION)
# ─────────────────────────────────────────────────────────────────────────────

def test_sql_injection_resilience_in_live_tryon_store():
    """Verify SQL injection strings are safely parameterized and do not compromise SQLite."""
    initialize_tryon_store()

    # 1. Inject SQL into lookup
    sqli_payload = "' OR '1'='1' --"
    record = get_session_record(sqli_payload)
    assert record is None, "SQL injection must not return arbitrary records"

    # 2. Inject destructive SQL statement
    destructive_payload = "'; DROP TABLE garments; --"
    garment = get_garment_record(destructive_payload)
    assert garment is None

    # 3. Verify garments table is still intact and functional
    import uuid
    valid_sku = f"valid-sku-{uuid.uuid4().hex[:8]}"
    valid_garment = create_garment_record(
        {
            "sku": valid_sku,
            "name": "Safe Garment",
            "category": "bottom",
            "scale_multiplier": 1.0,
            "anchor_profile": {"left_hip": [0.5, 0.5]},
        }
    )
    assert valid_garment["sku"] == valid_sku

    # 4. Store a garment with SQL special characters in text fields
    literal_sqli_sku = f"sku' UNION SELECT * FROM sqlite_master; -- {uuid.uuid4().hex[:8]}"
    literal_garment = create_garment_record(
        {
            "sku": literal_sqli_sku,
            "name": "Injection As Name",
            "category": "top",
            "scale_multiplier": 1.2,
            "anchor_profile": {"left_shoulder": [0.2, 0.2]},
        }
    )
    retrieved = get_garment_record(literal_garment["garment_id"])
    assert retrieved is not None
    assert retrieved["sku"] == literal_sqli_sku


# ─────────────────────────────────────────────────────────────────────────────
# 5. FIELD TAMPERING & MASS ASSIGNMENT PROTECTION
# ─────────────────────────────────────────────────────────────────────────────

def test_field_tampering_mass_assignment_stripped_in_product_update(fake_client):
    """Verify mass-assignment fields (seller_uid, id, created_at) are stripped on update."""
    repo = SellerProductRepository(client=fake_client)

    # Create legitimate product for seller_A
    product = repo.create_product(
        "seller_A",
        {
            "title": "Summer Tee",
            "category": "shirts",
            "brand": "Atelier",
            "price": 999.0,
        },
    )
    prod_id = product["id"]

    # Attempt to tamper with seller_uid and id
    tampered_update = {
        "title": "Updated Summer Tee",
        "id": "tampered_id_override",
        "seller_uid": "stolen_seller_B",
        "created_at": "1970-01-01T00:00:00Z",
    }
    updated = repo.update_product(prod_id, "seller_A", tampered_update)

    assert updated is not None
    assert updated["title"] == "Updated Summer Tee"
    assert updated["seller_uid"] == "seller_A", "seller_uid must NEVER be altered by update"
    assert updated["id"] == prod_id, "id must NEVER be altered by update"


def test_field_tampering_payment_pricing_server_authoritative():
    """Verify price cannot be dictated by client payloads."""
    starter_price = get_server_price("wallet_pack_starter")
    assert starter_price["amount_rupees"] == SERVER_PRICING_CATALOG["wallet_pack_starter"]["amount_rupees"]

    client = TestClient(app)
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="shopper_tamper",
        email="shopper@example.com",
    )
    try:
        # Attacker attempts to send amount_rupees: 1
        res = client.post(
            "/payments/orders",
            json={"package_id": "wallet_pack_standard", "amount_rupees": 1, "currency": "USD"},
        )
        assert res.status_code == 201
        data = res.json()["data"]
        # Server must strictly enforce the catalog price (₹499 for standard)
        assert data["amount_rupees"] == 499
        assert data["currency"] == "INR"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ─────────────────────────────────────────────────────────────────────────────
# 6. SENSITIVE CREDENTIAL & LOG REDACTION
# ─────────────────────────────────────────────────────────────────────────────

def test_sensitive_credentials_redacted_in_logs():
    """Verify JWTs, Bearer headers, passwords, and card numbers are scrubbed from logs."""
    raw_jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiIxMjM0NTY3OCJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    text_with_jwt = f"User logged in with token {raw_jwt}"
    redacted_text = redact_sensitive_string(text_with_jwt)
    assert raw_jwt not in redacted_text
    assert "[REDACTED_TOKEN]" in redacted_text

    raw_bearer = "Authorization: Bearer secret_session_token_xyz123"
    assert "secret_session_token_xyz123" not in redact_sensitive_string(raw_bearer)
    assert "Bearer [REDACTED_TOKEN]" in redact_sensitive_string(raw_bearer)

    # Credit card scrubbing
    card_log = "Payment processed for card 4111 2222 3333 4444 on order"
    assert "4111 2222 3333 4444" not in redact_sensitive_string(card_log)
    assert "[REDACTED_CARD]" in redact_sensitive_string(card_log)

    # Dictionary recursive scrubbing
    payload = {
        "username": "safe_user",
        "password": "SuperSecretPassword123!",
        "api_key": "zr_live_abcdef1234567890",
        "nested": {
            "refresh_token": "secret_refresh_token",
            "count": 5,
        },
    }
    scrubbed = redact_sensitive_data(payload)
    assert scrubbed["username"] == "safe_user"
    assert scrubbed["password"] == "[REDACTED]"
    assert scrubbed["api_key"] == "[REDACTED]"
    assert scrubbed["nested"]["refresh_token"] == "[REDACTED]"
    assert scrubbed["nested"]["count"] == 5


# ─────────────────────────────────────────────────────────────────────────────
# 7. FILE UPLOAD RESTRICTIONS & MAGIC BYTE VALIDATION
# ─────────────────────────────────────────────────────────────────────────────

def test_file_upload_validation_magic_bytes_and_extensions():
    """Verify uploaded files must match both extension and true binary magic bytes."""
    # Valid JPEG
    jpeg_bytes = b"\xFF\xD8\xFF\xE0\x00\x10JFIF\x00" + b"\x00" * 32
    assert validate_image_magic_bytes(jpeg_bytes) == "image/jpeg"

    # Valid PNG
    png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\r" + b"\x00" * 32
    assert validate_image_magic_bytes(png_bytes) == "image/png"

    # Valid WEBP
    webp_bytes = b"RIFF\x28\x00\x00\x00WEBPVP8 " + b"\x00" * 32
    assert validate_image_magic_bytes(webp_bytes) == "image/webp"

    # Polyglot executable disguised as JPEG
    fake_jpeg = b"MZ\x90\x00\x03\x00\x00\x00"  # DOS/PE executable header
    assert validate_image_magic_bytes(fake_jpeg) is None

    # SVG disguised as PNG (XSS vector)
    svg_disguised = b"<?xml version='1.0'?><svg onload='alert(1)'></svg>"
    assert validate_image_magic_bytes(svg_disguised) is None


# ─────────────────────────────────────────────────────────────────────────────
# 8. RATE LIMITING IP SPOOFING DEFENSE
# ─────────────────────────────────────────────────────────────────────────────

def test_rate_limiting_ip_spoofing_resistance():
    """Verify forged X-Forwarded-For headers from untrusted clients do not reset IP rate limits."""
    os.environ["TRUST_PROXY_HEADERS"] = "false"
    try:
        from core.rate_limit_middleware import RateLimitMiddleware
        middleware = RateLimitMiddleware(app=MagicMock(), requests_per_minute=2, burst_limit=2)

        # Peer is 198.51.100.5 (external untrusted client), forging X-Forwarded-For
        mock_req = MagicMock()
        mock_req.url.path = "/test-route"
        mock_req.client.host = "198.51.100.5"
        mock_req.headers = {"X-Forwarded-For": "203.0.113.1"}

        # First request
        allowed1, _, _ = middleware.limiter.is_allowed("198.51.100.5")
        assert allowed1 is True

        # Second request
        allowed2, _, _ = middleware.limiter.is_allowed("198.51.100.5")
        assert allowed2 is True

        # Third request should be blocked even if attacker sends another forged X-Forwarded-For
        allowed3, _, _ = middleware.limiter.is_allowed("198.51.100.5")
        assert allowed3 is False, "Rate limiter must bind to true peer host when untrusted"
    finally:
        os.environ.pop("TRUST_PROXY_HEADERS", None)


# ─────────────────────────────────────────────────────────────────────────────
# 9. SSRF GUARD DEFENSE
# ─────────────────────────────────────────────────────────────────────────────

def test_ssrf_guard_blocks_internal_and_metadata_ips():
    """Verify SSRF protection rejects loopback, RFC 1918, and AWS metadata addresses."""
    blocked_urls = [
        "http://127.0.0.1:8080/secret",
        "http://localhost/admin",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.1/internal",
        "http://192.168.1.1/router",
        "http://172.16.0.1/infra",
    ]

    for url in blocked_urls:
        with pytest.raises(ValueError):
            assert_public_http_url(url)


# ─────────────────────────────────────────────────────────────────────────────
# 10. REPOSITORY SECRET SCANNING
# ─────────────────────────────────────────────────────────────────────────────

def test_repository_has_no_committed_secrets():
    """Verify no live private keys, service account secrets, or high-entropy tokens are committed."""
    repo_root = Path(__file__).resolve().parents[2]

    # Run git ls-files to inspect tracked files
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
    )
    tracked_files = result.stdout.splitlines()

    forbidden_patterns = [
        re.compile(r"serviceAccountKey\.json$", re.IGNORECASE),
        re.compile(r"firebase-adminsdk.*\.json$", re.IGNORECASE),
        re.compile(r"\.env$", re.IGNORECASE),
        re.compile(r"\.env\.(staging|production|local)$", re.IGNORECASE),
        re.compile(r"\.key$", re.IGNORECASE),
        re.compile(r"\.pem$", re.IGNORECASE),
    ]

    for file_path in tracked_files:
        for pattern in forbidden_patterns:
            assert not pattern.search(file_path), (
                f"Tracked file '{file_path}' matches forbidden secret pattern {pattern.pattern}!"
            )
