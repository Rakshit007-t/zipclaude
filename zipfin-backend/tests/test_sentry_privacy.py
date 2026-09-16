"""Focused tests for privacy-safe Sentry integration (Phase 5B).

Verifies:
- Sentry initializes when DSN is provided, gracefully no-ops when absent.
- Dev, staging, and production environment/release tagging.
- Sensitive headers scrubbing (Authorization, Cookie, Secrets, Signatures, Keys).
- Sensitive request fields redaction (biometrics, fit measurements, payment data, tokens).
- User PII removal (email, phone, name, IP) and non-reversible user ID hashing.
- Breadcrumb sanitization (tokenized URLs, query strings).
- Tracing and profiling disabled (traces_sample_rate=0.0).
- Unhandled exceptions are safely captured with request_id without exposing internals.
"""

from __future__ import annotations

import os
from unittest.mock import patch, MagicMock
import pytest
from starlette.testclient import TestClient

from core.sentry import (
    init_sentry,
    before_send,
    before_breadcrumb,
    hash_user_id,
    sanitize_headers,
    sanitize_query_string,
    sanitize_url,
    sanitize_value,
    is_sensitive_key,
)
from core.config import settings


# ── 1. Initialization & Configuration Tests ───────────────────────────────────

def test_sentry_init_skips_when_dsn_empty():
    """When SENTRY_DSN is unset/empty, Sentry must not initialize and return False."""
    with patch.object(settings, "SENTRY_DSN", ""):
        result = init_sentry()
        assert result is False


def test_sentry_init_enables_when_dsn_provided():
    """When SENTRY_DSN is provided, Sentry initializes with error-only monitoring."""
    with patch.object(settings, "SENTRY_DSN", "https://public_key@sentry.io/123456"):
        with patch("sentry_sdk.init") as mock_init:
            result = init_sentry()
            assert result is True
            assert mock_init.called

            kwargs = mock_init.call_args[1]
            assert kwargs["dsn"] == "https://public_key@sentry.io/123456"
            assert kwargs["send_default_pii"] is False
            assert kwargs["traces_sample_rate"] == 0.0
            assert kwargs["profiles_sample_rate"] == 0.0
            assert kwargs["enable_tracing"] is False
            assert kwargs["before_send"] is before_send
            assert kwargs["before_breadcrumb"] is before_breadcrumb


@pytest.mark.parametrize("env_name", ["development", "staging", "production"])
def test_sentry_environment_tagging(env_name: str):
    """Sentry configuration respects the configured environment."""
    with patch.object(settings, "SENTRY_DSN", "https://key@sentry.io/1"):
        with patch.object(settings, "SENTRY_ENVIRONMENT", env_name):
            with patch.object(settings, "SENTRY_RELEASE", f"zipright-backend@{env_name}"):
                with patch("sentry_sdk.init") as mock_init:
                    init_sentry()
                    kwargs = mock_init.call_args[1]
                    assert kwargs["environment"] == env_name
                    assert kwargs["release"] == f"zipright-backend@{env_name}"


# ── 2. Privacy Scrubber: Headers Sanitization ─────────────────────────────────

def test_sensitive_headers_scrubbed():
    """All auth, cookie, secret, signature, and key headers must be redacted."""
    headers = {
        "authorization": "Bearer secret-firebase-id-token-xyz",
        "cookie": "session_id=super_secret_cookie_value",
        "set-cookie": "session_id=deleted; path=/",
        "x-wallet-topup-secret": "super-operator-secret",
        "x-razorpay-signature": "razorpay-hmac-signature-abc",
        "x-csrf-token": "csrf-secret-token",
        "x-api-key": "secret-gemini-key-123",
        "content-type": "application/json",
        "accept": "*/*",
        "user-agent": "Mozilla/5.0",
    }

    sanitized = sanitize_headers(headers)

    # Sensitive headers must be [REDACTED]
    assert sanitized["authorization"] == "[REDACTED]"
    assert sanitized["cookie"] == "[REDACTED]"
    assert sanitized["set-cookie"] == "[REDACTED]"
    assert sanitized["x-wallet-topup-secret"] == "[REDACTED]"
    assert sanitized["x-razorpay-signature"] == "[REDACTED]"
    assert sanitized["x-csrf-token"] == "[REDACTED]"
    assert sanitized["x-api-key"] == "[REDACTED]"

    # Non-sensitive headers must remain intact
    assert sanitized["content-type"] == "application/json"
    assert sanitized["accept"] == "*/*"
    assert sanitized["user-agent"] == "Mozilla/5.0"


