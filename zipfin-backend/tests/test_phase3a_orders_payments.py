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
from fastapi import HTTPException, status
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

    # Seed seller profiles
    db.seed("sellers", "seller_alpha", {
        "uid": "seller_alpha",
        "store_name": "Alpha Boutique",
        "status": "active",
    })
    db.seed("sellers", "seller_beta", {
        "uid": "seller_beta",
        "store_name": "Beta Silk",
        "status": "active",
    })
    db.seed("sellers", "seller_pending", {
        "uid": "seller_pending",
        "store_name": "Pending Boutique",
        "status": "pending",
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
    from services.seller_repository import SellerRepository, get_seller_repository
    fake_seller_repo = SellerRepository(client=fake_db)

    app.dependency_overrides[get_order_service] = lambda: order_service
    app.dependency_overrides[get_product_repository] = lambda: fake_product_repo
    app.dependency_overrides[get_seller_repository] = lambda: fake_seller_repo
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
    order_data = order_resp.json()["data"]
    order_id = order_data["order_id"]
    razorpay_order_id = order_data["razorpay_order_id"]

    # 2. Build verified webhook payload
    webhook_event = {
        "event": "order.paid",
        "payload": {
            "order": {
                "entity": {
                    "receipt": order_id,
                    "id": razorpay_order_id,
                    "amount": 499900,
                    "currency": "INR",
                }
            },
            "payment": {
                "entity": {
                    "id": "pay_mock_test_99",
                    "order_id": razorpay_order_id,
                    "amount": 499900,
                    "currency": "INR",
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
    order_data = order_resp.json()["data"]
    order_id = order_data["order_id"]
    razorpay_order_id = order_data["razorpay_order_id"]

    webhook_event = {
        "event": "order.paid",
        "payload": {
            "order": {
                "entity": {
                    "receipt": order_id,
                    "id": razorpay_order_id,
                    "amount": 499900,
                    "currency": "INR",
                }
            },
            "payment": {
                "entity": {
                    "id": "pay_mock_test_replay",
                    "order_id": razorpay_order_id,
                    "amount": 499900,
                    "currency": "INR",
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
    order_data = order_resp.json()["data"]
    order_id = order_data["order_id"]
    razorpay_order_id = order_data["razorpay_order_id"]

    fail_event = {
        "event": "payment.failed",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_failed_123",
                    "order_id": razorpay_order_id,
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
    order_data = order_resp.json()["data"]
    order_id = order_data["order_id"]
    razorpay_order_id = order_data["razorpay_order_id"]

    capture_event = {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_cap_555",
                    "order_id": razorpay_order_id,
                    "notes": {"zipright_order_id": order_id},
                    "amount": 149950,
                    "currency": "INR",
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


# ── PHASE 3A-1: PAYSEC SECURITY HARDENING TESTS ─────────────────────────────

def test_paysec_01_valid_amount_equals_order_total_succeeds(client: TestClient, order_service: OrderService, monkeypatch: pytest.MonkeyPatch):
    """PAYSEC-01: Valid webhook amount exactly equals order total -> payment succeeds and marks order PAID."""
    test_secret = "test_webhook_sec_1"
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", test_secret)

    order_resp = client.post("/orders/checkout", json={"items": [{"product_id": "prod_cashmere", "quantity": 1}]})
    data = order_resp.json()["data"]
    order_id = data["order_id"]
    provider_oid = data["razorpay_order_id"]
    total_paise = data["amount_paise"]

    webhook_event = {
        "event": "order.paid",
        "payload": {
            "order": {"entity": {"id": provider_oid, "receipt": order_id, "amount": total_paise, "currency": "INR"}},
            "payment": {"entity": {"id": "pay_sec_01", "order_id": provider_oid, "amount": total_paise, "currency": "INR"}},
        },
    }
    raw_body = json.dumps(webhook_event).encode("utf-8")
    sig = _sign_webhook(raw_body, test_secret)

    resp = client.post("/payments/webhook", content=raw_body, headers={"Content-Type": "application/json", "X-Razorpay-Signature": sig})
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["result"] == "marked_paid"

    order = order_service.get_order(order_id)
    assert order.status == OrderStatus.PAID.value
    assert order.paid_at is not None


def test_paysec_02_webhook_amount_lower_than_order_total_rejected(client: TestClient, order_service: OrderService, monkeypatch: pytest.MonkeyPatch):
    """PAYSEC-02: Webhook amount lower than order total -> order is NOT marked PAID."""
    test_secret = "test_webhook_sec_2"
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", test_secret)

    order_resp = client.post("/orders/checkout", json={"items": [{"product_id": "prod_cashmere", "quantity": 1}]})
    data = order_resp.json()["data"]
    order_id = data["order_id"]
    provider_oid = data["razorpay_order_id"]
    total_paise = data["amount_paise"]  # 499900

    # Underpayment: paid 100 paise instead of 499900
    webhook_event = {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_sec_underpay",
                    "order_id": provider_oid,
                    "notes": {"zipright_order_id": order_id},
                    "amount": 100,
                    "currency": "INR",
                }
            }
        },
    }
    raw_body = json.dumps(webhook_event).encode("utf-8")
    sig = _sign_webhook(raw_body, test_secret)

    resp = client.post("/payments/webhook", content=raw_body, headers={"Content-Type": "application/json", "X-Razorpay-Signature": sig})
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["result"] == "amount_mismatch"

    order = order_service.get_order(order_id)
    assert order.status == OrderStatus.PENDING_PAYMENT.value
    assert order.paid_at is None


def test_paysec_03_webhook_amount_higher_than_order_total_rejected(client: TestClient, order_service: OrderService, monkeypatch: pytest.MonkeyPatch):
    """PAYSEC-03: Webhook amount higher than order total -> order is NOT marked PAID."""
    test_secret = "test_webhook_sec_3"
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", test_secret)

    order_resp = client.post("/orders/checkout", json={"items": [{"product_id": "prod_cashmere", "quantity": 1}]})
    data = order_resp.json()["data"]
    order_id = data["order_id"]
    provider_oid = data["razorpay_order_id"]
    total_paise = data["amount_paise"]

    # Overpayment mismatch
    webhook_event = {
        "event": "order.paid",
        "payload": {
            "order": {"entity": {"id": provider_oid, "receipt": order_id, "amount": total_paise + 5000, "currency": "INR"}},
            "payment": {"entity": {"id": "pay_sec_overpay", "order_id": provider_oid, "amount": total_paise + 5000, "currency": "INR"}},
        },
    }
    raw_body = json.dumps(webhook_event).encode("utf-8")
    sig = _sign_webhook(raw_body, test_secret)

    resp = client.post("/payments/webhook", content=raw_body, headers={"Content-Type": "application/json", "X-Razorpay-Signature": sig})
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["result"] == "amount_mismatch"

    order = order_service.get_order(order_id)
    assert order.status == OrderStatus.PENDING_PAYMENT.value
    assert order.paid_at is None


def test_paysec_04_webhook_currency_mismatch_rejected(client: TestClient, order_service: OrderService, monkeypatch: pytest.MonkeyPatch):
    """PAYSEC-04: Webhook currency mismatch -> order is NOT marked PAID."""
    test_secret = "test_webhook_sec_4"
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", test_secret)

    order_resp = client.post("/orders/checkout", json={"items": [{"product_id": "prod_cashmere", "quantity": 1}]})
    data = order_resp.json()["data"]
    order_id = data["order_id"]
    provider_oid = data["razorpay_order_id"]
    total_paise = data["amount_paise"]

    # Currency USD instead of authoritative INR
    webhook_event = {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_sec_currency_spoof",
                    "order_id": provider_oid,
                    "notes": {"zipright_order_id": order_id},
                    "amount": total_paise,
                    "currency": "USD",
                }
            }
        },
    }
    raw_body = json.dumps(webhook_event).encode("utf-8")
    sig = _sign_webhook(raw_body, test_secret)

    resp = client.post("/payments/webhook", content=raw_body, headers={"Content-Type": "application/json", "X-Razorpay-Signature": sig})
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["result"] == "currency_mismatch"

    order = order_service.get_order(order_id)
    assert order.status == OrderStatus.PENDING_PAYMENT.value
    assert order.paid_at is None


def test_paysec_05_webhook_provider_order_id_mismatch_rejected(client: TestClient, order_service: OrderService, monkeypatch: pytest.MonkeyPatch):
    """PAYSEC-05: Webhook provider order ID mismatch -> order is NOT marked PAID."""
    test_secret = "test_webhook_sec_5"
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", test_secret)

    order_resp = client.post("/orders/checkout", json={"items": [{"product_id": "prod_cashmere", "quantity": 1}]})
    data = order_resp.json()["data"]
    order_id = data["order_id"]
    total_paise = data["amount_paise"]

    # Wrong provider order ID
    webhook_event = {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_sec_id_mismatch",
                    "order_id": "order_unrelated_foreign_id_9999",
                    "notes": {"zipright_order_id": order_id},
                    "amount": total_paise,
                    "currency": "INR",
                }
            }
        },
    }
    raw_body = json.dumps(webhook_event).encode("utf-8")
    sig = _sign_webhook(raw_body, test_secret)

    resp = client.post("/payments/webhook", content=raw_body, headers={"Content-Type": "application/json", "X-Razorpay-Signature": sig})
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["result"] == "provider_order_mismatch"

    order = order_service.get_order(order_id)
    assert order.status == OrderStatus.PENDING_PAYMENT.value
    assert order.paid_at is None


def test_paysec_06_valid_provider_order_id_and_amount_and_currency_succeeds(client: TestClient, order_service: OrderService, monkeypatch: pytest.MonkeyPatch):
    """PAYSEC-06: Valid provider order ID + correct amount + correct currency + valid signature -> order becomes PAID."""
    test_secret = "test_webhook_sec_6"
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", test_secret)

    order_resp = client.post("/orders/checkout", json={"items": [{"product_id": "prod_silk_scarf", "quantity": 2}]})
    data = order_resp.json()["data"]
    order_id = data["order_id"]
    provider_oid = data["razorpay_order_id"]
    total_paise = data["amount_paise"]

    webhook_event = {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_sec_06_valid",
                    "order_id": provider_oid,
                    "notes": {"zipright_order_id": order_id},
                    "amount": total_paise,
                    "currency": "INR",
                }
            }
        },
    }
    raw_body = json.dumps(webhook_event).encode("utf-8")
    sig = _sign_webhook(raw_body, test_secret)

    resp = client.post("/payments/webhook", content=raw_body, headers={"Content-Type": "application/json", "X-Razorpay-Signature": sig})
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["result"] == "marked_paid"

    order = order_service.get_order(order_id)
    assert order.status == OrderStatus.PAID.value
    assert order.paid_at is not None
    assert order.payment_id == "pay_sec_06_valid"


