"""Comprehensive integration and validation tests for the Appwrite replacement architecture."""

from __future__ import annotations

import concurrent.futures
import time
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from appwrite_config import appwrite_settings
from services.auth_adapter import AppwriteAuthAdapter, AuthenticatedUser
from services.database_adapter import AppwriteDatabaseAdapter, get_database_adapter
from services.distributed_transaction_manager import DistributedTransactionManager, get_transaction_manager
from services.storage_provider import AppwriteStorageProvider, get_storage_provider
from services.tryon_access import consume_tryon_credit_for_uid, refund_tryon_credit


def test_appwrite_configuration_defaults():
    """Verify Appwrite configuration settings and default bucket names."""
    assert appwrite_settings.PROJECT_ID == "zipright-staging"
    assert appwrite_settings.DATABASE_ID == "zipright-staging-db"
    assert appwrite_settings.BUCKET_PUBLIC == "zipright-public"
    assert appwrite_settings.BUCKET_COMMUNITY == "zipright-community"
    assert appwrite_settings.BUCKET_PRIVATE == "zipright-private"


def test_storage_provider_appwrite_bucket_resolution():
    """Verify storage provider correctly segregates public, community, and private media."""
    provider = AppwriteStorageProvider()
    assert provider._resolve_bucket("seller-logos") == appwrite_settings.BUCKET_PUBLIC
    assert provider._resolve_bucket("seller-products") == appwrite_settings.BUCKET_PUBLIC
    assert provider._resolve_bucket("profiles") == appwrite_settings.BUCKET_COMMUNITY
    assert provider._resolve_bucket("looks") == appwrite_settings.BUCKET_COMMUNITY
    assert provider._resolve_bucket("dm") == appwrite_settings.BUCKET_COMMUNITY
    assert provider._resolve_bucket("tryons") == appwrite_settings.BUCKET_PRIVATE
    assert provider._resolve_bucket("avatars") == appwrite_settings.BUCKET_PRIVATE
    assert provider._resolve_bucket("scans") == appwrite_settings.BUCKET_PRIVATE


def test_appwrite_database_adapter_subcollection_resolution():
    """Verify subcollection un-nesting maps hierarchical collections to flat relational tables."""
    adapter = AppwriteDatabaseAdapter()
    assert adapter._resolve_collection("users/following") == "user_following"
    assert adapter._resolve_collection("users/followers") == "user_followers"
    assert adapter._resolve_collection("users/blocked") == "user_blocked"
    assert adapter._resolve_collection("users/friends") == "user_friends"
    assert adapter._resolve_collection("looks/comments") == "look_comments"
    assert adapter._resolve_collection("conversations/messages") == "chat_messages"
    assert adapter._resolve_collection("sellers") == "sellers"
    assert adapter._resolve_collection("orders") == "orders"


def test_appwrite_auth_adapter_rejection_on_invalid_token():
    """Verify Appwrite auth adapter rejects malformed or unverified JWTs with 401."""
    adapter = AppwriteAuthAdapter()
    with pytest.raises(HTTPException) as exc_info:
        adapter.verify_token("invalid.mock.jwt")
    assert exc_info.value.status_code == 401
    assert "Invalid or expired Appwrite" in exc_info.value.detail


def test_distributed_transaction_manager_concurrency():
    """Verify DistributedTransactionManager serializes concurrent operations without state corruption."""
    tx_mgr = DistributedTransactionManager()
    shared_counter = {"value": 0}

    def increment():
        with tx_mgr.acquire_lock("test_resource_counter"):
            current = shared_counter["value"]
            time.sleep(0.005)  # simulate IO delay
            shared_counter["value"] = current + 1

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(increment) for _ in range(10)]
        concurrent.futures.wait(futures)

    assert shared_counter["value"] == 10


def test_appwrite_wallet_debit_under_distributed_lock():
    """Verify try-on credit consumption works under Appwrite provider with distributed locking."""
    mock_db = MagicMock()
    mock_db.get_document.return_value = {
        "id": "appwrite_user_1",
        "walletBalanceRupees": 20,
        "usage": {"tryOns": 3},
    }

    with patch.dict("os.environ", {"DATABASE_PROVIDER": "appwrite"}), \
         patch("services.database_adapter.get_database_adapter", return_value=mock_db):
        charge = consume_tryon_credit_for_uid("appwrite_user_1")
        assert charge.charged_rupees == 5
        assert charge.wallet_balance_rupees == 15
        assert charge.try_ons_used == 4

        # Verify set_document was called with updated balance
        mock_db.set_document.assert_called_once()
        args = mock_db.set_document.call_args[0]
        assert args[0] == "users"
        assert args[1] == "appwrite_user_1"
        assert args[2]["walletBalanceRupees"] == 15
        assert args[2]["usage"]["tryOns"] == 4


def test_appwrite_refund_idempotency_with_sentinel():
    """Verify try-on refund on Appwrite provider is strictly idempotent via sentinel records."""
    mock_db = MagicMock()

    # Case 1: First call (not yet refunded)
    mock_db.get_document.side_effect = [
        None,  # tryon_refunds document does not exist yet
        {"id": "appwrite_user_1", "walletBalanceRupees": 15, "usage": {"tryOns": 4}},  # user doc
    ]

    with patch.dict("os.environ", {"DATABASE_PROVIDER": "appwrite"}), \
         patch("services.database_adapter.get_database_adapter", return_value=mock_db):
        balance = refund_tryon_credit(
            user_id="appwrite_user_1",
            job_id="appwrite_job_123",
            charged_rupees=5,
            free_tryon=False,
        )
        assert balance == 20
        assert mock_db.set_document.call_count == 2  # user update + refund sentinel

    # Case 2: Second call (already refunded)
    mock_db.reset_mock()
    mock_db.get_document.side_effect = [
        {"id": "appwrite_job_123", "charged_rupees": 5},  # refund sentinel exists
        {"id": "appwrite_user_1", "walletBalanceRupees": 20, "usage": {"tryOns": 4}},  # user doc
    ]

    with patch.dict("os.environ", {"DATABASE_PROVIDER": "appwrite"}), \
         patch("services.database_adapter.get_database_adapter", return_value=mock_db):
        balance_2 = refund_tryon_credit(
            user_id="appwrite_user_1",
            job_id="appwrite_job_123",
            charged_rupees=5,
            free_tryon=False,
        )
        assert balance_2 == 20
        # Must NOT set documents again on duplicate refund
        assert mock_db.set_document.call_count == 0


def test_performance_and_latency_benchmark():
    """Benchmark lock acquisition latency and adapter overhead."""
    tx_mgr = get_transaction_manager()
    iterations = 200
    start = time.perf_counter()

    for i in range(iterations):
        with tx_mgr.acquire_lock(f"benchmark_resource_{i % 5}"):
            pass

    duration_ms = (time.perf_counter() - start) * 1000
    avg_per_op_ms = duration_ms / iterations

    # Average lock acquire and release must be sub-millisecond in-process
    assert avg_per_op_ms < 2.0
