"""Tests for Decart Lucy Realtime AI VTO Integration (Token Broker, Session Guards, Error Normalization)."""

from __future__ import annotations

import uuid
import httpx
import pytest
from fastapi import status
from fastapi.testclient import TestClient

from core.config import settings
from main import app
from services.decart_vto import _active_sessions
from services.firebase_auth import AuthenticatedUser, get_current_user

AUTH_HEADERS = {"Authorization": "Bearer test-jwt-token"}


@pytest.fixture(autouse=True)
def cleanup_active_sessions():
    """Ensure active sessions dictionary is cleared between tests."""
    _active_sessions.clear()
    yield
    _active_sessions.clear()


def make_auth_user():
    uid = f"usr_decart_{uuid.uuid4().hex[:8]}"
    return AuthenticatedUser(
        uid=uid,
        email=f"{uid}@zipright.com",
        is_anonymous=False,
    )


@pytest.fixture
def client():
    user = make_auth_user()
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def unauthenticated_client():
    app.dependency_overrides.pop(get_current_user, None)
    with TestClient(app) as test_client:
        yield test_client


def test_01_unauthenticated_token_request_returns_401(unauthenticated_client):
    """Unauthenticated token requests must be rejected with 401."""
    resp = unauthenticated_client.post("/tryon-live/decart/token", json={})
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


def test_02_disabled_integration_returns_503(client, monkeypatch):
    """When DECART_VTO_ENABLED is false, return 503 service unavailable."""
    monkeypatch.setattr(settings, "DECART_VTO_ENABLED", False)
    monkeypatch.setattr(settings, "DECART_API_KEY", "mock_key")

    resp = client.post("/tryon-live/decart/token", json={}, headers=AUTH_HEADERS)
    assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    data = resp.json()
    assert "disabled" in data["message"].lower()


def test_03_missing_api_key_returns_503(client, monkeypatch):
    """When DECART_API_KEY is empty/unset, return 503 service unavailable."""
    monkeypatch.setattr(settings, "DECART_VTO_ENABLED", True)
    monkeypatch.setattr(settings, "DECART_API_KEY", "")

    resp = client.post("/tryon-live/decart/token", json={}, headers=AUTH_HEADERS)
    assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    data = resp.json()
    assert "not configured" in data["message"].lower()


def test_04_successful_token_broker(monkeypatch):
    """When credentials exist and upstream returns success, client token is returned."""
    user = make_auth_user()
    app.dependency_overrides[get_current_user] = lambda: user

    monkeypatch.setattr(settings, "DECART_VTO_ENABLED", True)
    monkeypatch.setattr(settings, "DECART_API_KEY", "dct_test_permanent_secret_key_12345")
    monkeypatch.setattr(settings, "DECART_VTO_MODEL", "lucy-vton-3.5")
    monkeypatch.setattr(settings, "DECART_VTO_MAX_SESSION_SECONDS", 60)

    mock_response = httpx.Response(
        status_code=200,
        json={
            "apiKey": "ek_test_short_lived_client_token_xyz987",
            "expiresAt": "2026-09-30T13:00:00Z",
            "permissions": {"models": ["lucy-vton-3.5"]},
        },
        request=httpx.Request("POST", "https://api.decart.ai/v1/client/tokens"),
    )

    def mock_send(endpoint, headers, payload):
        assert headers["X-API-KEY"] == "dct_test_permanent_secret_key_12345"
        assert payload["allowedModels"] == ["lucy-vton-3.5"]
        assert payload["constraints"]["realtime"]["maxSessionDuration"] == 60
        assert payload["metadata"]["user_id"] == user.uid
        return mock_response

    monkeypatch.setattr("services.decart_vto._send_decart_token_request", mock_send)

    with TestClient(app) as client:
        resp = client.post("/tryon-live/decart/token", json={}, headers=AUTH_HEADERS)
        assert resp.status_code == status.HTTP_200_OK
        data = resp.json()

        # The browser receives ONLY the short-lived client token
        assert data["client_token"] == "ek_test_short_lived_client_token_xyz987"
        assert data["model"] == "lucy-vton-3.5"
        assert data["max_session_seconds"] == 60
        assert data["fps"] == 30
        assert data["width"] == 1280
        assert data["height"] == 720
        # Permanent key MUST NEVER be present in response
        assert "dct_test_permanent_secret_key_12345" not in resp.text

    app.dependency_overrides.pop(get_current_user, None)


