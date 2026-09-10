"""Phase 3A: Server-Authoritative Orders + Real Payment Foundation Test Suite.

Validates the security invariants and requirements for Phase 3A:
- ORDER-01: Authenticated customer can create a valid checkout order.
- ORDER-02: Unauthenticated user cannot create an order (401 Unauthorized).
- ORDER-03: Customer A cannot retrieve Customer B's order (403 Forbidden).
- ORDER-04: Client-supplied total cannot alter server-calculated amount.
- ORDER-05: Client-supplied unit price cannot alter server price.
- ORDER-06: Client-supplied seller ID cannot override the real seller associated with a product.
- ORDER-07: Invalid product cannot be purchased (404 Not Found).
- ORDER-08: Inactive/unavailable product cannot be purchased (400 Bad Request).
- ORDER-09: Duplicate X-Idempotency-Key does not create duplicate orders/payment attempts.
- ORDER-10: Different idempotency keys can create legitimate separate orders.
- PAYMENT-01: Server creates payment-provider order using server-calculated amount.
- PAYMENT-02: Valid webhook signature is accepted.
- PAYMENT-03: Invalid webhook signature is rejected (400 Bad Request).
- PAYMENT-04: Missing webhook signature is rejected (400 Bad Request).
- PAYMENT-05: Webhook replay/idempotency prevents duplicate processing.
- PAYMENT-06: Frontend cannot mark an order as paid.
- PAYMENT-07: Payment failure does not mark order as PAID.
- PAYMENT-08: Successful verified payment transitions order to PAID.
- PAYMENT-09: Payment responses do not expose secrets.
- PAYMENT-10: Payment/order errors do not expose stack traces or sensitive internal information.
- PAYMENT-11: Existing Phase 1A authorization invariants remain intact.
- PAYMENT-12: Existing Phase 1B media privacy remains intact.
- PAYMENT-13: Existing Phase 2 infrastructure tests remain intact.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from typing import Any
import pytest
from fastapi import status
from fastapi.testclient import TestClient

from core.config import settings
from core.redis_client import get_redis_client
from main import app
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.order_service import (
    Order,
    OrderService,
    OrderStatus,
    get_order_service,
    parse_price_to_paise,
)
from services.product_repository import SellerProductRepository, get_product_repository
from tests.conftest import FakeFirestore

# ── Test Users ────────────────────────────────────────────────────────────────
CUSTOMER_A = AuthenticatedUser(uid="cust_alice", email="alice@customer.com")
CUSTOMER_B = AuthenticatedUser(uid="cust_bob", email="bob@customer.com")
SELLER_A_USER = AuthenticatedUser(uid="seller_alpha", email="alpha@seller.com")
SELLER_B_USER = AuthenticatedUser(uid="seller_beta", email="beta@seller.com")


# ── Test Fixtures ─────────────────────────────────────────────────────────────
@pytest.fixture
def fake_db() -> FakeFirestore:
    db = FakeFirestore()

    # Seed catalog products in seller_products
    db.seed("seller_products", "prod_cashmere", {
        "product_id": "prod_cashmere",
        "seller_uid": "seller_alpha",
        "title": "Cashmere Oversized Sweater",
        "price": "4999.00",
        "currency": "INR",
        "status": "active",
    })

    db.seed("seller_products", "prod_silk_scarf", {
        "product_id": "prod_silk_scarf",
        "seller_uid": "seller_beta",
        "title": "Mulberry Silk Scarf",
        "price": "1499.50",
        "currency": "INR",
        "status": "active",
    })

    db.seed("seller_products", "prod_inactive", {
        "product_id": "prod_inactive",
        "seller_uid": "seller_alpha",
        "title": "Discontinued Jacket",
        "price": "2999.00",
        "currency": "INR",
        "status": "archived",
    })

    return db


@pytest.fixture
def fake_product_repo(fake_db: FakeFirestore) -> SellerProductRepository:
    repo = SellerProductRepository()
    repo._client = fake_db
    return repo


@pytest.fixture
def order_service(fake_db: FakeFirestore, fake_product_repo: SellerProductRepository) -> OrderService:
    # Clear test Redis keys
    try:
        r = get_redis_client()
        r.flushdb()
    except Exception:
        pass
    return OrderService(db=fake_db, product_repo=fake_product_repo)


@pytest.fixture
def client(fake_db: FakeFirestore, fake_product_repo: SellerProductRepository, order_service: OrderService) -> TestClient:
    app.dependency_overrides[get_order_service] = lambda: order_service
    app.dependency_overrides[get_product_repository] = lambda: fake_product_repo
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER_A

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


# ── Helpers ───────────────────────────────────────────────────────────────────
def _sign_webhook(raw_payload: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), raw_payload, hashlib.sha256).hexdigest()


# ── ORDER TESTS ───────────────────────────────────────────────────────────────

def test_order_01_authenticated_customer_checkout_valid_order(client: TestClient):
    """ORDER-01: Authenticated customer can create a valid checkout order."""
    payload = {
        "items": [
            {"product_id": "prod_cashmere", "quantity": 2},
            {"product_id": "prod_silk_scarf", "quantity": 1},
        ]
    }
    resp = client.post("/orders/checkout", json=payload)
    assert resp.status_code == status.HTTP_201_CREATED
    data = resp.json()["data"]

    assert data["order_id"].startswith("ord_")
    assert data["status"] == OrderStatus.PENDING_PAYMENT.value
    assert data["currency"] == "INR"
    assert data["item_count"] == 2
    # Cashmere: 4999.00 * 2 = 9998.00 (999800 paise)
    # Scarf: 1499.50 * 1 = 1499.50 (149950 paise)
    # Total: 11497.50 (1149750 paise)
    assert data["amount_paise"] == 1149750
    assert data["amount_rupees"] == 11497.50
    assert data["razorpay_order_id"] is not None


def test_order_02_unauthenticated_user_cannot_create_order():
    """ORDER-02: Unauthenticated user cannot create an order (401 Unauthorized)."""
    # Remove auth override
    app.dependency_overrides.clear()
    with TestClient(app) as unauth_client:
        resp = unauth_client.post("/orders/checkout", json={"items": [{"product_id": "prod_cashmere", "quantity": 1}]})
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED


def test_order_03_customer_a_cannot_retrieve_customer_b_order(client: TestClient):
    """ORDER-03: Customer A cannot retrieve Customer B's order (403 Forbidden)."""
    # 1. Bob creates an order
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER_B
    bob_resp = client.post("/orders/checkout", json={"items": [{"product_id": "prod_cashmere", "quantity": 1}]})
    assert bob_resp.status_code == status.HTTP_201_CREATED
    bob_order_id = bob_resp.json()["data"]["order_id"]

    # 2. Alice tries to read Bob's order
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER_A
    alice_resp = client.get(f"/orders/{bob_order_id}")
    assert alice_resp.status_code == status.HTTP_403_FORBIDDEN
    assert "permission" in alice_resp.text.lower()


