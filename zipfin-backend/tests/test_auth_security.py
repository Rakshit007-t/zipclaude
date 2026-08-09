"""Regression coverage for the Phase 1 auth hardening."""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from routes.auth import auth_access
from services.firebase_auth import AuthenticatedUser
from services.request_rate_limiter import enforce_rate_limit


class _AdminGate:
    def __init__(self, is_admin: bool) -> None:
        self._is_admin = is_admin

    def is_admin(self, uid: str) -> bool:
        return self._is_admin and bool(uid)


class _SellerRepository:
    def __init__(self, record: dict | None) -> None:
        self._record = record

    def get_seller(self, uid: str) -> dict | None:
        return self._record if uid else None


def _request() -> Request:
    return Request({"type": "http", "method": "GET", "path": "/auth/access", "client": ("127.0.0.1", 5000)})


def test_auth_access_uses_server_roles() -> None:
    response = asyncio.run(
        auth_access(
            request=_request(),
            current_user=AuthenticatedUser(uid="seller-1", email="seller@example.com"),
            admin_gate=_AdminGate(is_admin=False),
            seller_repository=_SellerRepository({"status": "active"}),
        )
    )
    assert response.data is not None
    assert response.data["is_admin"] is False
    assert response.data["is_seller"] is True


def test_rate_limiter_still_returns_429_and_retry_after() -> None:
    key = f"phase1-rate-limit:{uuid4()}"
    enforce_rate_limit(key=key, max_requests=1, window_seconds=60, detail="limited")

    with pytest.raises(HTTPException) as exception:
        enforce_rate_limit(key=key, max_requests=1, window_seconds=60, detail="limited")

    assert exception.value.status_code == 429
    assert "Retry-After" in exception.value.headers
    assert exception.value.headers["Retry-After"].isdigit()
    assert 1 <= int(exception.value.headers["Retry-After"]) <= 60
    assert exception.value.detail["details"]["code"] == "rate_limited"
