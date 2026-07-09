"""M4 — Seller Dashboard tests."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.test_seller_m2 import _active_seller_client


def test_seller_dashboard_aggregates_metrics(fake_client):
    client = _active_seller_client(fake_client)
    
    # Override get_firestore_client dependency
    from firebase_config import get_firestore_client
    client.app.dependency_overrides[get_firestore_client] = lambda: fake_client

    # 1. Seed Seller Profile
    fake_client.seed("sellers", "seller1", {
        "store_name": "Crown Threads",
        "email": "store@example.com",
        "status": "active"
    })

    # 2. Seed Seller Products
    fake_client.seed("seller_products", "p1", {
        "seller_uid": "seller1",
        "title": "Elite Tee",
        "status": "active",
        "brand": "Crown Threads",
        "created_at": "2026-07-07T12:00:00Z",
        "updated_at": "2026-07-07T12:00:00Z"
    })

    # 3. Seed Try-on Events
    fake_client.seed("tryon_events", "t1", {
        "user_id": "user123",
        "product_id": "p1",
        "seller_uid": "seller1",
        "brand": "Crown Threads",
        "timestamp": "2026-07-07T13:00:00Z"
    })

    # 4. Seed Recommendation Events
    fake_client.seed("recommendation_generated_events", "r1", {
        "userId": "user123",
        "productTitle": "Elite Tee",
        "brand": "Crown Threads",
        "normalizedBrand": "crownthreads",
        "timestamp": "2026-07-07T13:05:00Z"
    })

    # 5. Seed Feedback Events
    fake_client.seed("size_feedback", "f1", {
        "user_id": "user123",
        "product_id": "p1",
        "product_title": "Elite Tee",
        "brand": "Crown Threads",
        "outcome": "kept",
        "created_at": "2026-07-07T13:10:00Z"
    })

    # Fetch Dashboard
    resp = client.get("/seller/dashboard")
    assert resp.status_code == 200
    data = resp.json()["data"]

    # Assert metric counters
    assert data["total_products"] == 1
    assert data["active_products"] == 1
    assert data["archived_products"] == 0
    assert data["total_tryons"] == 1
    assert data["total_recs"] == 1
    assert data["feedback_count"] == 1

    # Assert popular products analytics
    popular = data["popular_products"]
    assert len(popular) == 1
    assert popular[0]["id"] == "p1"
    assert popular[0]["tryon_count"] == 1
    assert popular[0]["recommendation_count"] == 1
    assert popular[0]["feedback_count"] == 1
    assert popular[0]["accuracy"] == 100.0

    # Assert activity feed
    activity = data["recent_activity"]
    assert len(activity) > 0
    assert any(ev["type"] == "product_created" for ev in activity)
    assert any(ev["type"] == "feedback_received" for ev in activity)