def test_order_04_client_supplied_total_cannot_alter_server_calculated_amount(client: TestClient):
    """ORDER-04: Client-supplied total cannot alter server-calculated amount."""
    # Attacker attempts to tamper with total in payload
    tampered_payload = {
        "items": [{"product_id": "prod_cashmere", "quantity": 1}],
        "total": 1.0,
        "total_paise": 100,
        "subtotal": 1.0,
        "amount": 1.0,
    }
    resp = client.post("/orders/checkout", json=tampered_payload)
    assert resp.status_code == status.HTTP_201_CREATED
    data = resp.json()["data"]

    # Must strictly match catalog price: 4999.00 = 499900 paise, NOT 100 paise
    assert data["amount_paise"] == 499900
    assert data["amount_rupees"] == 4999.00


def test_order_05_client_supplied_unit_price_cannot_alter_server_price(client: TestClient):
    """ORDER-05: Client-supplied unit price cannot alter server price."""
    tampered_payload = {
        "items": [
            {
                "product_id": "prod_cashmere",
                "quantity": 1,
                "price": 0.05,
                "unit_price": 0.05,
                "unit_price_paise": 5,
            }
        ]
    }
    resp = client.post("/orders/checkout", json=tampered_payload)
    assert resp.status_code == status.HTTP_201_CREATED
    data = resp.json()["data"]
    assert data["amount_paise"] == 499900


def test_order_06_client_supplied_seller_id_cannot_override_real_seller(client: TestClient, order_service: OrderService):
    """ORDER-06: Client-supplied seller ID cannot override real seller associated with product."""
    tampered_payload = {
        "items": [
            {
                "product_id": "prod_cashmere",
                "quantity": 1,
                "seller_uid": "attacker_seller_id",
            }
        ]
    }
    resp = client.post("/orders/checkout", json=tampered_payload)
    assert resp.status_code == status.HTTP_201_CREATED
    order_id = resp.json()["data"]["order_id"]

    order = order_service.get_order(order_id)
    assert order is not None
    # Must be seller_alpha from catalog, not attacker_seller_id
    assert order.items[0]["seller_uid"] == "seller_alpha"
    assert "attacker_seller_id" not in order.seller_uids


