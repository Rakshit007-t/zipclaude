"""M3 — Seller Product Management tests."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from models.seller_schema import SellerProduct
from tests.test_seller_m2 import _active_seller_client, SELLER
from services.storage_provider import StorageProvider


class _MemoryStorage(StorageProvider):
    def __init__(self) -> None:
        self.calls = []
        self.uploaded = {}

    def upload_bytes(self, data, *, content_type, folder, extension):
        self.calls.append({"folder": folder, "content_type": content_type, "extension": extension})
        url = f"https://mockstorage/{folder}/image{extension}"
        self.uploaded[url] = data
        return url


def test_list_products_excludes_archived_by_default(fake_client):
    client = _active_seller_client(fake_client)
    # Seed products
    fake_client.seed("seller_products", "p1", {"seller_uid": "seller1", "title": "Nike Tee", "status": "active"})
    fake_client.seed("seller_products", "p2", {"seller_uid": "seller1", "title": "Adidas Tee", "status": "archived"})
    fake_client.seed("seller_products", "p3", {"seller_uid": "seller2", "title": "Other Tee", "status": "active"})

    resp = client.get("/seller/products")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data) == 1
    assert data[0]["title"] == "Nike Tee"


def test_list_products_filters_by_status(fake_client):
    client = _active_seller_client(fake_client)
    fake_client.seed("seller_products", "p1", {"seller_uid": "seller1", "title": "Nike Tee", "status": "active"})
    fake_client.seed("seller_products", "p2", {"seller_uid": "seller1", "title": "Adidas Tee", "status": "archived"})

    resp = client.get("/seller/products", params={"status_filter": "archived"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data) == 1
    assert data[0]["title"] == "Adidas Tee"


def test_list_products_searches_by_title_and_brand_and_category_and_tags(fake_client):
    client = _active_seller_client(fake_client)
    fake_client.seed("seller_products", "p1", {
        "seller_uid": "seller1", 
        "title": "Red Jersey", 
        "brand": "Puma", 
        "category": "activewear", 
        "tags": ["football", "dryfit"],
        "status": "active"
    })
    fake_client.seed("seller_products", "p2", {
        "seller_uid": "seller1", 
        "title": "Black Hoodie", 
        "brand": "Nike", 
        "category": "warmup", 
        "tags": ["fleece"],
        "status": "active"
    })

    # Search query matches title
    resp = client.get("/seller/products", params={"query": "jersey"})
    assert len(resp.json()["data"]) == 1

    # Search query matches brand
    resp = client.get("/seller/products", params={"query": "Puma"})
    assert len(resp.json()["data"]) == 1

    # Search query matches category
    resp = client.get("/seller/products", params={"query": "warmup"})
    assert len(resp.json()["data"]) == 1

    # Search query matches tag
    resp = client.get("/seller/products", params={"query": "fleece"})
    assert len(resp.json()["data"]) == 1


def test_get_product_details(fake_client):
    client = _active_seller_client(fake_client)
    fake_client.seed("seller_products", "p1", {"seller_uid": "seller1", "title": "Nike Tee", "status": "active"})

    # Check valid own product
    resp = client.get("/seller/products/p1")
    assert resp.status_code == 200
    assert resp.json()["data"]["title"] == "Nike Tee"

    # Check product owned by another seller
    fake_client.seed("seller_products", "p2", {"seller_uid": "seller2", "title": "Other Tee", "status": "active"})
    resp = client.get("/seller/products/p2")
    assert resp.status_code == 404


def test_update_product_succeeds(fake_client):
    client = _active_seller_client(fake_client)
    fake_client.seed("seller_products", "p1", {
        "seller_uid": "seller1", 
        "title": "Nike Tee", 
        "status": "active",
        "updated_at": "2026-07-07T12:00:00Z"
    })

    # Update title and sleeve_type
    resp = client.patch("/seller/products/p1", json={"title": "Nike Pro Tee", "sleeve_type": "short sleeve"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["title"] == "Nike Pro Tee"
    assert data["sleeve_type"] == "short sleeve"
    assert data["updated_by"] == "seller1"


def test_update_product_concurrency_conflict(fake_client):
    client = _active_seller_client(fake_client)
    fake_client.seed("seller_products", "p1", {
        "seller_uid": "seller1", 
        "title": "Nike Tee", 
        "status": "active",
        "updated_at": "2026-07-07T12:00:00Z"
    })

    # Update with mismatching expected_updated_at
    resp = client.patch("/seller/products/p1", json={"title": "Nike Pro Tee", "expected_updated_at": "2026-07-07T11:00:00Z"})
    assert resp.status_code == 409
    assert "updated by another session" in resp.json()["message"]


def test_delete_product(fake_client):
    client = _active_seller_client(fake_client)
    fake_client.seed("seller_products", "p1", {"seller_uid": "seller1", "title": "Nike Tee", "status": "active"})

    resp = client.delete("/seller/products/p1")
    assert resp.status_code == 200
    assert resp.json()["data"]["deleted"] is True
    assert "p1" not in fake_client.collections.get("seller_products", {})


def test_bulk_archive_restore_delete(fake_client):
    client = _active_seller_client(fake_client)
    fake_client.seed("seller_products", "p1", {"seller_uid": "seller1", "title": "Tee 1", "status": "active"})
    fake_client.seed("seller_products", "p2", {"seller_uid": "seller1", "title": "Tee 2", "status": "active"})

    # Bulk Archive
    resp = client.post("/seller/products/bulk", json={"ids": ["p1", "p2"], "operation": "archive"})
    assert resp.status_code == 200
    assert resp.json()["data"]["count"] == 2
    assert fake_client.collections["seller_products"]["p1"]["status"] == "archived"
    assert fake_client.collections["seller_products"]["p2"]["status"] == "archived"

    # Bulk Restore
    resp = client.post("/seller/products/bulk", json={"ids": ["p1", "p2"], "operation": "restore"})
    assert resp.status_code == 200
    assert resp.json()["data"]["count"] == 2
    assert fake_client.collections["seller_products"]["p1"]["status"] == "active"
    assert fake_client.collections["seller_products"]["p2"]["status"] == "active"

    # Bulk Delete
    resp = client.post("/seller/products/bulk", json={"ids": ["p1", "p2"], "operation": "delete"})
    assert resp.status_code == 200
    assert resp.json()["data"]["count"] == 2
    assert len(fake_client.collections["seller_products"]) == 0


def test_duplicate_product(fake_client):
    client = _active_seller_client(fake_client)
    fake_client.seed("seller_products", "p1", {
        "seller_uid": "seller1", 
        "title": "Air Max", 
        "brand": "Nike", 
        "status": "active",
        "colors": ["black"]
    })

    resp = client.post("/seller/products/p1/duplicate")
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["id"] != "p1"
    assert data["title"] == "Air Max Copy"
    assert data["brand"] == "Nike"
    assert data["colors"] == ["black"]
    assert len(fake_client.collections["seller_products"]) == 2


def test_upload_product_image(fake_client):
    client = _active_seller_client(fake_client)
    from services.storage_provider import get_storage_provider

    fake_storage = _MemoryStorage()
    client.app.dependency_overrides[get_storage_provider] = lambda: fake_storage

    file_content = b"fakeimagebytes"
    resp = client.post(
        "/seller/products/upload-image",
        files={"file": ("product.jpg", file_content, "image/jpeg")}
    )
    assert resp.status_code == 201
    url = resp.json()["data"]["url"]
    assert url.startswith("https://mockstorage/seller-products/")
    assert fake_storage.uploaded[url] == file_content
