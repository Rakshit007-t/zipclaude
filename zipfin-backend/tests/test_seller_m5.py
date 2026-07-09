"""M5 — E-commerce Integration tests."""

from __future__ import annotations

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from tests.test_seller_m2 import _active_seller_client
from services.ecommerce_service import encrypt_credentials, decrypt_credentials


@pytest.fixture(autouse=True)
def _allow_private_store_urls(monkeypatch):
    # These tests mock requests.get and use public hosts; bypass the SSRF DNS
    # check so they stay hermetic (no real network resolution).
    monkeypatch.setenv("ZIPRIGHT_ALLOW_PRIVATE_STORE_URLS", "1")


def test_credential_encryption():
    creds = {"access_token": "shpat_1234abcd", "api_key": "somekey"}
    encrypted = encrypt_credentials(creds)
    assert isinstance(encrypted, str)
    assert encrypted != "shpat_1234abcd"
    
    decrypted = decrypt_credentials(encrypted)
    assert decrypted["access_token"] == "shpat_1234abcd"
    assert decrypted["api_key"] == "somekey"


@patch("requests.get")
def test_shopify_connect_and_sync(mock_get, fake_client):
    client = _active_seller_client(fake_client)

    from firebase_config import get_firestore_client
    client.app.dependency_overrides[get_firestore_client] = lambda: fake_client

    # 1. Mock connection verification response (GET shop.json)
    mock_resp_connect = MagicMock()
    mock_resp_connect.status_code = 200
    mock_resp_connect.json.return_value = {"shop": {"name": "Crown shop"}}

    # 2. Mock fetch products response (GET products.json)
    mock_resp_products = MagicMock()
    mock_resp_products.status_code = 200
    mock_resp_products.json.return_value = {
        "products": [
            {
                "id": 111111,
                "title": "Shopify Tee",
                "body_html": "<p>Soft cotton</p>",
                "vendor": "Shopify vendor",
                "product_type": "clothing",
                "tags": "cotton, basic",
                "variants": [
                    {"title": "M", "price": "1499.00"}
                ],
                "images": [
                    {"src": "https://example.com/shopify_tee.jpg"}
                ]
            }
        ]
    }

    # Setup mock_get side effects
    mock_get.side_effect = [mock_resp_connect, mock_resp_products]

    # Connect Shopify Integration
    payload = {
        "platform": "shopify",
        "store_url": "https://test-crown.myshopify.com",
        "credentials": {"access_token": "shpat_testtoken"}
    }
    resp = client.post("/seller/integration/connect", json=payload)
    assert resp.status_code == 200
    assert resp.json()["data"]["platform"] == "shopify"
    assert resp.json()["data"]["store_url"] == "https://test-crown.myshopify.com"

    # Status check
    resp_status = client.get("/seller/integration/status")
    assert resp_status.status_code == 200
    assert resp_status.json()["data"]["platform"] == "shopify"

    # Trigger manual sync
    resp_sync = client.post("/seller/integration/sync")
    assert resp_sync.status_code == 200
    assert resp_sync.json()["data"]["synced_count"] == 1

    # Check that product has been saved in seller_products repository
    products = fake_client.collections.get("seller_products", {})
    assert len(products) == 1
    p_id = list(products.keys())[0]
    p_data = products[p_id]
    assert p_data["title"] == "Shopify Tee"
    assert p_data["brand"] == "Shopify vendor"
    assert p_data["category"] == "clothing"
    assert p_data["price"] == "₹1499.00"
    assert p_data["images"] == ["https://example.com/shopify_tee.jpg"]
    assert p_data["size_chart"] == {"M": 100}
    assert p_data["status"] == "active"

    # Check sync history logs
    resp_hist = client.get("/seller/integration/history")
    assert resp_hist.status_code == 200
    history = resp_hist.json()["data"]
    assert len(history) == 1
    assert history[0]["status"] == "success"
    assert history[0]["products_synced_count"] == 1


@patch("requests.get")
def test_woocommerce_connect_and_sync(mock_get, fake_client):
    client = _active_seller_client(fake_client)

    from firebase_config import get_firestore_client
    client.app.dependency_overrides[get_firestore_client] = lambda: fake_client

    # Mock system status connect
    mock_resp_connect = MagicMock()
    mock_resp_connect.status_code = 200

    # Mock Woo products JSON
    mock_resp_products = MagicMock()
    mock_resp_products.status_code = 200
    mock_resp_products.json.return_value = [
        {
            "id": 2222,
            "name": "Woo Hood",
            "description": "<p>Warm jacket</p>",
            "price": "2990.00",
            "categories": [{"name": "apparel"}],
            "images": [{"src": "https://example.com/woo_hood.jpg"}],
            "attributes": [
                {
                    "name": "Size",
                    "options": ["L"]
                }
            ]
        }
    ]

    mock_get.side_effect = [mock_resp_connect, mock_resp_products]

    # Connect WooCommerce
    payload = {
        "platform": "woocommerce",
        "store_url": "https://mywoo.local",
        "credentials": {
            "consumer_key": "ck_test",
            "consumer_secret": "cs_test"
        }
    }
    resp = client.post("/seller/integration/connect", json=payload)
    assert resp.status_code == 200
    assert resp.json()["data"]["platform"] == "woocommerce"

    # Sync
    resp_sync = client.post("/seller/integration/sync")
    assert resp_sync.status_code == 200
    assert resp_sync.json()["data"]["synced_count"] == 1

    # Verify saved WooCommerce product
    products = fake_client.collections.get("seller_products", {})
    assert len(products) == 1
    p_id = list(products.keys())[0]
    p_data = products[p_id]
    assert p_data["title"] == "Woo Hood"
    assert p_data["brand"] == "WooCommerce Store"
    assert p_data["category"] == "apparel"
    assert p_data["price"] == "₹2990.00"
    assert p_data["size_chart"] == {"L": 100}


def test_disconnect_store(fake_client):
    client = _active_seller_client(fake_client)

    from firebase_config import get_firestore_client
    client.app.dependency_overrides[get_firestore_client] = lambda: fake_client

    # Seed an integration config
    fake_client.seed("seller_integrations", "seller1", {
        "seller_uid": "seller1",
        "platform": "rest",
        "store_url": "https://rest.store",
        "encrypted_credentials": "fake_encrypted",
        "connected_at": "2026-07-07T12:00:00Z"
    })

    # Disconnect
    resp = client.post("/seller/integration/disconnect")
    assert resp.status_code == 200
    assert resp.json()["data"]["disconnected"] is True

    # Get status is now empty
    status_resp = client.get("/seller/integration/status")
    assert status_resp.status_code == 200
    assert status_resp.json()["data"] is None