def test_order_07_invalid_product_cannot_be_purchased(client: TestClient):
    """ORDER-07: Invalid product cannot be purchased (404 Not Found)."""
    payload = {"items": [{"product_id": "nonexistent_sku_123", "quantity": 1}]}
    resp = client.post("/orders/checkout", json=payload)
    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_order_08_inactive_product_cannot_be_purchased(client: TestClient):
    """ORDER-08: Inactive/unavailable product cannot be purchased (400 Bad Request)."""
    payload = {"items": [{"product_id": "prod_inactive", "quantity": 1}]}
    resp = client.post("/orders/checkout", json=payload)
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert "inactive or unavailable" in resp.text.lower()


def test_order_09_duplicate_idempotency_key_does_not_create_duplicate_order(client: TestClient):
    """ORDER-09: Duplicate X-Idempotency-Key returns existing order without creating duplicates."""
    payload = {"items": [{"product_id": "prod_cashmere", "quantity": 1}]}
    headers = {"X-Idempotency-Key": "checkout_idemp_key_100"}

    resp1 = client.post("/orders/checkout", json=payload, headers=headers)
    assert resp1.status_code == status.HTTP_201_CREATED
    order_id_1 = resp1.json()["data"]["order_id"]

    resp2 = client.post("/orders/checkout", json=payload, headers=headers)
    assert resp2.status_code == status.HTTP_201_CREATED
    order_id_2 = resp2.json()["data"]["order_id"]

    # Must return exact same order
    assert order_id_1 == order_id_2


def test_order_10_different_idempotency_keys_create_separate_orders(client: TestClient):
    """ORDER-10: Different idempotency keys create legitimate separate orders."""
    payload = {"items": [{"product_id": "prod_cashmere", "quantity": 1}]}

    resp1 = client.post("/orders/checkout", json=payload, headers={"X-Idempotency-Key": "key_order_1"})
    assert resp1.status_code == status.HTTP_201_CREATED
    order_id_1 = resp1.json()["data"]["order_id"]

    resp2 = client.post("/orders/checkout", json=payload, headers={"X-Idempotency-Key": "key_order_2"})
    assert resp2.status_code == status.HTTP_201_CREATED
    order_id_2 = resp2.json()["data"]["order_id"]

    assert order_id_1 != order_id_2


# ── PAYMENT TESTS ─────────────────────────────────────────────────────────────

def test_payment_01_server_creates_payment_provider_order_with_server_amount(client: TestClient):
    """PAYMENT-01: Server creates payment-provider order using server-calculated amount."""
    payload = {"items": [{"product_id": "prod_silk_scarf", "quantity": 2}]}
    resp = client.post("/orders/checkout", json=payload)
    assert resp.status_code == status.HTTP_201_CREATED
    data = resp.json()["data"]

    # 1499.50 * 2 = 2999.00 = 299900 paise
    assert data["amount_paise"] == 299900
    assert data["razorpay_order_id"].startswith("order_")


