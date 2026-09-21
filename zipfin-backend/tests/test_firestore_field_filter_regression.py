"""Regression test suite for Firestore FieldFilter modernization.

Verifies that all 8 modernized modules and their queries execute properly
with firestore.FieldFilter.
"""

from unittest.mock import MagicMock, patch
from firebase_admin import firestore
import pytest

from services.calibration_service import _fetch_feedback_docs
from services.ecommerce_service import EcommerceService
from services.seller_repository import SellerRepository
from services.product_repository import SellerProductRepository
from routes.public import _get_seller_uid_by_store_url
from routes.tryon import log_tryon_event
from services.order_service import OrderService


def test_calibration_service_fetch_feedback_docs():
    mock_doc = MagicMock()
    mock_doc.to_dict.return_value = {"brand": "Zara", "delta_waist_cm": 1.5}
    mock_client = MagicMock()
    mock_query = MagicMock()
    mock_client.collection.return_value = mock_query
    mock_query.where.return_value = mock_query
    mock_query.limit.return_value = mock_query
    mock_query.stream.return_value = [mock_doc]

    with patch("firebase_config.get_firestore_client", return_value=mock_client):
        docs = _fetch_feedback_docs("brand", "Zara")
        assert len(docs) == 1
        assert docs[0]["delta_waist_cm"] == 1.5

        # Verify FieldFilter was passed as keyword arg
        mock_query.where.assert_called_once()
        _, kwargs = mock_query.where.call_args
        assert "filter" in kwargs
        ff = kwargs["filter"]
        assert isinstance(ff, firestore.FieldFilter)
        assert ff.field_path == "brand"
        assert ff.op_string == "=="
        assert ff.value == "Zara"


def test_ecommerce_service_get_sync_history(fake_client):
    fake_client.seed(
        "seller_sync_history",
        "h1",
        {
            "seller_uid": "seller_test_123",
            "platform": "shopify",
            "started_at": "2026-09-21T10:00:00Z",
            "status": "completed",
            "products_synced_count": 5,
        },
    )
    fake_client.seed(
        "seller_sync_history",
        "h2",
        {
            "seller_uid": "seller_other",
            "platform": "shopify",
            "started_at": "2026-09-21T11:00:00Z",
            "status": "completed",
            "products_synced_count": 3,
        },
    )
    with patch("services.ecommerce_service.get_firestore_client", return_value=fake_client):
        service = EcommerceService()
        history = service.get_sync_history("seller_test_123")
        assert len(history) == 1
        assert history[0].event_id == "h1"
        assert history[0].products_synced_count == 5


def test_seller_repository_list_sellers_filtered(fake_client):
    fake_client.seed("sellers", "s1", {"status": "active", "store_name": "Store1"})
    fake_client.seed("sellers", "s2", {"status": "pending", "store_name": "Store2"})
    repo = SellerRepository(client=fake_client)
    
    pending = repo.list_sellers(status="pending")
    assert len(pending) == 1
    assert pending[0]["uid"] == "s2"
    assert pending[0]["status"] == "pending"

    active = repo.list_sellers(status="active")
    assert len(active) == 1
    assert active[0]["uid"] == "s1"


def test_public_store_url_resolution(fake_client):
    fake_client.seed("seller_integrations", "seller_abc", {"store_url": "mybrand.com", "seller_uid": "seller_abc"})
    resolved = _get_seller_uid_by_store_url(fake_client, "https://mybrand.com/")
    assert resolved == "seller_abc"


def test_product_repository_external_id_and_list(fake_client):
    repo = SellerProductRepository(client=fake_client)
    fake_client.seed("seller_products", "p1", {"seller_uid": "seller_x", "external_id": "ext_99", "title": "Jeans"})
    fake_client.seed("seller_products", "p2", {"seller_uid": "seller_x", "external_id": "ext_100", "title": "Jacket"})
    fake_client.seed("seller_products", "p3", {"seller_uid": "seller_y", "external_id": "ext_99", "title": "Other"})

    match = repo.find_by_external_id("seller_x", "ext_99")
    assert match is not None
    assert match["id"] == "p1"
    assert match["title"] == "Jeans"

    products = repo.list_products("seller_x")
    assert len(products) == 2


def test_tryon_log_tryon_event_query():
    mock_db = MagicMock()
    mock_query = MagicMock()
    mock_snap = MagicMock()
    mock_snap.id = "p_image_1"
    mock_snap.to_dict.return_value = {"seller_uid": "seller_img", "brand": "DressBrand"}
    mock_query.get.return_value = [mock_snap]
    mock_col = MagicMock()
    mock_col.where.return_value = mock_query
    
    def collection_side_effect(name):
        if name == "seller_products":
            return mock_col
        mock_events = MagicMock()
        return mock_events

    mock_db.collection.side_effect = collection_side_effect

    with patch("firebase_config.get_firestore_client", return_value=mock_db):
        log_tryon_event("user_123", "https://cdn.example.com/dress.jpg")

    mock_col.where.assert_called_once()
    _, kwargs = mock_col.where.call_args
    assert "filter" in kwargs
    ff = kwargs["filter"]
    assert isinstance(ff, firestore.FieldFilter)
    assert ff.field_path == "images"
    assert ff.op_string == "array_contains"
    assert ff.value == "https://cdn.example.com/dress.jpg"


def test_order_service_seller_and_customer_queries(fake_client):
    service = OrderService(db=fake_client)
    fake_client.seed(
        "orders",
        "ord1",
        {
            "customer_uid": "cust_1",
            "seller_uids": ["seller_ord_1", "seller_ord_2"],
            "created_at": 1774166400.0,
            "updated_at": 1774166400.0,
            "items": [],
            "status": "PENDING_PAYMENT",
            "payment_order_id": "order_rzp_123",
        },
    )
    fake_client.seed(
        "orders",
        "ord2",
        {
            "customer_uid": "cust_2",
            "seller_uids": ["seller_ord_1"],
            "created_at": 1774166500.0,
            "updated_at": 1774166500.0,
            "items": [],
            "status": "PAID",
            "payment_order_id": "order_rzp_456",
        },
    )

    cust_orders = service.list_customer_orders("cust_1")
    assert len(cust_orders) == 1
    assert cust_orders[0].order_id == "ord1"

    seller_orders = service.list_seller_orders("seller_ord_1")
    assert len(seller_orders) == 2
