"""M6 — Storefront Integration Widget public endpoints tests."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from main import create_app


@pytest.fixture
def public_client():
    app = create_app()
    return TestClient(app)


def _seed_store(fake_client):
    """Common fixture: seed one integration + two products."""
    fake_client.seed("seller_integrations", "seller_m6_user", {
        "seller_uid": "seller_m6_user",
        "platform": "shopify",
        "store_url": "https://m6-teststore.myshopify.com",
        "encrypted_credentials": "fake_encrypted",
        "connected_at": "2026-07-07T12:00:00Z",
    })
    fake_client.seed("sellers", "seller_m6_user", {
        "profile": {"store_name": "M6 Test Store"},
    })
    fake_client.seed("seller_products", "prod_m6_id", {
        "seller_uid": "seller_m6_user",
        "title": "M6 Designer Jacket",
        "brand": "M6 Brand",
        "category": "jacket",
        "price": "₹4,999.00",
        "images": ["https://example.com/m6_jacket.jpg"],
        "size_chart": {
            "S": {"chest": 92.0, "shoulders": 42.0},
            "M": {"chest": 100.0, "shoulders": 45.0},
            "L": {"chest": 108.0, "shoulders": 48.0},
        },
        "gender": "unisex",
        "status": "active",
    })
    fake_client.seed("seller_products", "prod_m6_shirt", {
        "seller_uid": "seller_m6_user",
        "title": "M6 Linen Shirt",
        "brand": "M6 Brand",
        "category": "shirt",
        "status": "active",
    })


# ─────────────────────────────────────────────────────────────────────────────
# Widget config
# ─────────────────────────────────────────────────────────────────────────────

def test_widget_config(public_client, fake_client):
    from firebase_config import get_firestore_client
    public_client.app.dependency_overrides[get_firestore_client] = lambda: fake_client
    _seed_store(fake_client)

    resp = public_client.get(
        "/public/widget-config",
        params={"store_url": "https://m6-teststore.myshopify.com"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["seller_uid"] == "seller_m6_user"
    assert data["store_name"] == "M6 Test Store"
    assert "zipright_app_url" in data


def test_widget_config_unknown_store(public_client, fake_client):
    from firebase_config import get_firestore_client
    public_client.app.dependency_overrides[get_firestore_client] = lambda: fake_client

    resp = public_client.get(
        "/public/widget-config",
        params={"store_url": "https://unknown-store.example.com"},
    )
    assert resp.status_code == 404


def test_widget_config_flat_seller_profile(public_client, fake_client):
    # M1 seller docs are flat (store_name at top level, no nested "profile").
    from firebase_config import get_firestore_client
    public_client.app.dependency_overrides[get_firestore_client] = lambda: fake_client
    fake_client.seed("seller_integrations", "flat_seller", {
        "seller_uid": "flat_seller",
        "store_url": "https://flatstore.example",
    })
    fake_client.seed("sellers", "flat_seller", {"status": "active", "store_name": "Flat Store"})

    resp = public_client.get(
        "/public/widget-config",
        params={"store_url": "https://flatstore.example"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["store_name"] == "Flat Store"


# ─────────────────────────────────────────────────────────────────────────────
# Products list
# ─────────────────────────────────────────────────────────────────────────────

def test_list_public_products(public_client, fake_client):
    from firebase_config import get_firestore_client
    public_client.app.dependency_overrides[get_firestore_client] = lambda: fake_client
    _seed_store(fake_client)

    resp = public_client.get(
        "/public/integration/products",
        params={"store_url": "https://m6-teststore.myshopify.com"},
    )
    assert resp.status_code == 200
    products = resp.json()["data"]
    assert isinstance(products, list)
    assert len(products) >= 1
    ids = [p["id"] for p in products]
    assert "prod_m6_id" in ids
    # Each product must expose stable ID
    for p in products:
        assert "id" in p
        assert "title" in p


def test_list_products_excludes_archived(public_client, fake_client):
    from firebase_config import get_firestore_client
    public_client.app.dependency_overrides[get_firestore_client] = lambda: fake_client
    _seed_store(fake_client)
    fake_client.seed("seller_products", "prod_archived", {
        "seller_uid": "seller_m6_user",
        "title": "Archived Product",
        "status": "archived",
    })

    resp = public_client.get(
        "/public/integration/products",
        params={"store_url": "https://m6-teststore.myshopify.com"},
    )
    assert resp.status_code == 200
    ids = [p["id"] for p in resp.json()["data"]]
    assert "prod_archived" not in ids


# ─────────────────────────────────────────────────────────────────────────────
# Product lookup — stable ID preferred
# ─────────────────────────────────────────────────────────────────────────────

def test_product_lookup_by_id(public_client, fake_client):
    """product_id (stable Firestore doc ID) resolves without title search."""
    from firebase_config import get_firestore_client
    public_client.app.dependency_overrides[get_firestore_client] = lambda: fake_client
    _seed_store(fake_client)

    resp = public_client.get(
        "/public/integration/product",
        params={
            "store_url": "https://m6-teststore.myshopify.com",
            "product_id": "prod_m6_id",
        },
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["id"] == "prod_m6_id"
    assert data["title"] == "M6 Designer Jacket"


def test_product_lookup_invalid_id_returns_404(public_client, fake_client):
    """When product_id is supplied but not found, 404 — no title fallback."""
    from firebase_config import get_firestore_client
    public_client.app.dependency_overrides[get_firestore_client] = lambda: fake_client
    _seed_store(fake_client)

    resp = public_client.get(
        "/public/integration/product",
        params={
            "store_url": "https://m6-teststore.myshopify.com",
            "product_id": "nonexistent_doc_id",
        },
    )
    assert resp.status_code == 404


def test_product_lookup_by_title_fallback(public_client, fake_client):
    """Title fallback still works when no product_id supplied."""
    from firebase_config import get_firestore_client
    public_client.app.dependency_overrides[get_firestore_client] = lambda: fake_client
    _seed_store(fake_client)

    resp = public_client.get(
        "/public/integration/product",
        params={
            "store_url": "https://m6-teststore.myshopify.com",
            "product_title": "M6 Designer Jacket",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["title"] == "M6 Designer Jacket"


# ─────────────────────────────────────────────────────────────────────────────
# Recommendation
# ─────────────────────────────────────────────────────────────────────────────

def test_public_recommendation_by_product_id(public_client, fake_client):
    from firebase_config import get_firestore_client
    public_client.app.dependency_overrides[get_firestore_client] = lambda: fake_client
    _seed_store(fake_client)

    payload = {
        "store_url": "https://m6-teststore.myshopify.com",
        "product_id": "prod_m6_id",
        "height": 175.0,
        "weight": 72.0,
        "base_size": "M",
        "fit_preference": "regular",
        "chest": 99.0,
        "waist": 82.0,
    }
    resp = public_client.post("/public/integration/recommendation", json=payload)
    assert resp.status_code == 200
    rec = resp.json()["data"]
    assert rec["size"] == "M"
    assert rec["confidence"] > 0.0
    assert "chest" in rec["reason"].lower()


def test_public_product_lookup_and_recommendation(public_client, fake_client):
    """Legacy title-based test preserved for backward compatibility."""
    from firebase_config import get_firestore_client
    public_client.app.dependency_overrides[get_firestore_client] = lambda: fake_client
    _seed_store(fake_client)

    # GET product by title
    resp = public_client.get(
        "/public/integration/product",
        params={
            "store_url": "https://m6-teststore.myshopify.com",
            "product_title": "M6 Designer Jacket",
        },
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["title"] == "M6 Designer Jacket"
    assert data["brand"] == "M6 Brand"
    assert data["price"] == "₹4,999.00"

    # POST recommendation by title
    payload = {
        "store_url": "https://m6-teststore.myshopify.com",
        "product_title": "M6 Designer Jacket",
        "height": 175.0,
        "weight": 72.0,
        "base_size": "M",
        "fit_preference": "regular",
        "chest": 99.0,
        "waist": 82.0,
    }
    resp_rec = public_client.post("/public/integration/recommendation", json=payload)
    assert resp_rec.status_code == 200
    rec_data = resp_rec.json()["data"]
    assert rec_data["size"] == "M"
    assert rec_data["confidence"] > 0.0
    assert "chest" in rec_data["reason"].lower()


def test_public_lookup_not_found(public_client, fake_client):
    from firebase_config import get_firestore_client
    public_client.app.dependency_overrides[get_firestore_client] = lambda: fake_client

    resp = public_client.get(
        "/public/integration/product",
        params={
            "store_url": "https://unregistered-store.com",
            "product_title": "Apparel",
        },
    )
    assert resp.status_code == 404
    assert "store connection configuration not found" in resp.json()["message"].lower()