def test_payment_02_valid_webhook_signature_is_accepted(client: TestClient, order_service: OrderService, monkeypatch: pytest.MonkeyPatch):
    """PAYMENT-02: Valid webhook signature is accepted and processes event."""
    test_secret = "test_webhook_secret_xyz123"
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", test_secret)

    # 1. Create order
    order_resp = client.post("/orders/checkout", json={"items": [{"product_id": "prod_cashmere", "quantity": 1}]})
    order_id = order_resp.json()["data"]["order_id"]

    # 2. Build verified webhook payload
    webhook_event = {
        "event": "order.paid",
        "payload": {
            "order": {
                "entity": {
                    "receipt": order_id,
                    "id": "order_mock_test_1",
                    "amount": 499900,
                }
            },
            "payment": {
                "entity": {
                    "id": "pay_mock_test_99",
                    "amount": 499900,
                    "status": "captured",
                }
            },
        },
    }
    raw_body = json.dumps(webhook_event).encode("utf-8")
    sig = _sign_webhook(raw_body, test_secret)

    resp = client.post(
        "/payments/webhook",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Razorpay-Signature": sig},
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["status"] == "ok"
    assert resp.json()["result"] == "marked_paid"

    # Order should now be PAID
    order = order_service.get_order(order_id)
    assert order.status == OrderStatus.PAID.value
    assert order.payment_id == "pay_mock_test_99"


def test_payment_03_invalid_webhook_signature_is_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """PAYMENT-03: Invalid webhook signature is rejected with 400 Bad Request."""
    test_secret = "test_webhook_secret_xyz123"
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", test_secret)

    raw_body = json.dumps({"event": "payment.captured"}).encode("utf-8")
    invalid_sig = "tampered_signature_string"

    resp = client.post(
        "/payments/webhook",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Razorpay-Signature": invalid_sig},
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert "invalid" in resp.text.lower()


def test_payment_04_missing_webhook_signature_is_rejected(client: TestClient):
    """PAYMENT-04: Missing webhook signature is rejected with 400 Bad Request."""
    raw_body = json.dumps({"event": "payment.captured"}).encode("utf-8")
    resp = client.post(
        "/payments/webhook",
        content=raw_body,
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_payment_05_webhook_replay_idempotency(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """PAYMENT-05: Webhook replay/idempotency prevents duplicate processing."""
    test_secret = "test_webhook_secret_xyz123"
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", test_secret)

    order_resp = client.post("/orders/checkout", json={"items": [{"product_id": "prod_cashmere", "quantity": 1}]})
    order_id = order_resp.json()["data"]["order_id"]

    webhook_event = {
        "event": "order.paid",
        "payload": {
            "order": {
                "entity": {
                    "receipt": order_id,
                    "id": "order_mock_test_1",
                    "amount": 499900,
                }
            },
            "payment": {
                "entity": {
                    "id": "pay_mock_test_replay",
                    "amount": 499900,
                }
            },
        },
    }
    raw_body = json.dumps(webhook_event).encode("utf-8")
    sig = _sign_webhook(raw_body, test_secret)
    headers = {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": sig,
        "X-Razorpay-Event-Id": "evt_unique_12345",
    }

    # First delivery
    resp1 = client.post("/payments/webhook", content=raw_body, headers=headers)
    assert resp1.status_code == status.HTTP_200_OK
    assert resp1.json()["result"] == "marked_paid"

    # Replayed delivery
    resp2 = client.post("/payments/webhook", content=raw_body, headers=headers)
    assert resp2.status_code == status.HTTP_200_OK
    assert resp2.json()["result"] == "already_processed"


def test_payment_06_frontend_cannot_mark_order_paid(client: TestClient, order_service: OrderService):
    """PAYMENT-06: Frontend cannot send status='paid' or alter order status."""
    # 1. Attacker tries to pass status='PAID' in checkout request
    payload = {
        "items": [{"product_id": "prod_cashmere", "quantity": 1}],
        "status": "PAID",
    }
    resp = client.post("/orders/checkout", json=payload)
    assert resp.status_code == status.HTTP_201_CREATED
    order_id = resp.json()["data"]["order_id"]

    order = order_service.get_order(order_id)
    assert order.status == OrderStatus.PENDING_PAYMENT.value

    # 2. Verify no PUT/PATCH endpoint exists to set order to PAID
    resp_put = client.put(f"/orders/{order_id}", json={"status": "PAID"})
    assert resp_put.status_code in {status.HTTP_404_NOT_FOUND, status.HTTP_405_METHOD_NOT_ALLOWED}


def test_payment_07_payment_failure_does_not_mark_order_paid(client: TestClient, order_service: OrderService, monkeypatch: pytest.MonkeyPatch):
    """PAYMENT-07: Payment failure marks order as PAYMENT_FAILED, never PAID."""
    test_secret = "test_webhook_secret_xyz123"
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", test_secret)

    order_resp = client.post("/orders/checkout", json={"items": [{"product_id": "prod_cashmere", "quantity": 1}]})
    order_id = order_resp.json()["data"]["order_id"]

    fail_event = {
        "event": "payment.failed",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_failed_123",
                    "notes": {"zipright_order_id": order_id},
                    "error_description": "Card was declined by bank",
                }
            }
        },
    }
    raw_body = json.dumps(fail_event).encode("utf-8")
    sig = _sign_webhook(raw_body, test_secret)

    resp = client.post(
        "/payments/webhook",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Razorpay-Signature": sig},
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["result"] == "marked_failed"

    order = order_service.get_order(order_id)
    assert order.status == OrderStatus.PAYMENT_FAILED.value
    assert order.status != OrderStatus.PAID.value


def test_payment_08_successful_payment_transitions_order_to_paid(client: TestClient, order_service: OrderService, monkeypatch: pytest.MonkeyPatch):
    """PAYMENT-08: Successful verified payment transitions order to PAID."""
    test_secret = "test_webhook_secret_xyz123"
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", test_secret)

    order_resp = client.post("/orders/checkout", json={"items": [{"product_id": "prod_silk_scarf", "quantity": 1}]})
    order_id = order_resp.json()["data"]["order_id"]

    capture_event = {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_cap_555",
                    "notes": {"zipright_order_id": order_id},
                    "amount": 149950,
                }
            }
        },
    }
    raw_body = json.dumps(capture_event).encode("utf-8")
    sig = _sign_webhook(raw_body, test_secret)

    resp = client.post(
        "/payments/webhook",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Razorpay-Signature": sig},
    )
    assert resp.status_code == status.HTTP_200_OK

    order = order_service.get_order(order_id)
    assert order.status == OrderStatus.PAID.value
    assert order.paid_at is not None
    assert order.payment_id == "pay_cap_555"