# ── 3. Privacy Scrubber: Field & Payload Sanitization ─────────────────────────

def test_sensitive_field_detection():
    """Sensitive field matcher identifies all protected categories."""
    assert is_sensitive_key("password")
    assert is_sensitive_key("current_password")
    assert is_sensitive_key("auth_token")
    assert is_sensitive_key("refresh_token")
    assert is_sensitive_key("razorpay_payment_id")
    assert is_sensitive_key("razorpay_signature")
    assert is_sensitive_key("fit_profiles")
    assert is_sensitive_key("smart_fit_scan")
    assert is_sensitive_key("bust")
    assert is_sensitive_key("waist")
    assert is_sensitive_key("hips")
    assert is_sensitive_key("biometric_data")
    assert is_sensitive_key("face_crop")
    assert is_sensitive_key("avatar_image")
    assert is_sensitive_key("email")
    assert is_sensitive_key("phone")
    assert is_sensitive_key("chat_content")
    assert not is_sensitive_key("product_id")
    assert not is_sensitive_key("brand_name")
    assert not is_sensitive_key("category")


def test_sensitive_payload_scrubbing():
    """Nested payload scrubbing recursively redacts private data."""
    payload = {
        "product_id": "prod_123",
        "category": "dresses",
        "credentials": {
            "password": "my_secret_password",
            "firebase_token": "token_abc_123",
        },
        "customer_fit": {
            "bust": 92.5,
            "waist": 74.0,
            "hips": 98.0,
            "body_shape": "hourglass",
        },
        "payment": {
            "razorpay_order_id": "order_789",
            "razorpay_signature": "sig_xyz_hidden",
        },
        "photo_url": "https://firebasestorage.googleapis.com/v0/b/bucket/o/users%2F123%2Ftryon.png?alt=media&token=private-token-123",
    }

    sanitized = sanitize_value("body", payload)

    assert sanitized["product_id"] == "prod_123"
    assert sanitized["category"] == "dresses"
    assert sanitized["credentials"] == "[REDACTED]"
    assert sanitized["customer_fit"]["bust"] == "[REDACTED]"
    assert sanitized["customer_fit"]["waist"] == "[REDACTED]"
    assert sanitized["customer_fit"]["hips"] == "[REDACTED]"
    assert sanitized["customer_fit"]["body_shape"] == "[REDACTED]"
    assert sanitized["payment"]["razorpay_signature"] == "[REDACTED]"
    assert sanitized["photo_url"] == "[REDACTED]" or "token=[REDACTED]" in sanitized["photo_url"]


# ── 4. Privacy Scrubber: User PII Removal & ID Hashing ─────────────────────────

def test_user_pii_completely_stripped():
    """Event user object must not retain email, phone, name, or raw ID."""
    raw_user_id = "user_firebase_uid_99887766"
    event = {
        "user": {
            "id": raw_user_id,
            "email": "customer@example.com",
            "phone": "+1234567890",
            "username": "fashionista99",
            "name": "Jane Doe",
            "ip_address": "203.0.113.195",
        }
    }

    clean_event = before_send(event, {})

    assert "email" not in clean_event["user"]
    assert "phone" not in clean_event["user"]
    assert "username" not in clean_event["user"]
    assert "name" not in clean_event["user"]
    assert "ip_address" not in clean_event["user"]

    # ID must be hashed non-reversibly
    hashed_id = clean_event["user"]["id"]
    assert hashed_id != raw_user_id
    assert hashed_id == hash_user_id(raw_user_id)
    assert len(hashed_id) == 16