def test_05_session_duplication_prevented(monkeypatch):
    """A user cannot start a second realtime session while one is active."""
    user = make_auth_user()
    app.dependency_overrides[get_current_user] = lambda: user

    monkeypatch.setattr(settings, "DECART_VTO_ENABLED", True)
    monkeypatch.setattr(settings, "DECART_API_KEY", "dct_test_key")

    mock_response = httpx.Response(
        status_code=200,
        json={"apiKey": "ek_client_token_1"},
        request=httpx.Request("POST", "https://api.decart.ai/v1/client/tokens"),
    )
    monkeypatch.setattr(
        "services.decart_vto._send_decart_token_request",
        lambda endpoint, headers, payload: mock_response,
    )

    with TestClient(app) as client:
        # First session succeeds
        resp1 = client.post("/tryon-live/decart/token", json={}, headers=AUTH_HEADERS)
        assert resp1.status_code == status.HTTP_200_OK

        # Second immediate session by the same user must be rejected with 409 Conflict
        resp2 = client.post("/tryon-live/decart/token", json={}, headers=AUTH_HEADERS)
        assert resp2.status_code == status.HTTP_409_CONFLICT
        assert "active" in resp2.json()["message"].lower()

    app.dependency_overrides.pop(get_current_user, None)


def test_06_session_release_allows_new_session(monkeypatch):
    """Ending a session releases the slot and allows a subsequent session."""
    user = make_auth_user()
    app.dependency_overrides[get_current_user] = lambda: user

    monkeypatch.setattr(settings, "DECART_VTO_ENABLED", True)
    monkeypatch.setattr(settings, "DECART_API_KEY", "dct_test_key")

    mock_response = httpx.Response(
        status_code=200,
        json={"apiKey": "ek_client_token_2"},
        request=httpx.Request("POST", "https://api.decart.ai/v1/client/tokens"),
    )
    monkeypatch.setattr(
        "services.decart_vto._send_decart_token_request",
        lambda endpoint, headers, payload: mock_response,
    )

    with TestClient(app) as client:
        # First session
        resp1 = client.post("/tryon-live/decart/token", json={}, headers=AUTH_HEADERS)
        assert resp1.status_code == status.HTTP_200_OK

        # Explicit session end
        resp_end = client.post("/tryon-live/decart/session/end", json={}, headers=AUTH_HEADERS)
        assert resp_end.status_code == status.HTTP_200_OK
        assert resp_end.json()["status"] == "released"

        # Now a second session can be created without 409
        resp2 = client.post("/tryon-live/decart/token", json={}, headers=AUTH_HEADERS)
        assert resp2.status_code == status.HTTP_200_OK

    app.dependency_overrides.pop(get_current_user, None)


def test_07_rate_limit_enforced(monkeypatch):
    """After 5 token requests in a minute, the 6th request is rate-limited with 429."""
    user = make_auth_user()
    app.dependency_overrides[get_current_user] = lambda: user

    monkeypatch.setattr(settings, "DECART_VTO_ENABLED", True)
    monkeypatch.setattr(settings, "DECART_API_KEY", "dct_test_key")

    mock_response = httpx.Response(
        status_code=200,
        json={"apiKey": "ek_client_token_rl"},
        request=httpx.Request("POST", "https://api.decart.ai/v1/client/tokens"),
    )
    monkeypatch.setattr(
        "services.decart_vto._send_decart_token_request",
        lambda endpoint, headers, payload: mock_response,
    )

    with TestClient(app) as client:
        for i in range(5):
            # End previous session so concurrency check doesn't block rate limit test
            _active_sessions.clear()
            resp = client.post("/tryon-live/decart/token", json={}, headers=AUTH_HEADERS)
            assert resp.status_code == status.HTTP_200_OK

        _active_sessions.clear()
        # 6th request must exceed rate limit
        resp6 = client.post("/tryon-live/decart/token", json={}, headers=AUTH_HEADERS)
        assert resp6.status_code == status.HTTP_429_TOO_MANY_REQUESTS
        assert "too many" in resp6.json()["message"].lower()

    app.dependency_overrides.pop(get_current_user, None)


