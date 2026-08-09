import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_get_home_feed():
    response = client.get("/feed/home")
    assert response.status_code == 200
    payload = response.json()
    assert payload["isValid"] is True
    assert "posts" in payload["data"]


def test_get_reels_feed():
    response = client.get("/feed/reels")
    assert response.status_code == 200
    payload = response.json()
    assert payload["isValid"] is True
    assert "posts" in payload["data"]


def test_search_users():
    response = client.get("/search/users?q=stylist")
    assert response.status_code == 200
    payload = response.json()
    assert payload["isValid"] is True
    assert isinstance(payload["data"], list)


def test_search_brands():
    response = client.get("/search/brands?q=zara")
    assert response.status_code == 200
    payload = response.json()
    assert payload["isValid"] is True
    assert isinstance(payload["data"], list)


def test_public_brand_profile():
    response = client.get("/brands/nike")
    assert response.status_code == 200
    payload = response.json()
    assert payload["isValid"] is True
    assert payload["data"]["slug"] == "nike"


def test_public_brand_collections():
    response = client.get("/brands/nike/collections")
    assert response.status_code == 200
    payload = response.json()
    assert payload["isValid"] is True
    assert isinstance(payload["data"], list)
