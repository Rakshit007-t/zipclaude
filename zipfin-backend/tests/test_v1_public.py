import pytest
from fastapi.testclient import TestClient

from main import app
from services.developer_service import (
    generate_raw_api_key,
    hash_api_key,
    verify_api_key_hash,
)

client = TestClient(app)


def test_api_key_generation_and_hashing():
    """Test zr_test_ and zr_live_ key formats and PBKDF2 salted hash verification."""
    test_key = generate_raw_api_key(environment="test")
    assert test_key.startswith("zr_test_")
    assert len(test_key) > 30

    live_key = generate_raw_api_key(environment="live")
    assert live_key.startswith("zr_live_")
    assert len(live_key) > 30

    hashed = hash_api_key(test_key)
    assert "$" in hashed
    assert verify_api_key_hash(test_key, hashed) is True
    assert verify_api_key_hash("zr_test_invalidkey123", hashed) is False


def test_public_v1_health():
    """Test /v1/health unauthenticated endpoint."""
    response = client.get("/v1/health")
    assert response.status_code == 200
    json_data = response.json()
    assert json_data["isValid"] is True
    assert json_data["data"]["status"] == "online"
    assert json_data["data"]["api_version"] == "v1"


def test_public_v1_auth_rejection():
    """Test that public endpoints reject requests without valid API keys."""
    # Missing API Key
    res1 = client.post("/v1/try-on", json={"cloth_type": "upper_body"})
    assert res1.status_code == 401
    assert "API key required" in res1.json()["message"]

    # Invalid API Key format
    res2 = client.post(
        "/v1/try-on",
        json={"cloth_type": "upper_body"},
        headers={"X-API-Key": "invalid_key_format"},
    )
    assert res2.status_code == 401
    assert "Invalid API key format" in res2.json()["message"]
