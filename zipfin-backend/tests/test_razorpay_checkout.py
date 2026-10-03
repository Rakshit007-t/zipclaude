"""Unit and integration tests for Razorpay Standard Web Checkout.

Tests:
1. POST /api/create-order: validates minimum amount (>= 100 paise), returns 400 on invalid amount.
2. POST /api/create-order: calls Razorpay API and returns { order_id, amount, currency }.
3. POST /api/verify-payment: validates presence of order_id, payment_id, signature (400 on missing).
4. POST /api/verify-payment: validates signature mismatch (400 on invalid).
5. POST /api/verify-payment: returns success (200) when HMAC-SHA256 signature matches.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import pytest
from starlette.testclient import TestClient

from main import create_app


@pytest.fixture(scope="module")
def client() -> TestClient:
    app = create_app()
    return TestClient(app, raise_server_exceptions=False)


def test_create_order_minimum_amount_validation(client: TestClient) -> None:
    """Validate that amounts < 100 paise are rejected with 400."""
    response = client.post("/api/create-order", json={"amount": 50, "currency": "INR"})
    assert response.status_code == 400
    data = response.json()
    err_text = str(data.get("message") or data.get("detail") or "")
    assert "100" in err_text


def test_create_order_zero_or_negative_amount(client: TestClient) -> None:
    """Validate that zero or negative amounts return 400."""
    response = client.post("/api/create-order", json={"amount": 0, "currency": "INR"})
    assert response.status_code == 400

    response_neg = client.post("/api/create-order", json={"amount": -500, "currency": "INR"})
    assert response_neg.status_code == 400


def test_create_order_success(client: TestClient) -> None:
    """Validate order creation returns order_id, amount, and currency."""
    response = client.post(
        "/api/create-order",
        json={"amount": 50000, "currency": "INR", "receipt": "test_rcpt_001"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "order_id" in data
    assert data["order_id"].startswith("order_")
    assert data["amount"] == 50000
    assert data["currency"] == "INR"


def test_create_order_auth_failure_missing_keys(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    """Validate that missing credentials returns 401 Unauthorized."""
    monkeypatch.setenv("RAZORPAY_KEY_ID", "")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "")
    from core.config import settings
    monkeypatch.setattr(settings, "RAZORPAY_KEY_ID", "")
    monkeypatch.setattr(settings, "RAZORPAY_KEY_SECRET", "")

    response = client.post(
        "/api/create-order",
        json={"amount": 50000, "currency": "INR"},
    )
    assert response.status_code == 401


def test_verify_payment_missing_fields(client: TestClient) -> None:
    """Validate that missing fields return 400."""
    # Missing signature
    resp1 = client.post("/api/verify-payment", json={"razorpay_order_id": "order_123", "razorpay_payment_id": "pay_123"})
    assert resp1.status_code in (400, 422)

    # Empty strings
    resp2 = client.post(
        "/api/verify-payment",
        json={"razorpay_order_id": "", "razorpay_payment_id": "pay_123", "razorpay_signature": "sig_123"},
    )
    assert resp2.status_code == 400


def test_verify_payment_signature_mismatch(client: TestClient) -> None:
    """Validate that mismatched signature returns 400."""
    response = client.post(
        "/api/verify-payment",
        json={
            "razorpay_order_id": "order_test_123",
            "razorpay_payment_id": "pay_test_456",
            "razorpay_signature": "invalid_forged_signature_hex",
        },
    )
    assert response.status_code == 400
    data = response.json()
    err_text = str(data.get("message") or data.get("detail") or "").lower()
    assert "verification failed" in err_text or "mismatch" in err_text


def test_verify_payment_signature_success(client: TestClient) -> None:
    """Validate that correct HMAC-SHA256 signature returns 200 and success status."""
    order_id = "order_test_99999"
    payment_id = "pay_test_88888"
    secret = os.getenv("RAZORPAY_KEY_SECRET", "9rxqpfYc3cnKDxHi2Xhz9r67")

    msg = f"{order_id}|{payment_id}".encode("utf-8")
    expected_sig = hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()

    response = client.post(
        "/api/verify-payment",
        json={
            "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id,
            "razorpay_signature": expected_sig,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "success"
    assert data.get("order_id") == order_id
    assert data.get("payment_id") == payment_id
