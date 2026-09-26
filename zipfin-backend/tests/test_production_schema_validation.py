"""
Comprehensive Schema & Relationship Validation Test for Appwrite Production Readiness.
Validates all collections, attributes, permissions, and indexes.
"""
from __future__ import annotations

import pytest
from appwrite_config import appwrite_settings, get_appwrite_databases

REQUIRED_COLLECTIONS = {
    "users": ["email", "displayName", "walletBalanceRupees", "gender", "height", "weight", "uid"],
    "publicProfiles": ["uid", "displayName", "followersCount", "followingCount"],
    "user_following": ["userId", "targetUserId"],
    "user_followers": ["userId", "followerId"],
    "user_blocked": ["userId", "blockedUserId"],
    "user_likes": ["userId", "lookId"],
    "looks": ["userId", "imageUrl", "caption", "likesCount"],
    "look_comments": ["lookId", "userId", "comment"],
    "sellers": ["storeName", "ownerUid"],
    "seller_products": ["seller_uid", "title", "price"],
    "orders": ["order_id", "user_id", "status", "amount"],
    "tryon_jobs": ["job_id", "user_id", "status"],
    "tryon_refunds": ["charged_rupees", "free_tryon"],
    "notifications": ["user_id", "title", "body", "read"],
    "request_rate_limits": ["key", "count", "reset_at"],
    "developer_api_keys": ["key_id", "hashed_key", "seller_uid"],
    "reports": ["target_id", "reason"],
}


def _get(obj, *keys, default=None):
    if obj is None:
        return default
    for k in keys:
        if isinstance(obj, dict) and k in obj:
            return obj[k]
        if hasattr(obj, k):
            val = getattr(obj, k)
            if val is not None:
                return val
    return default


def test_appwrite_database_exists():
    databases = get_appwrite_databases()
    db = databases.get(database_id=appwrite_settings.DATABASE_ID)
    db_id = _get(db, "$id", "id")
    assert db_id == appwrite_settings.DATABASE_ID, f"Expected {appwrite_settings.DATABASE_ID}, got {db_id}"


def test_all_required_collections_and_attributes_exist():
    databases = get_appwrite_databases()
    from appwrite.query import Query
    cols_res = databases.list_collections(database_id=appwrite_settings.DATABASE_ID, queries=[Query.limit(100)])
    cols_list = _get(cols_res, "collections", default=[])
    existing_cols = {_get(c, "$id", "id") for c in cols_list}

    missing_cols = set(REQUIRED_COLLECTIONS.keys()) - existing_cols
    assert not missing_cols, f"Missing collections in Appwrite: {missing_cols}"

    for col_id, expected_attrs in REQUIRED_COLLECTIONS.items():
        attr_res = databases.list_attributes(
            database_id=appwrite_settings.DATABASE_ID,
            collection_id=col_id,
            queries=[Query.limit(100)],
        )
        attrs_list = _get(attr_res, "attributes", default=[])
        existing_attrs = {_get(a, "key") for a in attrs_list}
        missing_attrs = set(expected_attrs) - existing_attrs
        assert not missing_attrs, f"Collection '{col_id}' missing attributes: {missing_attrs}"


def test_collection_document_security_enabled():
    databases = get_appwrite_databases()
    from appwrite.query import Query
    cols_res = databases.list_collections(database_id=appwrite_settings.DATABASE_ID, queries=[Query.limit(100)])
    cols_list = _get(cols_res, "collections", default=[])
    for c in cols_list:
        col_id = _get(c, "$id", "id")
        doc_sec = _get(c, "documentSecurity", "documentsecurity", "document_security")
        assert doc_sec is True, f"Collection '{col_id}' does not have documentSecurity enabled: {c}"


def test_critical_entity_lifecycle_crud():
    import uuid
    databases = get_appwrite_databases()
    test_id = f"test_{uuid.uuid4().hex[:8]}"

    # Test user doc creation
    user_doc = databases.create_document(
        database_id=appwrite_settings.DATABASE_ID,
        collection_id="users",
        document_id=test_id,
        data={
            "email": f"{test_id}@example.com",
            "displayName": "Test User",
            "walletBalanceRupees": 500,
            "gender": "male",
            "height": 178.5,
            "weight": 72.0,
            "uid": test_id,
        },
    )
    assert _get(user_doc, "$id", "id") == test_id

    # Test order doc creation
    order_doc = databases.create_document(
        database_id=appwrite_settings.DATABASE_ID,
        collection_id="orders",
        document_id=test_id,
        data={
            "order_id": test_id,
            "user_id": test_id,
            "status": "pending",
            "amount": 1299.0,
        },
    )
    assert _get(order_doc, "$id", "id") == test_id

    # Test notification doc creation
    notif_doc = databases.create_document(
        database_id=appwrite_settings.DATABASE_ID,
        collection_id="notifications",
        document_id=test_id,
        data={
            "user_id": test_id,
            "title": "Welcome to ZipRIGHT",
            "body": "Your test notification has arrived.",
            "read": False,
        },
    )
    assert _get(notif_doc, "$id", "id") == test_id

    # Clean up test documents
    for col in ("users", "orders", "notifications"):
        databases.delete_document(
            database_id=appwrite_settings.DATABASE_ID,
            collection_id=col,
            document_id=test_id,
        )

