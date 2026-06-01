from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import app
from models.schema import (
    AuthResult,
    AuthSession,
    AuthUser,
    AvatarCreateResponse,
    PredictSizeResponse,
    ProfileResponse,
    SizeEngineResponse,
    TryOnImageResponse,
)
from services.firebase_auth import AuthenticatedUser, get_current_user

TEST_USER = AuthenticatedUser(uid="user-123", email="user@example.com")


def _authorized_client() -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: TEST_USER
    return TestClient(app)


def _cleanup_overrides() -> None:
    app.dependency_overrides.pop(get_current_user, None)


def test_size_engine(client: TestClient) -> None:
    with patch(
        "routes.size.calculate_size_recommendation",
        new=AsyncMock(
            return_value=SizeEngineResponse(
                size="M",
                confidence=88.0,
                risk="low",
                reason="Adjusted using category, brand bias, and fit preference.",
            )
        ),
    ):
        response = client.post(
            "/size-engine",
            json={
                "product": {
                    "id": "prod-1",
                    "title": "Oversized Tee",
                    "brand": "Zara",
                    "category": "tshirt",
                    "price": "INR 1999",
                    "image": "https://example.com/shirt.png",
                    "url": "https://www.zara.com/in/en/oversized-tee-p0000001.html",
                    "source": "link",
                    "confidence": 0.7,
                },
                "profile": {
                    "base_size": "M",
                    "fit_preference": "regular",
                },
            },
        )

    response.raise_for_status()
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["size"] == "M"
    assert payload["data"]["risk"] == "low"
    print("Size Engine:", response.status_code, payload["message"])


def test_predict_size(client: TestClient) -> None:
    with patch(
        "routes.size.calculate_size_recommendation",
        new=AsyncMock(
            return_value=SizeEngineResponse(
                size="S",
                confidence=74.0,
                risk="medium",
                reason="Adjusted using category, brand bias, and fit preference.",
            )
        ),
    ):
        response = client.post(
            "/predict-size",
            json={
                "link": "https://www.zara.com/in/en/basic-t-shirt-p0000002.html",
                "height": 172,
                "measurements": {
                    "chest": 94,
                    "waist": 81,
                },
            },
        )

    response.raise_for_status()
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"] == PredictSizeResponse(size="S", confidence=0.74).model_dump()
    print("Predict Size:", response.status_code, payload["message"])


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

    assert response.status_code == 201
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

    assert response.status_code == 201
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["user_id"] == "user-123"
    print("Avatar:", response.status_code, payload["message"])


def test_profile_fetch_and_save(client: TestClient) -> None:
    mocked_profile = ProfileResponse(
        id="user-123",
        email="user@example.com",
        brand="ZipRight",
        size="M",
        fit="regular",
    )
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
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert response.headers.get("access-control-allow-credentials") == "true"
    print("CORS:", response.status_code, response.headers["access-control-allow-origin"])


def main() -> None:
    client = _authorized_client()
    try:
        test_size_engine(client)
        test_predict_size(client)
        test_auth_signup(client)
        test_auth_login(client)
        test_avatar(client)
        test_profile_fetch_and_save(client)
        test_tryon(client)
        test_cors(client)
    finally:
        _cleanup_overrides()
    print("API smoke tests passed.")


if __name__ == "__main__":
    main()
