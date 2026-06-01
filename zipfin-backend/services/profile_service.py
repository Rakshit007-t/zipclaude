from __future__ import annotations

from fastapi import HTTPException, status
from firebase_admin import firestore

from firebase_config import initialize_firebase
from models.schema import ProfileResponse, ProfileUpsertRequest
from services.firebase_auth import AuthenticatedUser


def fetch_profile(current_user: AuthenticatedUser) -> ProfileResponse:
    profile_ref = _users_collection().document(current_user.uid)
    profile_doc = profile_ref.get()

    if not profile_doc.exists:
        return ProfileResponse(
            id=current_user.uid,
            email=current_user.email or "",
            brand=None,
            size=None,
            fit=None,
        )

    payload = profile_doc.to_dict() or {}
    return ProfileResponse(
        id=current_user.uid,
        email=current_user.email or "",
        brand=payload.get("preferredBrand"),
        size=payload.get("usualSize"),
        fit=payload.get("fitPreference"),
    )


def save_profile(current_user: AuthenticatedUser, payload: ProfileUpsertRequest) -> ProfileResponse:
    record = {
        "preferredBrand": payload.brand,
        "usualSize": payload.size,
        "fitPreference": payload.fit,
    }
    try:
        _users_collection().document(current_user.uid).set(record, merge=True)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save profile.",
        ) from exc
    return fetch_profile(current_user)


def _users_collection():
    initialize_firebase()
    db = firestore.client()
    return db.collection("users")
