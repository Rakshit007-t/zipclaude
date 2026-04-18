from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import app
from models.schema import (
    AuthResult,
    AuthSession,
    AuthUser,
    AvatarCreateResponse,
    ProfileResponse,
    TryOnImageResponse,
)
from services.auth_service import CurrentUser, get_current_user


def test_size_engine(client: TestClient) -> None:
    response = client.post(
        "/size-engine",
        json={
            "chest": 100,
            "waist_cm": 85,
            "hip_cm": 95,
            "fit": "regular",
            "brand": "zara",
            "range": "M-L",
        },
    )
    response.raise_for_status()
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["size"] in {"S", "M", "L", "XL", "XXL", "XS"}
    print("Size Engine:", response.status_code, payload["message"])


def test_auth_signup(client: TestClient) -> None:
    mocked_auth_result = AuthResult(
        user=AuthUser(id="user-123", email="user@example.com"),
        session=None,
        needs_email_verification=True,
    )
    with patch(
        "routes.auth.sign_up_with_email",
        return_value=mocked_auth_result,
    ):
        response = client.post(
            "/auth/signup",
            json={"email": "user@example.com", "password": "secret123"},
        )

    response.raise_for_status()
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["needs_email_verification"] is True
    print("Auth Signup:", response.status_code, payload["message"])


def test_auth_login(client: TestClient) -> None:
    mocked_auth_result = AuthResult(
        user=AuthUser(id="user-123", email="user@example.com"),
        session=AuthSession(
            access_token="access-token",
            refresh_token="refresh-token",
            expires_in=3600,
            token_type="bearer",
        ),
        needs_email_verification=False,
    )
    with patch(
        "routes.auth.sign_in_with_email",
        return_value=mocked_auth_result,
    ):
        response = client.post(
            "/auth/login",
            json={"email": "user@example.com", "password": "secret123"},
        )

    response.raise_for_status()
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["session"]["access_token"] == "access-token"
    print("Auth Login:", response.status_code, payload["message"])


def test_avatar(client: TestClient) -> None:
    mocked_avatar_response = AvatarCreateResponse(
        user_id="user-123",
        public_path="/uploads/user-123.png",
        embedding=[0.1, 0.2, 0.3],
    )
    with patch(
        "routes.avatar.process_avatar_upload",
        new=AsyncMock(return_value=mocked_avatar_response),
    ):
        response = client.post(
            "/avatar-create",
            files={"file": ("test.png", b"fake-image", "image/png")},
        )

    response.raise_for_status()
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["user_id"] == "user-123"
    print("Avatar:", response.status_code, payload["message"])


def test_profile_fetch_and_save(client: TestClient) -> None:
    current_user = CurrentUser(
        id="user-123",
        email="user@example.com",
        access_token="access-token",
    )
    mocked_profile = ProfileResponse(
        id="user-123",
        email="user@example.com",
        brand="ZipRight",
        size="M",
        fit="regular",
    )
    app.dependency_overrides[get_current_user] = lambda: current_user
    try:
        with patch(
            "routes.profile.fetch_profile",
            return_value=mocked_profile,
        ):
            fetch_response = client.get(
                "/profiles/me",
                headers={"Authorization": "Bearer access-token"},
            )

        with patch(
            "routes.profile.save_profile",
            return_value=mocked_profile,
        ):
            save_response = client.put(
                "/profiles/me",
                headers={"Authorization": "Bearer access-token"},
                json={"brand": "ZipRight", "size": "M", "fit": "regular"},
            )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    fetch_response.raise_for_status()
    save_response.raise_for_status()
    assert fetch_response.json()["data"]["email"] == "user@example.com"
    assert save_response.json()["data"]["brand"] == "ZipRight"
    print("Profile Fetch:", fetch_response.status_code, fetch_response.json()["message"])
    print("Profile Save:", save_response.status_code, save_response.json()["message"])


def test_tryon(client: TestClient) -> None:
    mocked_tryon_response = TryOnImageResponse(
        tryon_image="https://example.com/tryon.png",
    )
    with patch(
        "routes.tryon.process_tryon_request",
        new=AsyncMock(return_value=mocked_tryon_response),
    ):
        response = client.post(
            "/tryon-image",
            json={
                "user_id": "user-123",
                "product_image_url": "https://example.com/products/shirt.png",
            },
        )

    response.raise_for_status()
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["tryon_image"] == "https://example.com/tryon.png"
    print("Tryon:", response.status_code, payload["message"])


def test_cors(client: TestClient) -> None:
    response = client.options(
        "/size-engine",
        headers={
            "Origin": "https://example.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "*"
    print("CORS:", response.status_code, response.headers["access-control-allow-origin"])


def main() -> None:
    client = TestClient(app)
    test_size_engine(client)
    test_auth_signup(client)
    test_auth_login(client)
    test_avatar(client)
    test_profile_fetch_and_save(client)
    test_tryon(client)
    test_cors(client)
    print("API smoke tests passed.")


if __name__ == "__main__":
    main()
