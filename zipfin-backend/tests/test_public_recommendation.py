"""Regression: the public storefront recommendation endpoint must forward a
valid ``str`` user_id ("" for anonymous shoppers), not None — so the size
engine's calibration layer stays active on the public path."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import routes.public as public
from main import create_app
from models.schema import SizeEngineResponse


@pytest.fixture
def public_client():
    return TestClient(create_app())


def _seed_store_and_product(fake_client) -> None:
    fake_client.seed("seller_integrations", "sellerX", {
        "seller_uid": "sellerX",
        "store_url": "https://store.example",
    })
    fake_client.seed("seller_products", "prodX", {
        "seller_uid": "sellerX",
        "title": "Tee",
        "brand": "TightCo",
        "category": "tshirt",
        "status": "active",
        "size_chart": {"M": 100.0},
    })


def test_public_recommendation_forwards_empty_string_user_id(public_client, fake_client, monkeypatch):
    from firebase_config import get_firestore_client

    public_client.app.dependency_overrides[get_firestore_client] = lambda: fake_client
    _seed_store_and_product(fake_client)

    captured: dict[str, object] = {}

    async def _spy(request, user_id=""):
        captured["user_id"] = user_id
        return SizeEngineResponse(size="M", confidence=90.0, risk="low", reason="ok")

    monkeypatch.setattr(public, "calculate_size_recommendation", _spy)

    resp = public_client.post(
        "/public/integration/recommendation",
        json={
            "store_url": "https://store.example",
            "product_id": "prodX",
            "height": 175,
            "weight": 70,
            "base_size": "M",
            "fit_preference": "regular",
            "chest": 100,
        },
    )

    assert resp.status_code == 200
    assert captured["user_id"] == ""
    assert captured["user_id"] is not None
