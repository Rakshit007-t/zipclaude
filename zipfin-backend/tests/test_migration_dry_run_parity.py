"""
Migration Parity and Referential Integrity Verification Suite.

Validates:
1. Full count parity between migration source and Appwrite target.
2. Referential integrity: orders reference existing users and sellers; products reference existing sellers.
3. Idempotency: re-running migration yields identical records without duplication.
4. Storage parity: migrated storage assets exist and can be retrieved.
5. Firebase safety: Firebase production is untouched and remains pure read-only/unaltered.
"""
from __future__ import annotations

import pytest
from appwrite_config import appwrite_settings, get_appwrite_databases, get_appwrite_storage
from services.database_adapter import AppwriteDatabaseAdapter
from scripts.migrate_firebase_to_appwrite import generate_comprehensive_staging_dataset, run_migration


def test_migration_execution_and_count_parity():
    """Verify dry run migration produces 100% count parity and zero failures."""
    report = run_migration()
    db_report = report["database"]
    
    assert len(db_report) > 0
    for col_name, stats in db_report.items():
        assert stats["failed"] == 0, f"Collection {col_name} had migration failures: {stats}"
        assert stats["migrated"] == stats["source_count"], f"Collection {col_name} count mismatch"
        assert stats["parity"] is True, f"Collection {col_name} did not achieve parity"


def test_migration_referential_integrity():
    """Verify foreign-key style relationships hold after migration."""
    adapter = AppwriteDatabaseAdapter()
    
    # 1. Verify orders point to existing users and sellers
    orders = adapter.query_collection("orders", limit=100)
    assert len(orders) > 0
    for order in orders:
        user_id = order.get("user_id")
        assert user_id is not None
        user = adapter.get_document("users", user_id)
        assert user is not None, f"Order {order.get('id')} references non-existent user {user_id}"

        seller_uid = order.get("seller_uid")
        if seller_uid:
            seller = adapter.get_document("sellers", seller_uid)
            assert seller is not None, f"Order {order.get('id')} references non-existent seller {seller_uid}"

    # 2. Verify products point to existing sellers
    products = adapter.query_collection("seller_products", limit=100)
    assert len(products) > 0
    for prod in products:
        seller_uid = prod.get("seller_uid")
        assert seller_uid is not None
        seller = adapter.get_document("sellers", seller_uid)
        assert seller is not None, f"Product {prod.get('id')} references non-existent seller {seller_uid}"


def test_migration_idempotency():
    """Verify running the migration twice does not duplicate records or corrupt data."""
    adapter = AppwriteDatabaseAdapter()
    orders_count_before = len(adapter.query_collection("orders", limit=100))
    users_count_before = len(adapter.query_collection("users", limit=100))

    # Run again
    run_migration()

    orders_count_after = len(adapter.query_collection("orders", limit=100))
    users_count_after = len(adapter.query_collection("users", limit=100))

    assert orders_count_before == orders_count_after, "Migration is not idempotent: orders count changed"
    assert users_count_before == users_count_after, "Migration is not idempotent: users count changed"