def test_paysec_07_missing_webhook_secret_fails_closed(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """PAYSEC-07: Missing webhook secret -> webhook verification fails closed with 400 Bad Request."""
    monkeypatch.setattr(settings, "RAZORPAY_WEBHOOK_SECRET", "")
    monkeypatch.setattr(settings, "RAZORPAY_KEY_SECRET", "")
    monkeypatch.delenv("RAZORPAY_WEBHOOK_SECRET", raising=False)
    monkeypatch.delenv("RAZORPAY_KEY_SECRET", raising=False)

    raw_body = json.dumps({"event": "order.paid"}).encode("utf-8")
    resp = client.post(
        "/payments/webhook",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Razorpay-Signature": "some_sig"},
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_paysec_08_invalid_webhook_signature_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """PAYSEC-08: Invalid webhook signature is rejected with 400 Bad Request."""
    test_secret = "test_webhook_sec_8"
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", test_secret)

    raw_body = json.dumps({"event": "payment.captured"}).encode("utf-8")
    resp = client.post(
        "/payments/webhook",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Razorpay-Signature": "forged_invalid_signature"},
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_paysec_09_webhook_replay_idempotency_remains_correct(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """PAYSEC-09: Existing webhook replay/idempotency behavior remains correct."""
    test_secret = "test_webhook_sec_9"
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", test_secret)

    order_resp = client.post("/orders/checkout", json={"items": [{"product_id": "prod_cashmere", "quantity": 1}]})
    data = order_resp.json()["data"]
    order_id = data["order_id"]
    provider_oid = data["razorpay_order_id"]
    total_paise = data["amount_paise"]

    webhook_event = {
        "id": "evt_paysec_09_unique",
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_sec_replay_09",
                    "order_id": provider_oid,
                    "notes": {"zipright_order_id": order_id},
                    "amount": total_paise,
                    "currency": "INR",
                }
            }
        },
    }
    raw_body = json.dumps(webhook_event).encode("utf-8")
    sig = _sign_webhook(raw_body, test_secret)
    headers = {"Content-Type": "application/json", "X-Razorpay-Signature": sig}

    resp1 = client.post("/payments/webhook", content=raw_body, headers=headers)
    assert resp1.status_code == status.HTTP_200_OK
    assert resp1.json()["result"] == "marked_paid"

    resp2 = client.post("/payments/webhook", content=raw_body, headers=headers)
    assert resp2.status_code == status.HTTP_200_OK
    assert resp2.json()["result"] == "already_processed"


def test_paysec_10_payment_creation_cannot_alter_authoritative_amount(client: TestClient, order_service: OrderService):
    """PAYSEC-10: Payment creation cannot use client-supplied amount to alter authoritative order amount."""
    # Attempt to tamper with package amount
    tampered_package_payload = {
        "package_id": "wallet_pack_starter",
        "amount": 1,
        "amount_paise": 100,
        "amount_rupees": 1,
        "price": 1,
    }
    resp = client.post("/payments/create-order", json=tampered_package_payload)
    assert resp.status_code == status.HTTP_200_OK
    data = resp.json()["data"]

    # Must strictly match authoritative starter pack: 299 rupees = 29900 paise
    assert data["amount"] == 29900
    assert data["currency"] == "INR"
    assert data["order_id"].startswith("ord_pkg_")
    assert data["razorpay_order_id"].startswith("order_")

    # Verify persisted in Firestore and Redis
    order = order_service.get_order(data["order_id"])
    assert order is not None
    assert order.total_paise == 29900
    assert order.status == OrderStatus.PENDING_PAYMENT.value
    assert order.payment_order_id == data["razorpay_order_id"]


# ── PHASE 3A-2: ATOMIC IDEMPOTENCY TESTS ──────────────────────────────────────


def test_idempotency_01_same_key_same_user_exactly_one_order(client: TestClient, order_service: OrderService):
    """IDEMPOTENCY: Replay with same key + same user returns the original created order."""
    payload = {
        "items": [{"product_id": "prod_cashmere", "quantity": 1}]
    }
    headers = {"X-Idempotency-Key": "idem_single_key_001"}

    resp1 = client.post("/orders/checkout", json=payload, headers=headers)
    assert resp1.status_code == status.HTTP_201_CREATED
    order_id_1 = resp1.json()["data"]["order_id"]

    # Immediate second call with identical key
    resp2 = client.post("/orders/checkout", json=payload, headers=headers)
    assert resp2.status_code == status.HTTP_201_CREATED
    order_id_2 = resp2.json()["data"]["order_id"]

    assert order_id_1 == order_id_2

    # Verify only 1 order exists in the database
    cust_orders = order_service.list_customer_orders(CUSTOMER_A.uid)
    assert len([o for o in cust_orders if o.order_id == order_id_1]) == 1


def test_idempotency_02_concurrent_duplicate_requests_single_order(client: TestClient):
    """CONCURRENCY: Multiple simultaneous requests with the same key produce exactly one order."""
    from concurrent.futures import ThreadPoolExecutor

    payload = {
        "items": [{"product_id": "prod_cashmere", "quantity": 1}]
    }
    headers = {"X-Idempotency-Key": "concurrent_test_key_888"}

    def make_request():
        return client.post("/orders/checkout", json=payload, headers=headers)

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(make_request) for _ in range(4)]
        responses = [f.result() for f in futures]

    order_ids = set()
    for resp in responses:
        if resp.status_code in {status.HTTP_201_CREATED, status.HTTP_200_OK}:
            order_ids.add(resp.json()["data"]["order_id"])
        else:
            # Deterministic conflict if poll window exceeded
            assert resp.status_code == status.HTTP_409_CONFLICT

    assert len(order_ids) == 1


