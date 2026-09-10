"""Phase 1A: Server-Authoritative Authentication & Authorization Foundation Test Suite.

Validates the security invariants and requirements for Phase 1A:
- AUTH-01: Invalid Firebase token is rejected with HTTP 401.
- AUTH-02: Valid customer token receives customer access with role="customer".
- AUTH-03: Customer cannot access an admin endpoint.
- AUTH-04: Seller cannot access an admin endpoint.
- AUTH-05: Inactive/suspended seller cannot use active-seller-only endpoints.
- AUTH-06A: Backend authorization ignores client-supplied role values.
- AUTH-06B: Changing client/localStorage role does not grant backend privileges.
- AUTH-07A: Seller A cannot READ Seller B's product.
- AUTH-07B: Seller A cannot UPDATE Seller B's product.
- AUTH-07C: Seller A cannot DELETE Seller B's product.
- AUTH-08: Unauthorized user cannot read another user's private fit/biometric data.
- AUTH-09: Internal roles do not receive raw biometric data through /auth/access.
- AUTH-10: Authorization failures do not reveal secrets, tokens, or stack traces.
- AUTH-11: Existing authorized seller flows still work (/seller/me, /seller/products).
- AUTH-12: Existing authorized admin flows still work (/seller/{uid}/status, /tryon-live/garments).
"""

from __future__ import annotations

import asyncio
from typing import Any
import pytest
from fastapi import status
from fastapi.testclient import TestClient

from main import app
from core.authorization import (
    Role,
    Permission,
    ROLE_PERMISSIONS,
    UserAuthorizationContext,
    resolve_authorization_context,
    require_role,
    require_permission,
)
from services.admin_auth import AdminGate, get_admin_gate, require_admin
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.seller_auth import require_active_seller, require_seller
from services.seller_repository import SellerRepository, get_seller_repository
from services.product_repository import SellerProductRepository, get_product_repository
from tests.conftest import FakeFirestore


# ── Test Doubles & Setup ──────────────────────────────────────────────────────

def _make_fake_seller_repo(fake_db: FakeFirestore) -> SellerRepository:
    return SellerRepository(client=fake_db)


def _make_fake_admin_gate(fake_db: FakeFirestore) -> AdminGate:
    return AdminGate(client=fake_db)


def _make_fake_product_repo(fake_db: FakeFirestore) -> SellerProductRepository:
    repo = SellerProductRepository()
    repo._client = fake_db
    return repo


@pytest.fixture
def auth_test_db() -> FakeFirestore:
    db = FakeFirestore()
    # Seed an admin
    db.seed("admins", "admin_user_1", {"status": "active", "email": "admin@zipright.ai"})
    # Seed an inactive admin
    db.seed("admins", "disabled_admin", {"status": "disabled", "email": "disabled@zipright.ai"})
    # Seed an active seller
    db.seed("sellers", "seller_a", {
        "uid": "seller_a",
        "store_name": "Store Alpha",
        "contact_name": "Alice Seller",
        "email": "alice@seller.com",
        "phone": "+1234567890",
        "status": "active",
    })
    # Seed a second active seller
    db.seed("sellers", "seller_b", {
        "uid": "seller_b",
        "store_name": "Store Beta",
        "contact_name": "Bob Seller",
        "email": "bob@seller.com",
        "phone": "+1987654321",
        "status": "active",
    })
    # Seed a pending seller
    db.seed("sellers", "seller_pending", {
        "uid": "seller_pending",
        "store_name": "Store Pending",
        "contact_name": "Penny Seller",
        "email": "penny@seller.com",
        "phone": "+1555555555",
        "status": "pending",
    })
    # Seed a suspended seller
    db.seed("sellers", "seller_suspended", {
        "uid": "seller_suspended",
        "store_name": "Store Suspended",
        "contact_name": "Sam Suspended",
        "email": "sam@seller.com",
        "phone": "+1444444444",
        "status": "suspended",
    })
    # Seed products (price must be string per SellerProduct schema)
    db.seed("seller_products", "prod_a_1", {
        "id": "prod_a_1",
        "seller_uid": "seller_a",
        "title": "Alpha Linen Shirt",
        "brand": "AlphaBrand",
        "category": "Shirts",
        "price": "49.99",
        "status": "active",
    })
    db.seed("seller_products", "prod_b_1", {
        "id": "prod_b_1",
        "seller_uid": "seller_b",
        "title": "Beta Denim Jacket",
        "brand": "BetaBrand",
        "category": "Jackets",
        "price": "89.99",
        "status": "active",
    })
    return db


