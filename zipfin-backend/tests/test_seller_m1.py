"""M1 — Seller Profile: onboarding, profile CRUD, logo upload, admin approval,
and the provider-agnostic storage abstraction."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from core.api import error_response
from routes.seller import router as seller_router
from services.admin_auth import AdminGate, get_admin_gate
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.seller_repository import SellerRepository, get_seller_repository
from services.storage_provider import (
    FirebaseStorageProvider,
    LocalStorageProvider,
    StorageProvider,
    get_storage_provider,
)

SELLER = AuthenticatedUser(uid="seller1", email="login@example.com")
ADMIN = AuthenticatedUser(uid="admin1", email="admin@example.com")

ONBOARD_BODY = {
    "store_name": "Crown Threads",
    "contact_name": "Rakshit",
    "email": "store@example.com",
    "phone": "+91 90000 00000",
    "website": "https://crownthreads.example",
    "gst": "22AAAAA0000A1Z5",
    "brand_description": "Premium streetwear",
    "terms_accepted": True,
}


class _MemoryStorage(StorageProvider):
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def upload_bytes(self, data, *, content_type, folder, extension):
        self.calls.append({"folder": folder, "content_type": content_type, "extension": extension})
        return f"https://cdn.example/{folder}/logo{extension}"


def _client(fake_client, *, user=SELLER, storage=None, admin_uids=()) -> TestClient:
    app = FastAPI()
    # Mirror main.py's error envelope so tests exercise the real {message} shape.
    app.add_exception_handler(
        HTTPException,
        lambda request, exc: error_response(status_code=exc.status_code, detail=exc.detail),
    )
    app.add_exception_handler(
        RequestValidationError,
        lambda request, exc: error_response(
            status_code=422, detail=exc.errors(), default_message="Request validation failed."
        ),
    )
    app.include_router(seller_router)
    repo = SellerRepository(client=fake_client)
    gate = AdminGate(client=fake_client)
    for uid in admin_uids:
        fake_client.seed("admins", uid, {"status": "active"})
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_seller_repository] = lambda: repo
    app.dependency_overrides[get_admin_gate] = lambda: gate
    app.dependency_overrides[get_storage_provider] = lambda: storage or _MemoryStorage()
    return TestClient(app)


# --- Storage provider abstraction --------------------------------------------


def test_local_storage_provider_writes_and_returns_url(tmp_path: Path):
    provider = LocalStorageProvider(directory=tmp_path, url_prefix="/uploads")
    url = provider.upload_bytes(b"bytes", content_type="image/png", folder="seller-logos", extension=".png")
    assert url.startswith("/uploads/seller-logos/") and url.endswith(".png")
    written = list((tmp_path / "seller-logos").glob("*.png"))
    assert len(written) == 1 and written[0].read_bytes() == b"bytes"


def test_firebase_provider_falls_back_to_local_on_error(tmp_path: Path):
    def _boom(*args, **kwargs):
        raise RuntimeError("Firebase 403")

    fallback = LocalStorageProvider(directory=tmp_path)
    provider = FirebaseStorageProvider(uploader=_boom, fallback=fallback)
    url = provider.upload_bytes(b"x", content_type="image/png", folder="seller-logos", extension=".png")
    assert "/seller-logos/" in url  # served by the local fallback, not raised


def test_firebase_provider_uses_uploader_when_healthy():
    provider = FirebaseStorageProvider(uploader=lambda data, **kw: "https://fb/logo.png")
    assert provider.upload_bytes(b"x", content_type="image/png", folder="f", extension=".png") == "https://fb/logo.png"


# --- Onboarding ---------------------------------------------------------------


def test_onboard_creates_pending_seller(fake_client):
    response = _client(fake_client).post("/seller/onboard", json=ONBOARD_BODY)
    assert response.status_code == 201
    profile = response.json()["data"]
    assert profile["status"] == "pending"
    assert profile["store_name"] == "Crown Threads"
    assert profile["gst"] == "22AAAAA0000A1Z5"
    assert profile["terms_accepted_at"] is not None


def test_onboard_requires_accepted_terms(fake_client):
    response = _client(fake_client).post("/seller/onboard", json={**ONBOARD_BODY, "terms_accepted": False})
    assert response.status_code == 422


def test_onboard_rejects_bad_email(fake_client):
    response = _client(fake_client).post("/seller/onboard", json={**ONBOARD_BODY, "email": "not-an-email"})
    assert response.status_code == 422


def test_onboard_is_idempotent_guarded(fake_client):
    client = _client(fake_client)
    assert client.post("/seller/onboard", json=ONBOARD_BODY).status_code == 201
    dup = client.post("/seller/onboard", json=ONBOARD_BODY)
    assert dup.status_code == 409
    assert dup.json()["message"]


def test_onboard_ignores_unknown_future_fields(fake_client):
    # Forward-compat: a newer client sending pan/address must not error.
    body = {**ONBOARD_BODY, "pan": "ABCDE1234F", "address": {"city": "Pune"}}
    assert _client(fake_client).post("/seller/onboard", json=body).status_code == 201


# --- Profile view / edit ------------------------------------------------------


def test_get_profile_for_pending_seller(fake_client):
    client = _client(fake_client)
    client.post("/seller/onboard", json=ONBOARD_BODY)
    data = client.get("/seller/profile").json()["data"]
    assert data["store_name"] == "Crown Threads"
    assert data["status"] == "pending"


def test_get_profile_requires_seller(fake_client):
    response = _client(fake_client).get("/seller/profile")
    assert response.status_code == 403
    assert response.json()["message"]


def test_patch_profile_updates_fields_but_not_status(fake_client):
    client = _client(fake_client)
    client.post("/seller/onboard", json=ONBOARD_BODY)
    data = client.patch(
        "/seller/profile",
        json={"store_name": "Crown Co", "status": "active", "brand_description": "Updated"},
    ).json()["data"]
    assert data["store_name"] == "Crown Co"
    assert data["brand_description"] == "Updated"
    assert data["status"] == "pending"  # status is never self-editable
    assert data["email"] == "store@example.com"  # untouched field preserved


def test_patch_profile_blocked_when_suspended(fake_client):
    repo = SellerRepository(client=fake_client)
    repo.create_seller("seller1", {"store_name": "S", "email": "s@e.com"})
    repo.set_seller_status("seller1", "suspended")
    response = _client(fake_client).patch("/seller/profile", json={"store_name": "X"})
    assert response.status_code == 403
    assert response.json()["message"]


# --- Logo upload (storage abstraction) ---------------------------------------


def test_logo_upload_sets_brand_logo_url(fake_client):
    storage = _MemoryStorage()
    client = _client(fake_client, storage=storage)
    client.post("/seller/onboard", json=ONBOARD_BODY)
    response = client.post(
        "/seller/profile/logo",
        files={"file": ("logo.png", b"\x89PNG-bytes", "image/png")},
    )
    assert response.status_code == 200
    assert response.json()["data"]["brand_logo_url"].endswith(".png")
    assert storage.calls == [{"folder": "seller-logos", "content_type": "image/png", "extension": ".png"}]


def test_logo_upload_rejects_non_image(fake_client):
    client = _client(fake_client)
    client.post("/seller/onboard", json=ONBOARD_BODY)
    response = client.post(
        "/seller/profile/logo",
        files={"file": ("logo.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 415


# --- Admin approval -----------------------------------------------------------


def test_admin_can_activate_seller(fake_client):
    seller_client = _client(fake_client)
    seller_client.post("/seller/onboard", json=ONBOARD_BODY)

    admin_client = _client(fake_client, user=ADMIN, admin_uids=("admin1",))
    response = admin_client.patch("/seller/seller1/status", json={"status": "active"})
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "active"


def test_non_admin_cannot_change_status(fake_client):
    seller_client = _client(fake_client)
    seller_client.post("/seller/onboard", json=ONBOARD_BODY)
    # SELLER is not seeded into admins -> 403
    response = seller_client.patch("/seller/seller1/status", json={"status": "active"})
    assert response.status_code == 403
    assert response.json()["message"]


def test_admin_status_update_unknown_seller_404(fake_client):
    admin_client = _client(fake_client, user=ADMIN, admin_uids=("admin1",))
    response = admin_client.patch("/seller/ghost/status", json={"status": "active"})
    assert response.status_code == 404


def test_admin_status_rejects_invalid_value(fake_client):
    admin_client = _client(fake_client, user=ADMIN, admin_uids=("admin1",))
    response = admin_client.patch("/seller/seller1/status", json={"status": "vip"})
    assert response.status_code == 422


def test_admin_can_list_sellers(fake_client):
    seller_client = _client(fake_client, user=SELLER)
    seller_client.post("/seller/onboard", json=ONBOARD_BODY)

    admin_client = _client(fake_client, user=ADMIN, admin_uids=("admin1",))
    response = admin_client.get("/seller")
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 1
    assert data[0]["uid"] == "seller1"
    assert data[0]["status"] == "pending"


def test_non_admin_cannot_list_sellers(fake_client):
    seller_client = _client(fake_client, user=SELLER)
    response = seller_client.get("/seller")
    assert response.status_code == 403

