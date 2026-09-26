"""
Live end-to-end integration tests executed directly against the live Appwrite instance.
Validates Auth, Database, Storage, and Concurrency Transactions with real HTTP/SDK calls.
"""
from __future__ import annotations

import concurrent.futures
import io
import json
import os
import time
import uuid
import pytest
from appwrite.client import Client
from appwrite.services.account import Account
from appwrite.services.databases import Databases
from appwrite.services.storage import Storage
from appwrite.services.users import Users
from appwrite.exception import AppwriteException

from appwrite_config import (
    appwrite_settings,
    get_appwrite_client,
    get_appwrite_databases,
    get_appwrite_storage,
    get_appwrite_users,
)
from services.auth_adapter import AppwriteAuthAdapter, AuthenticatedUser
from services.database_adapter import AppwriteDatabaseAdapter
from services.storage_provider import AppwriteStorageProvider
from services.tryon_access import consume_tryon_credit_for_uid, refund_tryon_credit


@pytest.fixture(scope="module")
def live_databases():
    return get_appwrite_databases()


@pytest.fixture(scope="module")
def live_storage():
    return get_appwrite_storage()


@pytest.fixture(scope="module")
def live_users():
    return get_appwrite_users()


def test_live_appwrite_connection():
    """Verify live connectivity and project status on Appwrite localhost."""
    client = get_appwrite_client()
    db = Databases(client)
    res = db.get(database_id=appwrite_settings.DATABASE_ID)
    res_id = res.get("$id") if isinstance(res, dict) else getattr(res, "id", None) or getattr(res, "$id", None)
    assert res_id == appwrite_settings.DATABASE_ID


def test_live_database_crud_and_query():
    """Verify real CRUD and filtered queries on live Appwrite database."""
    adapter = AppwriteDatabaseAdapter()
    test_uid = f"test_user_{uuid.uuid4().hex[:8]}"

    # 1. Create document
    created = adapter.set_document(
        collection="users",
        document_id=test_uid,
        data={
            "email": f"{test_uid}@zipright.com",
            "displayName": "Live Test Customer",
            "walletBalanceRupees": 100,
            "usage": json.dumps({"tryOns": 0}),
            "gender": "female",
            "height": 168.0,
            "weight": 58.0,
        },
    )
    assert created["id"] == test_uid
    assert created.get("displayName") == "Live Test Customer"
    assert created.get("walletBalanceRupees") == 100

    # 2. Read document
    read_doc = adapter.get_document("users", test_uid)
    assert read_doc is not None
    assert read_doc["id"] == test_uid
    assert read_doc["walletBalanceRupees"] == 100

    # 3. Update document
    updated = adapter.update_document("users", test_uid, {"walletBalanceRupees": 75})
    assert updated["walletBalanceRupees"] == 75

    # 4. Normalized subcollection test (users/following -> user_following)
    follow_id = f"fol_{uuid.uuid4().hex[:8]}"
    adapter.set_document(
        collection="users/following",
        document_id=follow_id,
        data={
            "userId": test_uid,
            "targetUserId": "seller_target_123",
            "createdAt": "2026-09-23T12:00:00Z",
        },
    )

    # 5. Query collection
    results = adapter.query_collection(
        collection="users/following",
        filters=[("userId", "==", test_uid)],
    )
    assert len(results) >= 1
    assert any(r.get("targetUserId") == "seller_target_123" for r in results)

    # 6. Cleanup
    assert adapter.delete_document("users/following", follow_id) is True
    assert adapter.delete_document("users", test_uid) is True
    assert adapter.get_document("users", test_uid) is None


def test_live_storage_upload_download_delete():
    """Verify file upload, URL resolution, and deletion across real Appwrite buckets."""
    provider = AppwriteStorageProvider()
    test_content = b"ZipRIGHT test media content header simulation"

    # 1. Upload to public bucket
    url = provider.upload_bytes(
        data=test_content,
        content_type="image/png",
        folder="seller-logos",
        extension=".png",
    )
    assert url is not None
    assert appwrite_settings.BUCKET_PUBLIC in url or "storage" in url
    public_file_id = url.split("/files/")[1].split("/")[0]

    # 2. Upload to private bucket (tryons)
    private_url = provider.upload_bytes(
        data=test_content,
        content_type="image/png",
        folder="tryons",
        extension=".png",
    )
    assert private_url is not None
    assert appwrite_settings.BUCKET_PRIVATE in private_url or "storage" in private_url
    private_file_id = private_url.split("/files/")[1].split("/")[0]

    # 3. Cleanup
    assert provider.delete_file("seller-logos", public_file_id) is True
    assert provider.delete_file("tryons", private_file_id) is True