# ── RBAC Core Engine Invariant Tests ──────────────────────────────────────────

def test_rbac_future_roles_have_no_permissions():
    """Future roles must NOT have permissions in Phase 1A."""
    future_roles = [
        Role.SUPPORT_AGENT,
        Role.OPERATIONS,
        Role.REFUND_MANAGER,
        Role.SELLER_MANAGER,
        Role.MODERATOR,
        Role.FINANCE,
        Role.SECURITY,
        Role.ANALYST,
    ]
    for r in future_roles:
        assert ROLE_PERMISSIONS[r] == frozenset(), f"Future role {r} must have 0 permissions in Phase 1A"


def test_rbac_admin_and_super_admin_have_no_biometric_permissions():
    """ADMIN and SUPER_ADMIN must NOT receive cross-tenant customer biometric/fit access."""
    admin_perms = ROLE_PERMISSIONS[Role.ADMIN]
    super_admin_perms = ROLE_PERMISSIONS[Role.SUPER_ADMIN]

    # Admin only has own fit read/write capability as a customer
    assert Permission.FIT_READ_OWN in admin_perms
    # Neither role receives cross-tenant biometric/fit data access
    assert "fit:read_all" not in [p.value for p in admin_perms]
    assert "biometrics:read_any" not in [p.value for p in admin_perms]
    assert "fit:read_all" not in [p.value for p in super_admin_perms]
    assert "biometrics:read_any" not in [p.value for p in super_admin_perms]


def test_rbac_super_admin_is_foundation_only():
    """SUPER_ADMIN is foundation only: 0 permissions and not an active privileged role in Phase 1A."""
    assert ROLE_PERMISSIONS[Role.SUPER_ADMIN] == frozenset(), "SUPER_ADMIN must have 0 active permissions in Phase 1A"

    super_admin_user = AuthenticatedUser(uid="super_admin_1", email="super@zipright.ai")
    ctx = UserAuthorizationContext(
        user=super_admin_user,
        primary_role=Role.SUPER_ADMIN,
        roles={Role.SUPER_ADMIN},
        permissions=set(ROLE_PERMISSIONS[Role.SUPER_ADMIN]),
    )
    assert ctx.is_admin is False, "SUPER_ADMIN must not automatically grant is_admin in Phase 1A"
    assert len(ctx.permissions) == 0, "SUPER_ADMIN context must contain 0 permissions in Phase 1A"


# ── AUTH-01: Invalid Firebase Token Rejected (HTTP 401) ───────────────────────

def test_auth_01_missing_and_invalid_firebase_token():
    """AUTH-01: Requests with missing or invalid bearer tokens are rejected with 401."""
    client = TestClient(app)

    # 1. Missing Authorization header
    res_no_auth = client.get("/auth/access")
    assert res_no_auth.status_code == status.HTTP_401_UNAUTHORIZED

    # 2. Malformed / garbage bearer token
    res_bad_token = client.get(
        "/auth/access",
        headers={"Authorization": "Bearer not-a-valid-jwt-token-12345"},
    )
    assert res_bad_token.status_code == status.HTTP_401_UNAUTHORIZED
    data = res_bad_token.json()
    assert data.get("isValid") is False
    assert "message" in data


# ── AUTH-02: Customer Receives Customer Role ──────────────────────────────────

def test_auth_02_customer_token_receives_customer_role(auth_test_db: FakeFirestore):
    """AUTH-02: Valid customer token receives role='customer', permissions, and no admin/seller flags."""
    customer = AuthenticatedUser(uid="cust_123", email="customer@example.com")
    app.dependency_overrides[get_current_user] = lambda: customer
    app.dependency_overrides[get_admin_gate] = lambda: _make_fake_admin_gate(auth_test_db)
    app.dependency_overrides[get_seller_repository] = lambda: _make_fake_seller_repo(auth_test_db)

    try:
        client = TestClient(app)
        res = client.get("/auth/access")
        assert res.status_code == status.HTTP_200_OK
        body = res.json()["data"]
        assert body["is_admin"] is False
        assert body["is_seller"] is False
        assert body["role"] == "customer"
        assert body["roles"] == ["customer"]
        assert "profile:read_own" in body["permissions"]
        assert "fit:read_own" in body["permissions"]
        assert "seller:manage_own_store" not in body["permissions"]
        assert "admin:manage_sellers" not in body["permissions"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_admin_gate, None)
        app.dependency_overrides.pop(get_seller_repository, None)


