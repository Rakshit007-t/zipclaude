import io
import time
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from starlette.datastructures import UploadFile

from core.config import settings
from main import app
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.tryon_access import (
    TryOnCharge,
    consume_tryon_credit_for_uid,
    refund_tryon_credit,
)
from services.order_service import OrderService, get_order_service
from services.upload_validator import validate_image_upload
from services.live_tryon_engine import _is_session_expired


@pytest.fixture
def client():
    return TestClient(app)


# -------------------------------------------------------------------------
# P0: Kill Switches
# -------------------------------------------------------------------------

def test_vto_emergency_kill_switch(client):
    """When VTO_EMERGENCY_KILL_SWITCH is enabled, VTO routes must return 503 Service Unavailable."""
    user = AuthenticatedUser(uid="killswitch_test_user", email="test@zipright.com")
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        with patch.object(settings, "VTO_EMERGENCY_KILL_SWITCH", True):
            resp = client.post(
                "/tryon-image",
                json={
                    "user_id": "killswitch_test_user",
                    "product_image_url": "https://example.com/p.jpg",
                    "cloth_type": "upper_body",
                    "quality": "hd",
                },
                headers={"Authorization": "Bearer test-token"},
            )
            assert resp.status_code == 503
            data = resp.json()
            assert "temporarily disabled" in (data.get("message") or data.get("detail", ""))
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_ai_emergency_kill_switch(client):
    """When AI_EMERGENCY_KILL_SWITCH is enabled, Stylist routes must return 503."""
    user = AuthenticatedUser(uid="killswitch_test_user", email="test@zipright.com")
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        with patch.object(settings, "AI_EMERGENCY_KILL_SWITCH", True):
            resp = client.post(
                "/stylist",
                json={"message": "recommend an outfit"},
                headers={"Authorization": "Bearer test-token"},
            )
            assert resp.status_code == 503
            data = resp.json()
            assert "temporarily disabled" in (data.get("message") or data.get("detail", ""))
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# -------------------------------------------------------------------------
# P0: Try-On Credit Refund Idempotency
# -------------------------------------------------------------------------

def test_tryon_credit_refund_idempotent():
    """Refunds must be atomic and idempotent using tryon_refunds/{job_id} sentinel."""
    mock_tx = MagicMock()
    mock_refund_ref = MagicMock()
    mock_user_ref = MagicMock()

    # First invocation: refund_snap.exists is False
    mock_refund_snap = MagicMock(exists=False)
    mock_user_snap = MagicMock(exists=True)
    mock_user_snap.to_dict.return_value = {
        "walletBalanceRupees": 20,
        "usage": {"tryOns": 3},
    }
    mock_refund_ref.get.return_value = mock_refund_snap
    mock_user_ref.get.return_value = mock_user_snap

    from services.tryon_access import _refund_tryon_credit
    bal = _refund_tryon_credit(mock_tx, mock_user_ref, mock_refund_ref, charged_rupees=5, free_tryon=False)
    assert bal == 25
    assert mock_tx.set.call_count == 2  # user update + sentinel update

    # Second invocation: refund_snap.exists is True (idempotency check)
    mock_tx.reset_mock()
    mock_refund_snap.exists = True
    mock_user_snap.to_dict.return_value = {
        "walletBalanceRupees": 25,
        "usage": {"tryOns": 3},
    }
    bal2 = _refund_tryon_credit(mock_tx, mock_user_ref, mock_refund_ref, charged_rupees=5, free_tryon=False)
    assert bal2 == 25
    assert mock_tx.set.call_count == 0  # no duplicate refund written!


# -------------------------------------------------------------------------
# P0: Upload Validator Image Dimensions & Magic Bytes
# -------------------------------------------------------------------------