def test_payment_09_payment_responses_do_not_expose_secrets(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """PAYMENT-09: Payment responses do not expose secrets or sensitive credentials."""
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "super_secret_key_123456789")
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", "super_webhook_secret_987654321")

    payload = {"items": [{"product_id": "prod_cashmere", "quantity": 1}]}
    resp = client.post("/orders/checkout", json=payload)
    resp_text = resp.text

    assert "super_secret_key_123456789" not in resp_text
    assert "super_webhook_secret_987654321" not in resp_text
    assert "secret" not in resp.json()["data"]


def test_payment_10_errors_do_not_expose_stack_traces_or_internal_info(client: TestClient):
    """PAYMENT-10: Payment/order errors do not expose stack traces or internal DB info."""
    # Send malformed payload
    resp = client.post("/orders/checkout", json={"items": [{"product_id": "", "quantity": -5}]})
    assert resp.status_code in {status.HTTP_422_UNPROCESSABLE_ENTITY, status.HTTP_400_BAD_REQUEST}
    resp_text = resp.text.lower()
    assert "traceback" not in resp_text
    assert "sqlite" not in resp_text
    assert "firestore" not in resp_text
    assert "exception" not in resp_text


def test_payment_11_seller_tenant_isolation_on_order_items(client: TestClient):
    """ORDER / PAYMENT: Seller A only sees Seller A line items; Seller B only sees Seller B items."""
    # Order contains an item from seller_alpha and an item from seller_beta
    payload = {
        "items": [
            {"product_id": "prod_cashmere", "quantity": 1},    # seller_alpha
            {"product_id": "prod_silk_scarf", "quantity": 2},   # seller_beta
        ]
    }
    order_resp = client.post("/orders/checkout", json=payload)
    order_id = order_resp.json()["data"]["order_id"]

    # 1. Seller Alpha views the order -> only sees cashmere item
    app.dependency_overrides[get_current_user] = lambda: SELLER_A_USER
    resp_a = client.get(f"/orders/{order_id}")
    assert resp_a.status_code == status.HTTP_200_OK
    items_a = resp_a.json()["data"]["items"]
    assert len(items_a) == 1
    assert items_a[0]["seller_uid"] == "seller_alpha"
    assert items_a[0]["product_id"] == "prod_cashmere"

    # 2. Seller Beta views the order -> only sees silk scarf item
    app.dependency_overrides[get_current_user] = lambda: SELLER_B_USER
    resp_b = client.get(f"/orders/{order_id}")
    assert resp_b.status_code == status.HTTP_200_OK
    items_b = resp_b.json()["data"]["items"]
    assert len(items_b) == 1
    assert items_b[0]["seller_uid"] == "seller_beta"
    assert items_b[0]["product_id"] == "prod_silk_scarf"

    # 3. Third-party seller Charlie views the order -> 403 Forbidden
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(uid="seller_charlie", email="charlie@seller.com")
    resp_c = client.get(f"/orders/{order_id}")
    assert resp_c.status_code == status.HTTP_403_FORBIDDEN


def test_price_parsing_utility():
    """Verify parse_price_to_paise handles multiple numeric and string price formats accurately."""
    assert parse_price_to_paise(100) == 10000
    assert parse_price_to_paise(49.99) == 4999
    assert parse_price_to_paise("49.99") == 4999
    assert parse_price_to_paise("₹1,499.50") == 149950
    assert parse_price_to_paise("1499") == 149900