def test_idempotency_03_same_key_different_users_isolated(client: TestClient):
    """IDEMPOTENCY: Idempotency is strictly scoped to the authenticated user."""
    payload = {
        "items": [{"product_id": "prod_cashmere", "quantity": 1}]
    }
    headers = {"X-Idempotency-Key": "shared_key_name_123"}

    # User A checkouts
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER_A
    resp_a = client.post("/orders/checkout", json=payload, headers=headers)
    assert resp_a.status_code == status.HTTP_201_CREATED
    order_id_a = resp_a.json()["data"]["order_id"]

    # User B checkouts with the SAME key -> must create a separate, distinct order
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER_B
    resp_b = client.post("/orders/checkout", json=payload, headers=headers)
    assert resp_b.status_code == status.HTTP_201_CREATED
    order_id_b = resp_b.json()["data"]["order_id"]

    assert order_id_a != order_id_b


def test_idempotency_04_different_keys_same_user_separate_orders(client: TestClient):
    """IDEMPOTENCY: Different idempotency keys produce separate orders."""
    payload = {
        "items": [{"product_id": "prod_cashmere", "quantity": 1}]
    }
    resp1 = client.post("/orders/checkout", json=payload, headers={"X-Idempotency-Key": "key_alpha"})
    resp2 = client.post("/orders/checkout", json=payload, headers={"X-Idempotency-Key": "key_beta"})

    assert resp1.status_code == status.HTTP_201_CREATED
    assert resp2.status_code == status.HTTP_201_CREATED
    assert resp1.json()["data"]["order_id"] != resp2.json()["data"]["order_id"]