def test_08_upstream_decart_auth_error_normalized(monkeypatch):
    """If upstream Decart returns 401/403, backend returns 502 with sanitized error."""
    user = make_auth_user()
    app.dependency_overrides[get_current_user] = lambda: user

    monkeypatch.setattr(settings, "DECART_VTO_ENABLED", True)
    monkeypatch.setattr(settings, "DECART_API_KEY", "invalid_key")

    mock_response = httpx.Response(
        status_code=401,
        json={"detail": "Invalid API key"},
        request=httpx.Request("POST", "https://api.decart.ai/v1/client/tokens"),
    )
    monkeypatch.setattr(
        "services.decart_vto._send_decart_token_request",
        lambda endpoint, headers, payload: mock_response,
    )

    with TestClient(app) as client:
        resp = client.post("/tryon-live/decart/token", json={}, headers=AUTH_HEADERS)
        assert resp.status_code == status.HTTP_502_BAD_GATEWAY
        data = resp.json()
        assert "authorization" in data["message"].lower() or "credentials" in data["message"].lower()
        # Never leak raw upstream message with secrets
        assert "invalid_key" not in resp.text

    app.dependency_overrides.pop(get_current_user, None)


def test_09_upstream_decart_quota_exceeded_normalized(monkeypatch):
    """If upstream Decart returns 429, backend returns 429 with sanitized detail."""
    user = make_auth_user()
    app.dependency_overrides[get_current_user] = lambda: user

    monkeypatch.setattr(settings, "DECART_VTO_ENABLED", True)
    monkeypatch.setattr(settings, "DECART_API_KEY", "dct_test_key")

    mock_response = httpx.Response(
        status_code=429,
        json={"detail": "Rate limit exceeded"},
        request=httpx.Request("POST", "https://api.decart.ai/v1/client/tokens"),
    )
    monkeypatch.setattr(
        "services.decart_vto._send_decart_token_request",
        lambda endpoint, headers, payload: mock_response,
    )

    with TestClient(app) as client:
        resp = client.post("/tryon-live/decart/token", json={}, headers=AUTH_HEADERS)
        assert resp.status_code == status.HTTP_429_TOO_MANY_REQUESTS
        data = resp.json()
        assert "capacity" in data["message"].lower() or "limit" in data["message"].lower()

    app.dependency_overrides.pop(get_current_user, None)


def test_10_upstream_decart_timeout_normalized(monkeypatch):
    """Upstream timeout raises 504 Gateway Timeout."""
    user = make_auth_user()
    app.dependency_overrides[get_current_user] = lambda: user

    monkeypatch.setattr(settings, "DECART_VTO_ENABLED", True)
    monkeypatch.setattr(settings, "DECART_API_KEY", "dct_test_key")

    def mock_timeout(endpoint, headers, payload):
        raise httpx.TimeoutException("Connection timed out")

    monkeypatch.setattr("services.decart_vto._send_decart_token_request", mock_timeout)

    with TestClient(app) as client:
        resp = client.post("/tryon-live/decart/token", json={}, headers=AUTH_HEADERS)
        assert resp.status_code == status.HTTP_504_GATEWAY_TIMEOUT
        data = resp.json()
        assert "timed out" in data["message"].lower()

    app.dependency_overrides.pop(get_current_user, None)


def test_11_decart_status_endpoint(client, monkeypatch):
    """Status endpoint reflects feature flag and configuration."""
    monkeypatch.setattr(settings, "DECART_VTO_ENABLED", False)
    monkeypatch.setattr(settings, "DECART_API_KEY", "")

    resp1 = client.get("/tryon-live/decart/status")
    assert resp1.status_code == status.HTTP_200_OK
    assert resp1.json()["enabled"] is False

    monkeypatch.setattr(settings, "DECART_VTO_ENABLED", True)
    monkeypatch.setattr(settings, "DECART_API_KEY", "dct_key")
    resp2 = client.get("/tryon-live/decart/status")
    assert resp2.status_code == status.HTTP_200_OK
    assert resp2.json()["enabled"] is True
    assert resp2.json()["model"] == "lucy-vton-3.5"
    assert resp2.json()["max_session_seconds"] == 60


def test_12_existing_live_tryon_routes_unaffected(client, monkeypatch):
    """Existing /tryon-live/garments endpoint works as before without regressions."""
    user = make_auth_user()
    app.dependency_overrides[get_current_user] = lambda: user
    monkeypatch.setattr("routes.tryon_live.list_garments", lambda: [])
    try:
        resp = client.get("/tryon-live/garments", headers=AUTH_HEADERS)
        assert resp.status_code == status.HTTP_200_OK
        assert isinstance(resp.json(), list)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