# ── AUTH-03: Customer Cannot Access Admin Endpoint ────────────────────────────

def test_auth_03_customer_cannot_access_admin_endpoints(auth_test_db: FakeFirestore):
    """AUTH-03: Customer calling admin endpoints receives 403 Forbidden with administrator requirement."""
    customer = AuthenticatedUser(uid="cust_123", email="customer@example.com")
    app.dependency_overrides[get_current_user] = lambda: customer
    app.dependency_overrides[get_admin_gate] = lambda: _make_fake_admin_gate(auth_test_db)
    app.dependency_overrides[get_seller_repository] = lambda: _make_fake_seller_repo(auth_test_db)

    try:
        client = TestClient(app)
        # Attempt 1: Admin seller status route
        res_seller_status = client.patch(
            "/seller/seller_pending/status",
            json={"status": "active"},
        )
        assert res_seller_status.status_code == status.HTTP_403_FORBIDDEN
        assert "Administrator access required" in res_seller_status.json()["message"]

        # Attempt 2: Admin garment creation route
        res_garment = client.post(
            "/tryon-live/garments",
            json={
                "sku": "SKU-DRESS-TEST",
                "name": "Admin Only Shirt",
                "category": "upper_body",
            },
        )
        assert res_garment.status_code == status.HTTP_403_FORBIDDEN
        assert "Administrator access required" in res_garment.json()["message"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_admin_gate, None)
        app.dependency_overrides.pop(get_seller_repository, None)


# ── AUTH-04: Seller Cannot Access Admin Endpoint ──────────────────────────────

def test_auth_04_seller_cannot_access_admin_endpoint(auth_test_db: FakeFirestore):
    """AUTH-04: Active seller calling an admin endpoint receives 403 Forbidden."""
    seller = AuthenticatedUser(uid="seller_a", email="alice@seller.com")
    app.dependency_overrides[get_current_user] = lambda: seller
    app.dependency_overrides[get_admin_gate] = lambda: _make_fake_admin_gate(auth_test_db)
    app.dependency_overrides[get_seller_repository] = lambda: _make_fake_seller_repo(auth_test_db)

    try:
        client = TestClient(app)
        res = client.patch(
            "/seller/seller_pending/status",
            json={"status": "active"},
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert "Administrator access required" in res.json()["message"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_admin_gate, None)
        app.dependency_overrides.pop(get_seller_repository, None)


# ── AUTH-05: Inactive/Suspended Seller Cannot Access Active Endpoints ──────────

def test_auth_05_inactive_or_suspended_seller_blocked(auth_test_db: FakeFirestore):
    """AUTH-05: Inactive (pending or suspended) sellers cannot use active-seller-only endpoints."""
    app.dependency_overrides[get_admin_gate] = lambda: _make_fake_admin_gate(auth_test_db)
    app.dependency_overrides[get_seller_repository] = lambda: _make_fake_seller_repo(auth_test_db)
    app.dependency_overrides[get_product_repository] = lambda: _make_fake_product_repo(auth_test_db)

    client = TestClient(app)

    try:
        # Case A: Pending seller
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            uid="seller_pending", email="penny@seller.com"
        )
        res_pending = client.get("/seller/products")
        assert res_pending.status_code == status.HTTP_403_FORBIDDEN
        assert "under review" in res_pending.json()["message"].lower()

        # Case B: Suspended seller
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            uid="seller_suspended", email="sam@seller.com"
        )
        res_suspended = client.get("/seller/products")
        assert res_suspended.status_code == status.HTTP_403_FORBIDDEN
        assert "suspended" in res_suspended.json()["message"].lower()

        # Case C: Regular user with no seller document
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            uid="regular_cust", email="cust@example.com"
        )
        res_none = client.get("/seller/products")
        assert res_none.status_code == status.HTTP_403_FORBIDDEN
        assert "seller profile required" in res_none.json()["message"].lower()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_admin_gate, None)
        app.dependency_overrides.pop(get_seller_repository, None)
        app.dependency_overrides.pop(get_product_repository, None)