def test_idempotency_05_redis_atomic_nx_lock_exercised(client: TestClient):
    """IDEMPOTENCY: Verifies Redis key transitions to order_id upon completion."""
    r = get_redis_client()
    key = "idem_nx_test_key"
    payload = {
        "items": [{"product_id": "prod_cashmere", "quantity": 1}]
    }

    resp = client.post("/orders/checkout", json=payload, headers={"X-Idempotency-Key": key})
    assert resp.status_code == status.HTTP_201_CREATED
    order_id = resp.json()["data"]["order_id"]

    redis_key = f"zipright:checkout:idempotency:{CUSTOMER_A.uid}:{key}"
    cached_val = r.get(redis_key)
    if isinstance(cached_val, bytes):
        cached_val = cached_val.decode("utf-8")

    assert cached_val == order_id


def test_idempotency_06_redis_failure_safe_behavior(client: TestClient, monkeypatch):
    """IDEMPOTENCY: In strict mode or production, Redis failure fails closed with 503."""
    monkeypatch.setenv("STRICT_REDIS_IDEMPOTENCY", "true")

    r = get_redis_client()

    def mock_broken_set(*args, **kwargs):
        raise ConnectionError("Redis cluster unreachable")

    monkeypatch.setattr(r, "set", mock_broken_set)

    payload = {
        "items": [{"product_id": "prod_cashmere", "quantity": 1}]
    }
    resp = client.post("/orders/checkout", json=payload, headers={"X-Idempotency-Key": "fail_key_1"})
    assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert "Idempotency service temporarily unavailable" in resp.json()["message"]