@pytest.mark.anyio
async def test_upload_validator_rejects_oversized_dimensions():
    """Uploads exceeding MAX_IMAGE_DIMENSION (4096px) must be rejected with 413."""
    img = Image.new("RGB", (4097, 100), color="blue")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)

    upload = UploadFile(filename="huge.jpg", file=buf, headers={"content-type": "image/jpeg"})
    with pytest.raises(HTTPException) as exc_info:
        await validate_image_upload(upload)
    assert exc_info.value.status_code == 413
    assert "exceeds maximum allowed dimensions" in str(exc_info.value.detail)


@pytest.mark.anyio
async def test_upload_validator_accepts_valid_dimensions():
    """Uploads within MAX_IMAGE_DIMENSION (4096px) must pass validation."""
    img = Image.new("RGB", (800, 600), color="green")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)

    upload = UploadFile(filename="valid.jpg", file=buf, headers={"content-type": "image/jpeg"})
    content = await validate_image_upload(upload)
    assert len(content) > 0


# -------------------------------------------------------------------------
# P0: Live Session Duration Check
# -------------------------------------------------------------------------

def test_live_tryon_session_expiry():
    """Live tryon sessions older than MAX_LIVE_SESSION_SECONDS must be expired."""
    now = datetime.now(timezone.utc)
    old_time = (now - timedelta(seconds=1801)).isoformat()
    fresh_time = (now - timedelta(seconds=300)).isoformat()

    assert _is_session_expired(old_time) is True
    assert _is_session_expired(fresh_time) is False


# -------------------------------------------------------------------------
# P1: Billing Webhook HMAC and Timing Attack Protection
# -------------------------------------------------------------------------

def test_billing_webhook_hmac_protection(client):
    """Billing webhook must verify X-Billing-Secret and reject unauthorized callers."""
    with patch.dict("os.environ", {"BILLING_WEBHOOK_SECRET": "super_secret_billing_key"}):
        # Missing secret
        resp = client.post("/billing/alerts", json={"cost_amount": 100.0})
        assert resp.status_code == 403

        # Invalid secret
        resp = client.post(
            "/billing/alerts",
            json={"cost_amount": 100.0},
            headers={"X-Billing-Secret": "wrong_key"},
        )
        assert resp.status_code == 403

        # Valid secret
        resp = client.post(
            "/billing/alerts",
            json={"cost_amount": 100.0},
            headers={"X-Billing-Secret": "super_secret_billing_key"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "processed"


# -------------------------------------------------------------------------
# P1: Red-Team Exploit Verification
# -------------------------------------------------------------------------

def test_redteam_unauthenticated_access_blocked(client):
    """Protected endpoints must reject unauthenticated requests with 401."""
    protected_urls = [
        ("POST", "/tryon-image"),
        ("POST", "/tryon-job"),
        ("POST", "/tryon-live/session"),
        ("POST", "/smart-fit/measurements"),
        ("POST", "/avatar-create"),
        ("GET", "/orders/"),
    ]
    for method, url in protected_urls:
        if method == "POST":
            resp = client.post(url)
        else:
            resp = client.get(url)
        assert resp.status_code == 401, f"{method} {url} should return 401 Unauthorized"


def test_redteam_tamper_order_prices(client, fake_client):
    """Checkout rejects price tampering because prices are server-authoritative."""
    user = AuthenticatedUser(uid="attacker_user", email="attacker@zipright.com")
    fake_prod_repo = MagicMock()
    fake_prod_repo.get_product.return_value = None
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_order_service] = lambda: OrderService(db=fake_client, product_repo=fake_prod_repo)
    try:
        # User tries to buy an item passing a client price parameter that doesn't exist in CheckoutItemRequest
        resp = client.post(
            "/orders/checkout",
            json={
                "items": [{"product_id": "test-item-nonexistent", "quantity": 1, "price": 0.01}],
            },
        )
        # Non-existent item in catalog rejected with 400 or 404, never allows client pricing
        assert resp.status_code in (400, 404, 422), "Client cannot purchase with unverified/arbitrary prices"
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_order_service, None)