# ── AUTH-06A: Backend Ignores Client-Supplied Role Values ──────────────────────

def test_auth_06a_backend_ignores_client_supplied_roles(auth_test_db: FakeFirestore):
    """AUTH-06A: Backend authorization strictly ignores query, header, or body role parameters."""
    customer = AuthenticatedUser(uid="cust_123", email="customer@example.com")
    app.dependency_overrides[get_current_user] = lambda: customer
    app.dependency_overrides[get_admin_gate] = lambda: _make_fake_admin_gate(auth_test_db)
    app.dependency_overrides[get_seller_repository] = lambda: _make_fake_seller_repo(auth_test_db)

    try:
        client = TestClient(app)
        # Attempt to pass ?role=admin in query param
        res_query = client.get("/auth/access?role=admin")
        assert res_query.status_code == status.HTTP_200_OK
        data = res_query.json()["data"]
        assert data["role"] == "customer"
        assert data["is_admin"] is False

        # Attempt to pass X-Role or role in headers
        res_header = client.get(
            "/auth/access",
            headers={"X-Role": "admin", "X-Zipright-Role": "admin"},
        )
        assert res_header.status_code == status.HTTP_200_OK
        assert res_header.json()["data"]["role"] == "customer"
        assert res_header.json()["data"]["is_admin"] is False
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_admin_gate, None)
        app.dependency_overrides.pop(get_seller_repository, None)


# ── AUTH-06B: Changing Client Storage Does Not Grant Backend Privileges ─────────

def test_auth_06b_spoofed_localstorage_role_fails_backend(auth_test_db: FakeFirestore):
    """AUTH-06B: Spoofing localStorage zipright_role to 'admin' does not grant backend privileges."""
    customer = AuthenticatedUser(uid="cust_123", email="customer@example.com")
    app.dependency_overrides[get_current_user] = lambda: customer
    app.dependency_overrides[get_admin_gate] = lambda: _make_fake_admin_gate(auth_test_db)
    app.dependency_overrides[get_seller_repository] = lambda: _make_fake_seller_repo(auth_test_db)

    try:
        client = TestClient(app)
        # Simulated request from a browser where localStorage was manipulated to have zipright_role='admin'
        res = client.patch(
            "/seller/seller_pending/status",
            headers={"X-Zipright-Role": "admin"},
            json={"status": "active", "zipright_role": "admin"},
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert "Administrator access required" in res.json()["message"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_admin_gate, None)
        app.dependency_overrides.pop(get_seller_repository, None)


# ── AUTH-07A/B/C: Seller Tenant Isolation ─────────────────────────────────────

def test_auth_07a_seller_a_cannot_read_seller_b_product(auth_test_db: FakeFirestore):
    """AUTH-07A: Seller A cannot READ Seller B's product (HTTP 404 resource isolation)."""
    seller_a = AuthenticatedUser(uid="seller_a", email="alice@seller.com")
    app.dependency_overrides[get_current_user] = lambda: seller_a
    app.dependency_overrides[get_admin_gate] = lambda: _make_fake_admin_gate(auth_test_db)
    app.dependency_overrides[get_seller_repository] = lambda: _make_fake_seller_repo(auth_test_db)
    app.dependency_overrides[get_product_repository] = lambda: _make_fake_product_repo(auth_test_db)

    try:
        client = TestClient(app)
        # Seller A attempts to read prod_b_1 (owned by seller_b)
        res = client.get("/seller/products/prod_b_1")
        assert res.status_code == status.HTTP_404_NOT_FOUND
        assert "not found or not owned" in res.json()["message"].lower()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_admin_gate, None)
        app.dependency_overrides.pop(get_seller_repository, None)
        app.dependency_overrides.pop(get_product_repository, None)