def test_idempotency_07_failed_order_creation_cleans_up_lock(client: TestClient, order_service: OrderService, monkeypatch):
    """IDEMPOTENCY: If order creation raises an exception, the IN_PROGRESS lock is released immediately."""
    r = get_redis_client()
    key = "fail_and_retry_key"
    redis_key = f"zipright:checkout:idempotency:{CUSTOMER_A.uid}:{key}"

    # Force a failure during provider order creation
    def mock_broken_razorpay(*args, **kwargs):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Provider failure")

    monkeypatch.setattr("services.order_service.create_razorpay_order", mock_broken_razorpay)

    payload = {
        "items": [{"product_id": "prod_cashmere", "quantity": 1}]
    }
    resp = client.post("/orders/checkout", json=payload, headers={"X-Idempotency-Key": key})
    assert resp.status_code == status.HTTP_502_BAD_GATEWAY

    # Lock must have been deleted so user can retry
    assert r.get(redis_key) is None


# ── PHASE 3A-2: SELLER ORDER LISTING TESTS ───────────────────────────────────


def test_seller_orders_01_seller_authentication_required(client: TestClient):
    """SELLER ORDERS: Requires authenticated seller; shoppers and pending sellers get 403."""
    # 1. Customer (not a seller)
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER_A
    resp1 = client.get("/seller/orders")
    assert resp1.status_code == status.HTTP_403_FORBIDDEN
    assert "Seller profile required" in resp1.json()["message"]

    # 2. Pending seller
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(uid="seller_pending", email="pending@seller.com")
    resp2 = client.get("/seller/orders")
    assert resp2.status_code == status.HTTP_403_FORBIDDEN
    assert "under review" in resp2.json()["message"]

    # 3. Active seller
    app.dependency_overrides[get_current_user] = lambda: SELLER_A_USER
    resp3 = client.get("/seller/orders")
    assert resp3.status_code == status.HTTP_200_OK


