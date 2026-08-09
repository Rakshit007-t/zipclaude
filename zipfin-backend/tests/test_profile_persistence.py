"""Regression coverage for the authenticated Fit Profile write path."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from main import app
from models.schema import ProfileUpsertRequest
from services.firebase_auth import AuthenticatedUser, get_current_user
from services import profile_service


def _payload() -> dict:
    return {
        "profileId": "primary-user-1",
        "profileName": "Alex",
        "gender": "Male",
        "preferredBrand": "ZipRIGHT",
        "usualSize": "M",
        "baseSize": "M",
        "height": 178,
        "weight": 72,
        "bodyShape": "average",
        "fitPreference": "regular",
        "selectedProfileId": "primary-user-1",
        "selectedProfile": "primary-user-1",
        "recommendationPreferences": {
            "preferredBrand": "ZipRIGHT",
            "baseSize": "M",
            "fitPreference": "regular",
            "bodyShape": "average",
        },
        "measurements": {"chest": 101.6, "waist": 86.4},
        "smartFit": {"chest": 101.6, "waist": 86.4, "confidence": 0.92},
        "fitProfiles": [{"id": "primary-user-1", "profileName": "Alex", "isPrimary": True}],
    }


def test_fit_profile_persists_and_is_available_after_a_fresh_fetch(fake_client, monkeypatch) -> None:
    monkeypatch.setattr(profile_service, "get_firestore_client", lambda: fake_client)
    user = AuthenticatedUser(uid="user-1", email="alex@example.com")

    saved = profile_service.save_profile(user, ProfileUpsertRequest.model_validate(_payload()))
    fetched = profile_service.fetch_profile(user)
    stored = fake_client.collection("users").document(user.uid).get().to_dict()

    assert saved.brand == "ZipRIGHT"
    assert fetched.size == "M"
    assert fetched.fit == "regular"
    assert stored["profileId"] == "primary-user-1"
    assert stored["height"] == 178
    assert stored["measurements"]["waist"] == 86.4
    assert stored["smartFit"]["confidence"] == 0.92


def test_fit_profile_rejects_invalid_measurements_and_unknown_fields() -> None:
    invalid_measurement = _payload()
    invalid_measurement["measurements"] = {"waist": -1}
    with pytest.raises(ValidationError):
        ProfileUpsertRequest.model_validate(invalid_measurement)

    unknown_field = _payload()
    unknown_field["unexpected"] = "not accepted"
    with pytest.raises(ValidationError):
        ProfileUpsertRequest.model_validate(unknown_field)


def test_authenticated_profile_endpoint_validates_and_persists_payload(fake_client, monkeypatch) -> None:
    monkeypatch.setattr(profile_service, "get_firestore_client", lambda: fake_client)
    user = AuthenticatedUser(uid="user-1", email="alex@example.com")
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = TestClient(app).put("/profiles/me", json=_payload())
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 200
    assert response.json()["isValid"] is True
    stored = fake_client.collection("users").document(user.uid).get().to_dict()
    assert stored["fitProfiles"][0]["id"] == "primary-user-1"