# ── 5. URL & Query Parameter Sanitization ─────────────────────────────────────

def test_query_string_and_url_sanitization():
    """Sensitive query parameters must be sanitized in URLs."""
    url = "https://api.zipright.ai/verify?token=secret123&code=auth456&category=formal&sig=hmac789"
    sanitized = sanitize_url(url)

    assert "token=[REDACTED]" in sanitized
    assert "code=[REDACTED]" in sanitized
    assert "sig=[REDACTED]" in sanitized
    assert "category=formal" in sanitized


# ── 6. Full Event Scrubber (before_send) ──────────────────────────────────────

def test_before_send_complete_event():
    """Full Sentry event with request, headers, user, and contexts is scrubbed."""
    event = {
        "request": {
            "url": "https://api.zipright.ai/checkout?token=xyz",
            "headers": {
                "Authorization": "Bearer secret-token",
                "X-Razorpay-Signature": "sig-secret",
                "User-Agent": "ZipRIGHT-App",
            },
            "cookies": "auth_cookie=secret_123",
            "data": {
                "bust": 90,
                "credit_card": "4111222233334444",
                "brand": "Nike",
            },
        },
        "user": {
            "id": "customer_1",
            "email": "user@zipright.ai",
        },
        "extra": {
            "razorpay_key_secret": "rzp_secret_dont_log",
            "debug_label": "checkout_flow",
        },
    }

    cleaned = before_send(event, {})

    # Request headers scrubbed
    assert cleaned["request"]["headers"]["Authorization"] == "[REDACTED]"
    assert cleaned["request"]["headers"]["X-Razorpay-Signature"] == "[REDACTED]"
    assert cleaned["request"]["headers"]["User-Agent"] == "ZipRIGHT-App"
    assert cleaned["request"]["cookies"] == "[REDACTED]"
    assert "token=[REDACTED]" in cleaned["request"]["url"]

    # Request body scrubbed
    assert cleaned["request"]["data"]["bust"] == "[REDACTED]"
    assert cleaned["request"]["data"]["credit_card"] == "[REDACTED]"
    assert cleaned["request"]["data"]["brand"] == "Nike"

    # User scrubbed
    assert "email" not in cleaned["user"]
    assert cleaned["user"]["id"] == hash_user_id("customer_1")

    # Extra scrubbed
    assert cleaned["extra"]["razorpay_key_secret"] == "[REDACTED]"
    assert cleaned["extra"]["debug_label"] == "checkout_flow"


# ── 7. Exception Handler Sentry Capture Integration ───────────────────────────

def test_unhandled_exception_captured_and_preserves_error_response():
    """FastAPI unhandled exception handler captures to Sentry and preserves 500 response."""
    import asyncio
    import json
    from starlette.requests import Request

    # Create dummy ASGI scope
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/tryon",
        "headers": [(b"x-request-id", b"req-test-sentry-123")],
    }
    request = Request(scope)
    request.state.request_id = "req-test-sentry-123"

    test_exc = RuntimeError("Simulated unexpected crash for Sentry audit.")

    with patch("sentry_sdk.capture_exception") as mock_capture:
        # Import the actual unhandled exception handler registered on main.py app
        from main import app
        handler = app.exception_handlers[Exception]
        response = asyncio.run(handler(request, test_exc))

        # 1. Must return standard 500 error response
        assert response.status_code == 500
        body = json.loads(response.body.decode("utf-8"))
        assert body["isValid"] is False
        assert body["message"] == "Internal server error."
        assert body["data"] is None

        # 2. Must not expose internal error message or stack trace to client
        raw_text = response.body.decode("utf-8")
        assert "Simulated unexpected crash" not in raw_text
        assert "RuntimeError" not in raw_text

        # 3. Sentry capture must have been called with the exception
        assert mock_capture.called
        captured_exc = mock_capture.call_args[0][0]
        assert captured_exc is test_exc