def test_seller_orders_02_seller_a_sees_only_own_items(client: TestClient):
    """SELLER ORDERS: Seller A sees only their items; Seller B items in same order are omitted."""
    # Create multi-seller order as customer
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER_A
    payload = {
        "items": [
            {"product_id": "prod_cashmere", "quantity": 2},    # Seller Alpha (₹4999 * 2 = ₹9998 = 999800 paise)
            {"product_id": "prod_silk_scarf", "quantity": 1},   # Seller Beta (₹1499.50 = 149950 paise)
        ]
    }
    checkout_resp = client.post("/orders/checkout", json=payload)
    assert checkout_resp.status_code == status.HTTP_201_CREATED
    order_id = checkout_resp.json()["data"]["order_id"]

    # Seller Alpha queries /seller/orders
    app.dependency_overrides[get_current_user] = lambda: SELLER_A_USER
    resp_a = client.get("/seller/orders")
    assert resp_a.status_code == status.HTTP_200_OK
    data_a = resp_a.json()["data"]

    # Find the order
    order_a = next((o for o in data_a if o["order_id"] == order_id), None)
    assert order_a is not None
    assert len(order_a["items"]) == 1
    assert order_a["items"][0]["product_id"] == "prod_cashmere"
    assert order_a["items"][0]["quantity"] == 2
    assert order_a["seller_subtotal_paise"] == 999800
    assert order_a["seller_subtotal_rupees"] == 9998.0

    # Seller Beta queries /seller/orders
    app.dependency_overrides[get_current_user] = lambda: SELLER_B_USER
    resp_b = client.get("/seller/orders")
    assert resp_b.status_code == status.HTTP_200_OK
    data_b = resp_b.json()["data"]

    order_b = next((o for o in data_b if o["order_id"] == order_id), None)
    assert order_b is not None
    assert len(order_b["items"]) == 1
    assert order_b["items"][0]["product_id"] == "prod_silk_scarf"
    assert order_b["items"][0]["quantity"] == 1
    assert order_b["seller_subtotal_paise"] == 149950
    assert order_b["seller_subtotal_rupees"] == 1499.50


