"""M0 — Seller Authentication: repository, require_active_seller, GET /seller/me."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from google.api_core.exceptions import AlreadyExists

from routes.seller import router as seller_router
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.seller_auth import require_active_seller
from services.seller_repository import (
    SellerAlreadyExistsError,
    SellerRepository,
    get_seller_repository,
)

# --- In-memory Firestore fake -------------------------------------------------


def _resolve_sentinels(data: dict) -> dict:
    """Replace SERVER_TIMESTAMP sentinels with a real datetime like Firestore."""
    from firebase_admin import firestore as firebase_firestore

    return {
        key: datetime.now(timezone.utc) if value is firebase_firestore.SERVER_TIMESTAMP else value
        for key, value in data.items()
    }


class FakeSnapshot:
    def __init__(self, data: dict | None) -> None:
        self._data = data

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> dict | None:
        return dict(self._data) if self._data is not None else None


class FakeDocument:
    def __init__(self, store: dict[str, dict], key: str) -> None:
        self._store = store
        self._key = key

    def get(self) -> FakeSnapshot:
        return FakeSnapshot(self._store.get(self._key))

    def create(self, data: dict) -> None:
        if self._key in self._store:
            raise AlreadyExists(f"Document {self._key} already exists.")
        self._store[self._key] = _resolve_sentinels(data)

    def set(self, data: dict, merge: bool = False) -> None:
        resolved = _resolve_sentinels(data)
        if merge and self._key in self._store:
            self._store[self._key] = {**self._store[self._key], **resolved}
        else:
            self._store[self._key] = resolved


class FakeCollection:
    def __init__(self, store: dict[str, dict]) -> None:
        self._store = store

    def document(self, key: str) -> FakeDocument:
        return FakeDocument(self._store, key)


class FakeFirestore:
    def __init__(self) -> None:
        self.collections: dict[str, dict[str, dict]] = {}

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self.collections.setdefault(name, {}))


@pytest.fixture
def repo() -> SellerRepository:
    return SellerRepository(client=FakeFirestore())


BUSINESS_INFO = {
    "store_name": "Crown Threads",
    "contact_name": "Rakshit",
    "email": "seller@example.com",
    "phone": "+91 90000 00000",
}


# --- Repository ---------------------------------------------------------------


def test_get_seller_missing_returns_none(repo):
    assert repo.get_seller("nobody") is None
    assert repo.get_seller("") is None


def test_create_seller_starts_pending_with_timestamps(repo):
    created = repo.create_seller("u1", BUSINESS_INFO)
    assert created["status"] == "pending"  # never auto-activated
    assert created["store_name"] == "Crown Threads"
    assert created["uid"] == "u1"
    # Firestore timestamps come back as ISO strings
    assert isinstance(created["created_at"], str) and "T" in created["created_at"]


def test_create_seller_twice_raises(repo):
    repo.create_seller("u1", BUSINESS_INFO)
    with pytest.raises(SellerAlreadyExistsError):
        repo.create_seller("u1", BUSINESS_INFO)


def test_update_seller_merges_but_cannot_self_activate(repo):
    repo.create_seller("u1", BUSINESS_INFO)
    updated = repo.update_seller("u1", {"store_name": "New Name", "status": "active", "uid": "hax"})
    assert updated["store_name"] == "New Name"
    assert updated["status"] == "pending"  # status change dropped
    assert updated["uid"] == "u1"
    assert updated["email"] == "seller@example.com"  # merge kept other fields


def test_update_missing_seller_returns_none(repo):
    assert repo.update_seller("ghost", {"store_name": "X"}) is None


def test_set_seller_status_lifecycle(repo):
    repo.create_seller("u1", BUSINESS_INFO)
    activated = repo.set_seller_status("u1", "active")
    assert activated["status"] == "active"
    with pytest.raises(ValueError):
        repo.set_seller_status("u1", "vip")
    assert repo.set_seller_status("ghost", "active") is None


# --- require_active_seller ----------------------------------------------------


USER = AuthenticatedUser(uid="u1", email="seller@example.com")


def _require(repo):
    return asyncio.run(require_active_seller(current_user=USER, repository=repo))


def test_require_active_seller_rejects_non_sellers(repo):
    with pytest.raises(HTTPException) as excinfo:
        _require(repo)
    assert excinfo.value.status_code == 403
    assert excinfo.value.detail["details"]["code"] == "not_a_seller"


def test_require_active_seller_rejects_pending(repo):
    repo.create_seller("u1", BUSINESS_INFO)
    with pytest.raises(HTTPException) as excinfo:
        _require(repo)
    assert excinfo.value.detail["details"]["code"] == "seller_pending"


def test_require_active_seller_allows_active(repo):
    repo.create_seller("u1", BUSINESS_INFO)
    repo.set_seller_status("u1", "active")
    context = _require(repo)
    assert context.uid == "u1"
    assert context.seller["store_name"] == "Crown Threads"


def test_require_active_seller_rejects_suspended(repo):
    repo.create_seller("u1", BUSINESS_INFO)
    repo.set_seller_status("u1", "suspended")
    with pytest.raises(HTTPException) as excinfo:
        _require(repo)
    assert excinfo.value.detail["details"]["code"] == "seller_suspended"


# --- GET /seller/me -----------------------------------------------------------


def _client(repo) -> TestClient:
    app = FastAPI()
    app.include_router(seller_router)
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_seller_repository] = lambda: repo
    return TestClient(app)


def test_seller_me_for_non_seller(repo):
    response = _client(repo).get("/seller/me")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data == {"is_seller": False, "status": None, "profile": None}


def test_seller_me_for_pending_seller(repo):
    repo.create_seller("u1", BUSINESS_INFO)
    data = _client(repo).get("/seller/me").json()["data"]
    assert data["is_seller"] is False  # pending sellers have no capabilities yet
    assert data["status"] == "pending"
    assert data["profile"]["store_name"] == "Crown Threads"


def test_seller_me_for_active_seller(repo):
    repo.create_seller("u1", BUSINESS_INFO)
    repo.set_seller_status("u1", "active")
    data = _client(repo).get("/seller/me").json()["data"]
    assert data["is_seller"] is True
    assert data["status"] == "active"
    assert data["profile"]["uid"] == "u1"


def test_seller_me_requires_real_auth(repo):
    """Without a bearer token get_current_user must 401 (demo sessions can't be sellers)."""
    app = FastAPI()
    app.include_router(seller_router)
    app.dependency_overrides[get_seller_repository] = lambda: repo
    response = TestClient(app).get("/seller/me")
    assert response.status_code == 401