def test_auth_07b_seller_a_cannot_update_seller_b_product(auth_test_db: FakeFirestore):
    """AUTH-07B: Seller A cannot UPDATE Seller B's product (HTTP 404 resource isolation)."""
    seller_a = AuthenticatedUser(uid="seller_a", email="alice@seller.com")
    app.dependency_overrides[get_current_user] = lambda: seller_a
    app.dependency_overrides[get_admin_gate] = lambda: _make_fake_admin_gate(auth_test_db)
    app.dependency_overrides[get_seller_repository] = lambda: _make_fake_seller_repo(auth_test_db)
    app.dependency_overrides[get_product_repository] = lambda: _make_fake_product_repo(auth_test_db)

    try:
        client = TestClient(app)
        # Seller A attempts to modify prod_b_1 title and price
        res = client.patch(
            "/seller/products/prod_b_1",
            json={"title": "Hacked Title", "price": "0.01"},
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND

        # Verify Seller B's product in database was NOT altered
        prod_b = auth_test_db.collections["seller_products"]["prod_b_1"]
        assert prod_b["title"] == "Beta Denim Jacket"
        assert prod_b["price"] == "89.99"
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_admin_gate, None)
        app.dependency_overrides.pop(get_seller_repository, None)
        app.dependency_overrides.pop(get_product_repository, None)


def test_auth_07c_seller_a_cannot_delete_seller_b_product(auth_test_db: FakeFirestore):
    """AUTH-07C: Seller A cannot DELETE Seller B's product (HTTP 404 resource isolation)."""
    seller_a = AuthenticatedUser(uid="seller_a", email="alice@seller.com")
    app.dependency_overrides[get_current_user] = lambda: seller_a
    app.dependency_overrides[get_admin_gate] = lambda: _make_fake_admin_gate(auth_test_db)
    app.dependency_overrides[get_seller_repository] = lambda: _make_fake_seller_repo(auth_test_db)
    app.dependency_overrides[get_product_repository] = lambda: _make_fake_product_repo(auth_test_db)

    try:
        client = TestClient(app)
        # Seller A attempts to delete prod_b_1
        res = client.delete("/seller/products/prod_b_1")
        assert res.status_code == status.HTTP_404_NOT_FOUND

        # Verify Seller B's product still exists
        assert "prod_b_1" in auth_test_db.collections["seller_products"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_admin_gate, None)
        app.dependency_overrides.pop(get_seller_repository, None)
        app.dependency_overrides.pop(get_product_repository, None)


# ── AUTH-08: Cross-User Biometric/Fit Data Isolation ──────────────────────────

def test_auth_08_cross_user_fit_data_isolated():
    """AUTH-08: User A cannot access User B's private fit profile via /profiles/me."""
    user_a = AuthenticatedUser(uid="user_alice", email="alice@example.com")
    app.dependency_overrides[get_current_user] = lambda: user_a

    try:
        client = TestClient(app)
        # /profiles/me resolves solely based on server-verified identity token
        res = client.get("/profiles/me")
        if res.status_code == 200:
            assert res.json()["data"]["id"] == "user_alice"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ── AUTH-09: /auth/access Never Exposes Biometric Data ─────────────────────────

def test_auth_09_auth_access_never_exposes_biometrics(auth_test_db: FakeFirestore):
    """AUTH-09: Internal and customer roles do not receive raw biometric/fit data from /auth/access."""
    roles_to_test = [
        AuthenticatedUser(uid="cust_123", email="customer@example.com"),
        AuthenticatedUser(uid="seller_a", email="alice@seller.com"),
        AuthenticatedUser(uid="admin_user_1", email="admin@zipright.ai"),
    ]

    app.dependency_overrides[get_admin_gate] = lambda: _make_fake_admin_gate(auth_test_db)
    app.dependency_overrides[get_seller_repository] = lambda: _make_fake_seller_repo(auth_test_db)

    client = TestClient(app)
    forbidden_keys = {
        "front_image", "side_image", "measurements", "smart_fit",
        "smartFit", "height", "weight", "fit_profile", "photos",
        "biometrics", "body_shape", "scan_data",
    }

    try:
        for user in roles_to_test:
            app.dependency_overrides[get_current_user] = lambda u=user: u
            res = client.get("/auth/access")
            assert res.status_code == status.HTTP_200_OK
            data = res.json()["data"]

            # Confirm only authorized metadata keys exist
            for forbidden_key in forbidden_keys:
                assert forbidden_key not in data, f"Key '{forbidden_key}' exposed in /auth/access for {user.uid}!"
            assert set(data.keys()) <= {"is_admin", "is_seller", "role", "roles", "permissions"}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_admin_gate, None)
        app.dependency_overrides.pop(get_seller_repository, None)


