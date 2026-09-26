"""Regression Test Suite for Unified Database Adapter.

Specifically validates:
1. Document creation (clean attributes, subcollection resolution, type conversion)
2. Document update (field-level mutations, preserving unchanged fields)
3. Document upsert (merge=True vs merge=False semantics)
4. Empty/invalid data rejection (enforcing strict validation boundaries)
5. Ownership and authorization (document security permissions and roles)
6. Idempotent writes (multi-run safety without duplication or state drift)
"""
from __future__ import annotations

import uuid
import pytest
from unittest.mock import MagicMock, patch

from services.database_adapter import (
    AppwriteDatabaseAdapter,
    FirestoreDatabaseAdapter,
    get_database_adapter,
)


@pytest.fixture
def mock_appwrite_databases():
    """Create a mock Appwrite Databases service for isolated unit regression."""
    db_mock = MagicMock()
    # Mock schema for users collection
    db_mock.list_attributes.return_value = {
        "attributes": [
            {"key": "email", "type": "string"},
            {"key": "displayName", "type": "string"},
            {"key": "walletBalanceRupees", "type": "integer"},
            {"key": "usage", "type": "string"},
            {"key": "gender", "type": "string"},
            {"key": "height", "type": "double"},
            {"key": "weight", "type": "double"},
            {"key": "uid", "type": "string"},
            {"key": "user_id", "type": "string"},
            {"key": "targetUserId", "type": "string"},
            {"key": "userId", "type": "string"},
            {"key": "createdAt", "type": "string"},
        ]
    }
    return db_mock