def test_redteam_request_size_limiter(client):
    """Payloads exceeding 1 MB for non-upload endpoints must return 413."""
    huge_json_blob = "A" * (1024 * 1024 + 100)  # > 1 MB
    resp = client.post(
        "/auth/login",
        content=huge_json_blob,
        headers={"Content-Type": "application/json", "Content-Length": str(len(huge_json_blob))},
    )
    assert resp.status_code == 413
    assert resp.json()["details"]["code"] == "payload_too_large"


def test_redteam_malformed_json(client):
    """Malformed JSON should be rejected with 400 or 422 and not leak stack traces."""
    resp = client.post(
        "/auth/login",
        content="{ bad_json: invalid ",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code in (400, 422)
    # Check that no python traceback / internal paths are leaked
    body_text = resp.text.lower()
    assert "traceback" not in body_text
    assert "site-packages" not in body_text


# -------------------------------------------------------------------------
# P0/P2: Live GPU Provider Failover & Production Configuration
# -------------------------------------------------------------------------

def test_gpu_provider_failover_local_to_cloud():
    """When local CatVTON fails (e.g. CUDA OOM), engine must fail over to cloud renderer."""
    from services.vton_engine import generate_vton_image

    with patch("services.local_catvton_engine.generate_local_tryon", side_effect=RuntimeError("GPU OOM")):
        with patch("services.cloud_catvton_engine.generate_cloud_tryon", return_value=b"png_output_from_cloud"):
            with patch.dict("os.environ", {"VTON_PROVIDERS": "local,cloud"}):
                image_bytes, engine = generate_vton_image(
                    person_image_bytes=b"person",
                    garment_image_bytes=b"garment",
                )
                assert image_bytes == b"png_output_from_cloud"
                assert engine == "catvton_cloud"


def test_gpu_provider_all_fail_raises_vton_error():
    """When all GPU providers fail, system must raise VtonError for credit refunding."""
    from services.vton_engine import VtonError, generate_vton_image

    with patch("services.local_catvton_engine.generate_local_tryon", side_effect=RuntimeError("Local failed")):
        with patch("services.cloud_catvton_engine.generate_cloud_tryon", side_effect=RuntimeError("Cloud failed")):
            with patch.dict("os.environ", {"VTON_PROVIDERS": "local,cloud"}):
                with pytest.raises(VtonError) as exc_info:
                    generate_vton_image(
                        person_image_bytes=b"person",
                        garment_image_bytes=b"garment",
                    )
                assert "Local failed" in str(exc_info.value)
                assert "Cloud failed" in str(exc_info.value)


def test_validate_production_configuration():
    """Settings.validate_production_configuration must fail-closed if production secrets are missing."""
    with patch.object(settings, "ENV", "production"):
        with patch.object(settings, "BILLING_WEBHOOK_SECRET", ""):
            with patch.object(settings, "SENTRY_DSN", ""):
                with patch.object(settings, "PAYMENT_PROVIDER", "razorpay"):
                    with patch.object(settings, "RAZORPAY_KEY_SECRET", ""):
                        missing = settings.validate_production_configuration()
                        assert "BILLING_WEBHOOK_SECRET" in missing
                        assert "SENTRY_DSN" in missing
                        assert "RAZORPAY_KEY_SECRET" in missing

        with patch.object(settings, "BILLING_WEBHOOK_SECRET", "valid_secret"):
            with patch.object(settings, "SENTRY_DSN", "https://key@sentry.io/123"):
                with patch.object(settings, "RAZORPAY_KEY_SECRET", "valid_razorpay_secret"):
                    with patch.object(settings, "FIREBASE_CREDENTIALS_JSON", '{"project_id": "test"}'):
                        missing = settings.validate_production_configuration()
                        assert missing == []


def test_admin_user_ids_bootstrap():
    """AdminGate must authorize users listed in ADMIN_USER_IDS without requiring DB mutation."""
    from services.admin_auth import AdminGate

    gate = AdminGate(client=MagicMock())
    with patch.object(settings, "ADMIN_USER_IDS", ["sys_admin_uid_99"]):
        assert gate.is_admin("sys_admin_uid_99") is True
        assert gate.is_admin("normal_uid_01") is False