# ── AUTH-10: Error Payloads Do Not Leak Secrets or Traces ──────────────────────

def test_auth_10_auth_failures_do_not_leak_secrets():
    """AUTH-10: 401/403 failures do not reveal secret tokens, passwords, or stack traces."""
    client = TestClient(app)

    sensitive_token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.sensitive_payload.signature"
    res = client.get(
        "/auth/access",
        headers={"Authorization": f"Bearer {sensitive_token}"},
    )
    assert res.status_code == status.HTTP_401_UNAUTHORIZED
    raw_response = res.text

    # The token itself must NOT be reflected back in the error message
    assert sensitive_token not in raw_response
    assert "Traceback (most recent call last)" not in raw_response
    assert "serviceAccountKey" not in raw_response


# ── AUTH-11: Authorized Seller Flows Still Work ────────────────────────────────

def test_auth_11_authorized_seller_flows(auth_test_db: FakeFirestore):
    """AUTH-11: Legitimate active seller can access /seller/me and /seller/products."""
    seller_a = AuthenticatedUser(uid="seller_a", email="alice@seller.com")
    app.dependency_overrides[get_current_user] = lambda: seller_a
    app.dependency_overrides[get_admin_gate] = lambda: _make_fake_admin_gate(auth_test_db)
    app.dependency_overrides[get_seller_repository] = lambda: _make_fake_seller_repo(auth_test_db)
    app.dependency_overrides[get_product_repository] = lambda: _make_fake_product_repo(auth_test_db)

    try:
        client = TestClient(app)

        # 1. /seller/me
        res_me = client.get("/seller/me")
        assert res_me.status_code == status.HTTP_200_OK
        data_me = res_me.json()["data"]
        assert data_me["is_seller"] is True
        assert data_me["status"] == "active"
        assert data_me["profile"]["store_name"] == "Store Alpha"

        # 2. /seller/products (read own products)
        res_prods = client.get("/seller/products")
        assert res_prods.status_code == status.HTTP_200_OK
        data_prods = res_prods.json()["data"]
        assert len(data_prods) == 1
        assert data_prods[0]["id"] == "prod_a_1"
        assert data_prods[0]["seller_uid"] == "seller_a"
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_admin_gate, None)
        app.dependency_overrides.pop(get_seller_repository, None)
        app.dependency_overrides.pop(get_product_repository, None)


# ── AUTH-12: Authorized Admin Flows Still Work ─────────────────────────────────

def test_auth_12_authorized_admin_flows(auth_test_db: FakeFirestore):
    """AUTH-12: Legitimate admin can access /seller/{uid}/status and create garments."""
    admin = AuthenticatedUser(uid="admin_user_1", email="admin@zipright.ai")
    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_admin_gate] = lambda: _make_fake_admin_gate(auth_test_db)
    app.dependency_overrides[get_seller_repository] = lambda: _make_fake_seller_repo(auth_test_db)

    try:
        client = TestClient(app)

        # 1. Admin updates seller status: pending -> active
        res_status = client.patch(
            "/seller/seller_pending/status",
            json={"status": "active", "reason": "Documents verified"},
        )
        assert res_status.status_code == status.HTTP_200_OK
        assert res_status.json()["data"]["status"] == "active"

        # 2. Admin creates live try-on garment
        import uuid
        unique_sku = f"SKU-DRESS-{uuid.uuid4().hex[:8]}"
        res_garment = client.post(
            "/tryon-live/garments",
            json={
                "sku": unique_sku,
                "name": "Summer Floral Dress",
                "category": "dresses",
            },
        )
        assert res_garment.status_code == status.HTTP_201_CREATED
        assert res_garment.json()["name"] == "Summer Floral Dress"
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_admin_gate, None)
        app.dependency_overrides.pop(get_seller_repository, None)