class TestDatabaseAdapterUnitRegression:
    """Unit tests verifying adapter validation, normalization, and SDK 6.1.0 conventions."""

    def test_empty_and_invalid_data_rejection_appwrite(self, mock_appwrite_databases):
        adapter = AppwriteDatabaseAdapter()
        adapter.databases = mock_appwrite_databases

        # Empty document_id
        with pytest.raises(ValueError, match="document_id cannot be empty"):
            adapter.set_document("users", "", {"email": "test@example.com"})

        with pytest.raises(ValueError, match="document_id cannot be empty"):
            adapter.set_document("users", "   ", {"email": "test@example.com"})

        with pytest.raises(ValueError, match="document_id cannot be empty"):
            adapter.update_document("users", "", {"email": "test@example.com"})

        # Non-dict data
        with pytest.raises(ValueError, match="must be a dictionary"):
            adapter.set_document("users", "doc1", "invalid_string_data")  # type: ignore

        with pytest.raises(ValueError, match="must be a dictionary"):
            adapter.update_document("users", "doc1", ["invalid_list"])  # type: ignore

        # Empty dict data
        with pytest.raises(ValueError, match="Document data cannot be empty"):
            adapter.set_document("users", "doc1", {})

        with pytest.raises(ValueError, match="Document data cannot be empty"):
            adapter.update_document("users", "doc1", {})

        # Dict containing only metadata/id fields (resulting in empty payload)
        with pytest.raises(ValueError, match="has no valid schema fields"):
            adapter.set_document("users", "doc1", {"id": "doc1", "$createdAt": "now"})

    def test_empty_and_invalid_data_rejection_firestore(self):
        with patch("firebase_config.get_firestore_client"):
            adapter = FirestoreDatabaseAdapter()

            with pytest.raises(ValueError, match="document_id cannot be empty"):
                adapter.set_document("users", "", {"email": "test@example.com"})

            with pytest.raises(ValueError, match="must be a dictionary"):
                adapter.set_document("users", "doc1", "invalid")  # type: ignore

            with pytest.raises(ValueError, match="Document data cannot be empty"):
                adapter.set_document("users", "doc1", {})

            with pytest.raises(ValueError, match="cannot be empty or contain only metadata"):
                adapter.set_document("users", "doc1", {"id": "doc1", "$permissions": []})

    def test_document_creation_formatting(self, mock_appwrite_databases):
        from appwrite.exception import AppwriteException
        adapter = AppwriteDatabaseAdapter()
        adapter.databases = mock_appwrite_databases
        mock_appwrite_databases.get_document.side_effect = AppwriteException("Not found", 404)

        # Mock successful create_document returning SDK 6.1.0 dict response
        mock_appwrite_databases.create_document.return_value = {
            "$id": "usr_test_100",
            "$collectionId": "users",
            "email": "test@example.com",
            "displayName": "Test User",
            "walletBalanceRupees": 250,
            "height": 175.5,
        }

        res = adapter.set_document(
            collection="users",
            document_id="usr_test_100",
            data={
                "email": "test@example.com",
                "displayName": "Test User",
                "walletBalanceRupees": "250",  # string should be coerced to int
                "height": 175.5,
                "uid": "usr_test_100",
            },
        )

        assert res["id"] == "usr_test_100"
        assert res["email"] == "test@example.com"
        assert res["walletBalanceRupees"] == 250

        # Verify create_document was called with correct data types
        call_kwargs = mock_appwrite_databases.create_document.call_args[1]
        assert call_kwargs["database_id"] == adapter.database_id
        assert call_kwargs["collection_id"] == "users"
        assert call_kwargs["document_id"] == "usr_test_100"
        assert isinstance(call_kwargs["data"]["walletBalanceRupees"], int)
        assert call_kwargs["data"]["walletBalanceRupees"] == 250

    def test_document_update_formatting(self, mock_appwrite_databases):
        adapter = AppwriteDatabaseAdapter()
        adapter.databases = mock_appwrite_databases

        mock_appwrite_databases.update_document.return_value = {
            "$id": "usr_test_100",
            "displayName": "Updated Name",
            "walletBalanceRupees": 300,
        }

        res = adapter.update_document(
            collection="users",
            document_id="usr_test_100",
            data={"displayName": "Updated Name", "walletBalanceRupees": 300},
        )

        assert res["id"] == "usr_test_100"
        assert res["displayName"] == "Updated Name"
        assert res["walletBalanceRupees"] == 300

        call_kwargs = mock_appwrite_databases.update_document.call_args[1]
        assert call_kwargs["document_id"] == "usr_test_100"
        assert call_kwargs["data"] == {"displayName": "Updated Name", "walletBalanceRupees": 300}

    def test_document_upsert_merge_behavior(self, mock_appwrite_databases):
        adapter = AppwriteDatabaseAdapter()
        adapter.databases = mock_appwrite_databases

        # Existing doc in Appwrite
        mock_appwrite_databases.get_document.return_value = {
            "$id": "usr_test_100",
            "email": "original@example.com",
            "displayName": "Original Name",
            "walletBalanceRupees": 100,
        }

        # Case 1: merge=True retains existing fields
        mock_appwrite_databases.update_document.return_value = {
            "$id": "usr_test_100",
            "email": "original@example.com",
            "displayName": "Merged Name",
            "walletBalanceRupees": 100,
        }

        adapter.set_document(
            collection="users",
            document_id="usr_test_100",
            data={"displayName": "Merged Name"},
            merge=True,
        )

        call_kwargs = mock_appwrite_databases.update_document.call_args[1]
        assert call_kwargs["data"]["email"] == "original@example.com"
        assert call_kwargs["data"]["displayName"] == "Merged Name"
        assert call_kwargs["data"]["walletBalanceRupees"] == 100

        # Case 2: merge=False only sends new fields
        mock_appwrite_databases.update_document.reset_mock()
        adapter.set_document(
            collection="users",
            document_id="usr_test_100",
            data={"displayName": "Replaced Name"},
            merge=False,
        )

        call_kwargs2 = mock_appwrite_databases.update_document.call_args[1]
        assert "email" not in call_kwargs2["data"]
        assert call_kwargs2["data"] == {"displayName": "Replaced Name"}

    def test_ownership_and_authorization_permissions(self, mock_appwrite_databases):
        adapter = AppwriteDatabaseAdapter()
        adapter.databases = mock_appwrite_databases
        from appwrite.exception import AppwriteException

        mock_appwrite_databases.get_document.side_effect = AppwriteException("Not found", 404)
        mock_appwrite_databases.create_document.return_value = {"$id": "owner_123", "$permissions": []}

        # Default owner permissions derived from uid
        adapter.set_document(
            collection="users",
            document_id="owner_123",
            data={"email": "owner@example.com", "uid": "owner_123"},
        )

        call_kwargs = mock_appwrite_databases.create_document.call_args[1]
        perms = call_kwargs["permissions"]
        assert perms is not None
        assert 'read("user:owner_123")' in perms
        assert 'update("user:owner_123")' in perms
        assert 'delete("user:owner_123")' in perms

        # Explicit permissions passed override auto-inferred
        mock_appwrite_databases.create_document.reset_mock()
        adapter.set_document(
            collection="users",
            document_id="owner_123",
            data={"email": "owner@example.com"},
            permissions=['read("any")'],
        )
        call_kwargs_explicit = mock_appwrite_databases.create_document.call_args[1]
        assert call_kwargs_explicit["permissions"] == ['read("any")']

    def test_idempotent_writes_under_conflict(self, mock_appwrite_databases):
        adapter = AppwriteDatabaseAdapter()
        adapter.databases = mock_appwrite_databases
        from appwrite.exception import AppwriteException

        # First get_document indicates doc doesn't exist
        mock_appwrite_databases.get_document.side_effect = [
            AppwriteException("Not found", 404),
            {"$id": "doc_conflict", "email": "exists@example.com"},  # Fallback get
        ]

        # create_document fails with 409 Conflict (race condition)
        mock_appwrite_databases.create_document.side_effect = AppwriteException("Document already exists", 409)
        mock_appwrite_databases.update_document.return_value = {
            "$id": "doc_conflict",
            "email": "exists@example.com",
            "displayName": "Race Winner",
        }

        # Must recover cleanly by falling back to update
        res = adapter.set_document(
            collection="users",
            document_id="doc_conflict",
            data={"displayName": "Race Winner"},
            merge=True,
        )

        assert res["id"] == "doc_conflict"
        assert res["displayName"] == "Race Winner"
        mock_appwrite_databases.update_document.assert_called_once()


