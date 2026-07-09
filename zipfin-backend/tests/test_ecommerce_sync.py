"""Ecommerce sync upsert: re-syncing a store updates products in place
(keyed by external_id) instead of duplicating the catalogue."""

from __future__ import annotations

import pytest

from services import ecommerce_service as es
from services.ecommerce_service import EcommerceService, encrypt_credentials
from services.product_repository import SellerProductRepository


# --- repository upsert unit behaviour ----------------------------------------


def test_upsert_creates_then_updates(fake_client):
    repo = SellerProductRepository(fake_client)
    repo.upsert_product("s1", {"title": "A", "external_id": "rest:1", "price": "10", "status": "active"})
    assert len(fake_client.collections["seller_products"]) == 1
    updated = repo.upsert_product("s1", {"title": "A", "external_id": "rest:1", "price": "12", "status": "active"})
    assert len(fake_client.collections["seller_products"]) == 1
    assert updated["price"] == "12"


def test_upsert_without_external_id_always_creates(fake_client):
    repo = SellerProductRepository(fake_client)
    repo.upsert_product("s1", {"title": "A", "external_id": "", "status": "active"})
    repo.upsert_product("s1", {"title": "A", "status": "active"})
    assert len(fake_client.collections["seller_products"]) == 2


def test_upsert_is_scoped_per_seller(fake_client):
    # Same external_id under two different sellers must not collide.
    repo = SellerProductRepository(fake_client)
    repo.upsert_product("s1", {"title": "A", "external_id": "rest:1", "status": "active"})
    repo.upsert_product("s2", {"title": "A", "external_id": "rest:1", "status": "active"})
    assert len(fake_client.collections["seller_products"]) == 2


# --- end-to-end sync through EcommerceService --------------------------------


class _StubProvider:
    def __init__(self, products):
        self._products = products

    def fetch_products(self):
        return list(self._products)

    def normalize_product(self, raw):
        return {"title": raw["title"], "price": raw.get("price")}


def _seed_integration(fake_client):
    fake_client.seed("seller_integrations", "sellerZ", {
        "seller_uid": "sellerZ",
        "platform": "rest",
        "store_url": "https://store.example",
        "encrypted_credentials": encrypt_credentials({"api_key": "k"}),
        "connected_at": "2026-07-08T00:00:00Z",
    })


def test_resync_upserts_instead_of_duplicating(fake_client, monkeypatch):
    monkeypatch.setenv("ZIPRIGHT_ALLOW_PRIVATE_STORE_URLS", "1")  # hermetic SSRF guard
    _seed_integration(fake_client)

    products = [{"id": 1, "title": "A", "price": "10"}, {"id": 2, "title": "B", "price": "20"}]
    monkeypatch.setattr(es, "get_provider", lambda *a, **k: _StubProvider(products))

    service = EcommerceService(fake_client)
    repo = SellerProductRepository(fake_client)

    assert service.trigger_sync("sellerZ", repo) == 2
    assert len(fake_client.collections["seller_products"]) == 2

    products[0]["price"] = "15"  # price changed upstream
    assert service.trigger_sync("sellerZ", repo) == 2
    assert len(fake_client.collections["seller_products"]) == 2  # no duplicates

    prices = {p["title"]: p["price"] for p in fake_client.collections["seller_products"].values()}
    assert prices["A"] == "15"
    assert prices["B"] == "20"