def test_live_auth_user_creation_and_jwt_verification():
    """Verify live user creation, JWT generation, and token validation."""
    users_service = get_appwrite_users()
    test_uid = f"auth_{uuid.uuid4().hex[:8]}"
    test_email = f"{test_uid}@test.zipright.com"
    test_password = "SecurePassword123!"

    # 1. Create real Appwrite user
    user_doc = users_service.create(
        user_id=test_uid,
        email=test_email,
        password=test_password,
        name="Live Auth Tester",
    )
    created_id = getattr(user_doc, "id", None) or getattr(user_doc, "$id", test_uid)
    assert created_id == test_uid

    try:
        # 2. Create JWT token for this user via Users service
        try:
            jwt_obj = users_service.create_jwt(user_id=test_uid)
        except AppwriteException as exc:
            if exc.code == 500:
                pytest.skip("Appwrite server requires _APP_OPENSSL_KEY_V1 to issue JWT tokens")
            raise
        jwt_token = getattr(jwt_obj, "jwt", None) or getattr(jwt_obj, "token", None) or (jwt_obj.get("jwt") if isinstance(jwt_obj, dict) else None)
        assert jwt_token is not None

        # 3. Verify token with AppwriteAuthAdapter
        auth_adapter = AppwriteAuthAdapter()
        authenticated = auth_adapter.verify_token(jwt_token)
        assert isinstance(authenticated, AuthenticatedUser)
        assert authenticated.uid == test_uid
        assert authenticated.email == test_email
    finally:
        # 4. Clean up user
        users_service.delete(user_id=test_uid)


def test_live_concurrent_wallet_transactions():
    """Verify ACID consistency and distributed locking over live Appwrite database."""
    old_db_provider = os.environ.get("DATABASE_PROVIDER")
    os.environ["DATABASE_PROVIDER"] = "appwrite"
    adapter = AppwriteDatabaseAdapter()
    test_uid = f"tx_user_{uuid.uuid4().hex[:8]}"
    initial_balance = 50
    adapter.set_document(
        collection="users",
        document_id=test_uid,
        data={
            "email": f"{test_uid}@zipright.com",
            "displayName": "Transaction Concurrency User",
            "walletBalanceRupees": initial_balance,
            "usage": json.dumps({"tryOns": 3}),
        },
    )

    try:
        num_threads = 10
        debit_amount = 5  # 10 * 5 = 50 total debit

        def do_debit():
            return consume_tryon_credit_for_uid(test_uid)

        # Run 10 parallel threads debiting the same account concurrently
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(do_debit) for _ in range(num_threads)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        assert len(results) == num_threads

        # Final balance in live database must be exactly 0 (50 - 50 = 0)
        final_user = None
        for _ in range(10):
            time.sleep(0.3)
            final_user = adapter.get_document("users", test_uid)
            if final_user and final_user.get("walletBalanceRupees") == 0:
                break
        assert final_user is not None
        assert final_user.get("walletBalanceRupees") == 0
        
        usage = final_user.get("usage")
        if isinstance(usage, str):
            usage = json.loads(usage)
        assert usage.get("tryOns") == 13

        # Test refund idempotency on live database
        job_id = f"refund_job_{uuid.uuid4().hex[:8]}"
        b1 = refund_tryon_credit(user_id=test_uid, job_id=job_id, charged_rupees=5, free_tryon=False)
        assert b1 == 5  # Refunded 5 rupees

        # Duplicate refund must be rejected as idempotent no-op
        b2 = refund_tryon_credit(user_id=test_uid, job_id=job_id, charged_rupees=5, free_tryon=False)
        assert b2 == 5  # Still 5 rupees, not doubled to 10

        # Clean up refund sentinel
        adapter.delete_document("tryon_refunds", job_id)
    finally:
        adapter.delete_document("users", test_uid)
        if old_db_provider is not None:
            os.environ["DATABASE_PROVIDER"] = old_db_provider
        else:
            os.environ.pop("DATABASE_PROVIDER", None)