class TestDatabaseAdapterLiveRegression:
    """Live roundtrip tests against the Appwrite deployment."""

    def test_live_document_lifecycle(self):
        adapter = AppwriteDatabaseAdapter()
        test_uid = f"reg_user_{uuid.uuid4().hex[:8]}"

        # 1. Creation
        created = adapter.set_document(
            collection="users",
            document_id=test_uid,
            data={
                "email": f"{test_uid}@zipright.com",
                "displayName": "Regression Test User",
                "walletBalanceRupees": 50,
                "gender": "female",
                "height": 165.0,
                "weight": 55.0,
                "uid": test_uid,
            },
        )
        assert created["id"] == test_uid
        assert created["displayName"] == "Regression Test User"
        assert created["walletBalanceRupees"] == 50

        # 2. Update
        updated = adapter.update_document(
            collection="users",
            document_id=test_uid,
            data={"walletBalanceRupees": 100},
        )
        assert updated["id"] == test_uid
        assert updated["walletBalanceRupees"] == 100

        # 3. Upsert (merge=True)
        upserted = adapter.set_document(
            collection="users",
            document_id=test_uid,
            data={"displayName": "Updated Regression User"},
            merge=True,
        )
        assert upserted["displayName"] == "Updated Regression User"
        assert upserted["walletBalanceRupees"] == 100

        # 4. Idempotency (write identical data again)
        idempotent_doc = adapter.set_document(
            collection="users",
            document_id=test_uid,
            data={"displayName": "Updated Regression User", "walletBalanceRupees": 100},
            merge=True,
        )
        assert idempotent_doc["displayName"] == "Updated Regression User"

        # 5. Read back
        fetched = adapter.get_document("users", test_uid)
        assert fetched is not None
        assert fetched["displayName"] == "Updated Regression User"
        assert fetched["walletBalanceRupees"] == 100

        # 6. Cleanup
        deleted = adapter.delete_document("users", test_uid)
        assert deleted is True

        # 7. Verify deletion
        import time
        deleted_verified = False
        for _ in range(10):
            if adapter.get_document("users", test_uid) is None:
                deleted_verified = True
                break
            time.sleep(0.3)
        assert deleted_verified is True

    def test_live_empty_data_rejection(self):
        """Prove empty/invalid data rejection against live Appwrite adapter."""
        adapter = AppwriteDatabaseAdapter()
        with pytest.raises(ValueError, match="document_id cannot be empty"):
            adapter.set_document("users", "", {"displayName": "Test"})
        with pytest.raises(ValueError, match="Document data cannot be empty"):
            adapter.set_document("users", "usr_test_empty", {})
        with pytest.raises(ValueError, match="has no valid schema fields"):
            adapter.set_document("users", "usr_test_empty", {"id": "usr_test_empty", "$createdAt": "now"})

    def test_live_permission_handling(self):
        """Prove document permission handling against real persistent Appwrite deployment."""
        adapter = AppwriteDatabaseAdapter()
        test_uid = f"reg_perm_{uuid.uuid4().hex[:8]}"
        created = adapter.set_document(
            collection="users",
            document_id=test_uid,
            data={
                "email": f"{test_uid}@zipright.com",
                "displayName": "Perm User",
                "uid": test_uid,
            },
        )
        try:
            from appwrite_config import appwrite_settings
            raw_doc = adapter.databases.get_document(
                database_id=appwrite_settings.DATABASE_ID,
                collection_id="users",
                document_id=test_uid,
            )
            perms = raw_doc.get("$permissions", []) if isinstance(raw_doc, dict) else getattr(raw_doc, "$permissions", [])
            assert any(f"user:{test_uid}" in p for p in perms)
        finally:
            adapter.delete_document("users", test_uid)