def test_seller_orders_03_no_customer_private_fields_leaked(client: TestClient):
    """SELLER ORDERS: Never exposes customer private information, biometrics, or secrets."""
    # Place order
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER_A
    payload = {"items": [{"product_id": "prod_cashmere", "quantity": 1}]}
    client.post("/orders/checkout", json=payload)

    # View as seller
    app.dependency_overrides[get_current_user] = lambda: SELLER_A_USER
    resp = client.get("/seller/orders")
    assert resp.status_code == status.HTTP_200_OK
    orders = resp.json()["data"]
    assert len(orders) > 0

    forbidden_fields = {
        "customer_uid",
        "email",
        "phone",
        "address",
        "shipping_address",
        "password",
        "biometrics",
        "measurements",
        "fit_profile",
        "payment_order_id",
        "payment_id",
    }

    for order_entry in orders:
        for field in forbidden_fields:
            assert field not in order_entry, f"Leaked private field: {field}"
        for item in order_entry["items"]:
            for field in forbidden_fields:
                assert field not in item, f"Leaked private field in item: {field}"


def test_seller_orders_04_client_cannot_override_seller_identity(client: TestClient):
    """SELLER ORDERS: seller identity cannot be overridden by request params or headers."""
    # Place order for Seller Beta only
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER_A
    payload = {"items": [{"product_id": "prod_silk_scarf", "quantity": 1}]}
    resp = client.post("/orders/checkout", json=payload)
    order_id = resp.json()["data"]["order_id"]

    # Seller Alpha attempts to spoof Seller Beta via query param
    app.dependency_overrides[get_current_user] = lambda: SELLER_A_USER
    resp_spoof = client.get("/seller/orders?seller_id=seller_beta&seller_uid=seller_beta")
    assert resp_spoof.status_code == status.HTTP_200_OK
    orders = resp_spoof.json()["data"]

    # Must NOT see the Seller Beta order
    beta_order = next((o for o in orders if o["order_id"] == order_id), None)
    assert beta_order is None


def test_seller_orders_05_pagination_and_bounds(client: TestClient):
    """SELLER ORDERS: Bounded pagination respects limit and offset."""
    # Place 3 orders for Seller Alpha
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER_A
    for i in range(3):
        client.post(
            "/orders/checkout",
            json={"items": [{"product_id": "prod_cashmere", "quantity": 1}]},
            headers={"X-Idempotency-Key": f"pagination_test_{i}"},
        )

    app.dependency_overrides[get_current_user] = lambda: SELLER_A_USER

    # Limit = 1
    resp1 = client.get("/seller/orders?limit=1&offset=0")
    assert resp1.status_code == status.HTTP_200_OK
    assert len(resp1.json()["data"]) == 1

    # Limit = 2, offset = 1
    resp2 = client.get("/seller/orders?limit=2&offset=1")
    assert resp2.status_code == status.HTTP_200_OK
    assert len(resp2.json()["data"]) <= 2

    # Negative limit bounded to minimum 1
    resp3 = client.get("/seller/orders?limit=-5")
    assert resp3.status_code == status.HTTP_200_OK
    assert len(resp3.json()["data"]) >= 1


# ── PHASE 3A-3: AUTHORIZATION & PRODUCTION READINESS AUDIT TESTS ─────────────

ANONYMOUS_USER = AuthenticatedUser(uid="anon_user_999", email=None, is_anonymous=True)


def test_auth_audit_01_anonymous_user_cannot_create_package_order(client: TestClient):
    """AUTH AUDIT: Anonymous users are forbidden from creating paid package orders."""
    app.dependency_overrides[get_current_user] = lambda: ANONYMOUS_USER

    resp = client.post("/payments/create-order", json={"package_id": "wallet_pack_starter"})
    assert resp.status_code == status.HTTP_403_FORBIDDEN
    assert "Anonymous accounts cannot create payment orders" in resp.json()["message"]


def test_auth_audit_02_anonymous_user_cannot_create_checkout_order(client: TestClient):
    """AUTH AUDIT: Anonymous users are forbidden from creating checkout orders."""
    app.dependency_overrides[get_current_user] = lambda: ANONYMOUS_USER

    payload = {"items": [{"product_id": "prod_cashmere", "quantity": 1}]}
    resp = client.post("/orders/checkout", json=payload)
    assert resp.status_code == status.HTTP_403_FORBIDDEN
    assert "Anonymous accounts cannot create checkout orders" in resp.json()["message"]


def test_auth_audit_03_customer_cannot_access_other_customer_order(client: TestClient):
    """AUTH AUDIT: Customer Alice cannot read Customer Bob's order."""
    # Create order as Customer Bob
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER_B
    payload = {"items": [{"product_id": "prod_cashmere", "quantity": 1}]}
    resp = client.post("/orders/checkout", json=payload)
    order_id = resp.json()["data"]["order_id"]

    # Customer Alice attempts to read Bob's order
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER_A
    resp_read = client.get(f"/orders/{order_id}")
    assert resp_read.status_code == status.HTTP_403_FORBIDDEN


def test_auth_audit_04_seller_cannot_access_unrelated_order(client: TestClient):
    """AUTH AUDIT: Seller Alpha cannot read an order containing only Seller Beta products."""
    # Create order containing ONLY Seller Beta's silk scarf
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER_A
    payload = {"items": [{"product_id": "prod_silk_scarf", "quantity": 1}]}
    resp = client.post("/orders/checkout", json=payload)
    order_id = resp.json()["data"]["order_id"]

    # Seller Alpha attempts to view the order
    app.dependency_overrides[get_current_user] = lambda: SELLER_A_USER
    resp_view = client.get(f"/orders/{order_id}")
    assert resp_view.status_code == status.HTTP_403_FORBIDDEN


def test_prod_ready_01_missing_credentials_in_prod_fails_safely_503(client: TestClient, monkeypatch):
    """PROD READY: If live credentials are missing in production/staging, order creation fails safely with 503."""
    monkeypatch.setattr(settings, "ENV", "production")
    monkeypatch.setattr(settings, "RAZORPAY_KEY_ID", "")
    monkeypatch.setattr(settings, "RAZORPAY_KEY_SECRET", "")

    payload = {"items": [{"product_id": "prod_cashmere", "quantity": 1}]}
    resp = client.post("/orders/checkout", json=payload)
    assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert "credentials are not configured" in resp.json()["message"].lower()


def test_prod_ready_02_lost_response_retry_replays_winner_without_duplicate(client: TestClient, order_service: OrderService):
    """PROD READY: Client retry after lost response reuses identical key and replays winner's order."""
    payload = {"items": [{"product_id": "prod_cashmere", "quantity": 1}]}
    headers = {"X-Idempotency-Key": "retry_after_lost_packet_777"}

    # Attempt 1: Server successfully creates order
    resp1 = client.post("/orders/checkout", json=payload, headers=headers)
    assert resp1.status_code == status.HTTP_201_CREATED
    order_id_1 = resp1.json()["data"]["order_id"]

    # Attempt 2: Client retries due to simulated network timeout/lost response
    resp2 = client.post("/orders/checkout", json=payload, headers=headers)
    assert resp2.status_code == status.HTTP_201_CREATED
    order_id_2 = resp2.json()["data"]["order_id"]

    assert order_id_1 == order_id_2

    # Verify only ONE order exists in database for this customer
    all_orders = order_service.list_customer_orders(CUSTOMER_A.uid)
    matching = [o for o in all_orders if o.order_id == order_id_1]
    assert len(matching) == 1



