from __future__ import annotations

from fastapi import HTTPException, status
from firebase_admin import firestore

from firebase_config import get_firestore_client
from models.schema import ProfileResponse, ProfileUpsertRequest
from services.firebase_auth import AuthenticatedUser


def _generate_default_username(uid: str) -> str:
    clean_uid = uid.replace("-", "").replace("_", "")[:8].lower()
    return f"user_{clean_uid}"


def fetch_profile(current_user: AuthenticatedUser) -> ProfileResponse:
    profile_ref = _users_collection().document(current_user.uid)
    profile_doc = profile_ref.get()

    if not profile_doc.exists:
        default_username = _generate_default_username(current_user.uid)
        return ProfileResponse(
            id=current_user.uid,
            email=current_user.email or "",
            username=default_username,
            displayName="",
            photoURL=None,
            onboardingCompleted=False,
            fitProfileCompleted=False,
            brand=None,
            size=None,
            fit=None,
            fitProfiles=[],
        )

    payload = profile_doc.to_dict() or {}
    fit_profiles = payload.get("fitProfiles") or []
    has_fit_profiles = bool(fit_profiles) or bool(payload.get("height")) or bool(payload.get("usualSize"))

    username = payload.get("username") or _generate_default_username(current_user.uid)
    return ProfileResponse(
        id=current_user.uid,
        email=current_user.email or "",
        username=username,
        displayName=payload.get("displayName") or "",
        photoURL=payload.get("photoURL"),
        onboardingCompleted=payload.get("onboardingCompleted", True),
        fitProfileCompleted=payload.get("fitProfileCompleted", has_fit_profiles),
        brand=payload.get("preferredBrand"),
        size=payload.get("usualSize"),
        fit=payload.get("fitPreference"),
        fitProfiles=fit_profiles,
    )


def save_profile(current_user: AuthenticatedUser, payload: ProfileUpsertRequest) -> ProfileResponse:
    record: dict[str, float | str | bool | dict | list | None] = {
        "preferredBrand": payload.preferredBrand or payload.brand,
        "usualSize": payload.usualSize or payload.baseSize or payload.size,
        "baseSize": payload.baseSize or payload.usualSize or payload.size,
        "fitPreference": payload.fitPreference or payload.fit,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    field_map = {
        "username": payload.username,
        "displayName": payload.displayName,
        "photoURL": payload.photoURL,
        "onboardingCompleted": payload.onboardingCompleted if payload.onboardingCompleted is not None else True,
        "fitProfileCompleted": True,
        "profileId": payload.profileId,
        "profileName": payload.profileName,
        "gender": payload.gender,
        "height": payload.height,
        "weight": payload.weight,
        "bodyShape": payload.bodyShape,
        "shoulderType": payload.shoulderType,
        "selectedProfileId": payload.selectedProfileId,
        "selectedProfile": payload.selectedProfile,
        "recommendationPreferences": payload.recommendationPreferences,
        "measurements": payload.measurements.model_dump(exclude_none=True) if payload.measurements else None,
        "smartFit": payload.smartFit.model_dump(exclude_none=True) if payload.smartFit else None,
        "fitProfiles": payload.fitProfiles,
    }
    record.update({key: value for key, value in field_map.items() if value is not None})
    record = {key: value for key, value in record.items() if value is not None}

    try:
        profile_ref = _users_collection().document(current_user.uid)
        doc_snap = profile_ref.get()
        if not doc_snap.exists:
            record["createdAt"] = firestore.SERVER_TIMESTAMP
            if "username" not in record:
                record["username"] = _generate_default_username(current_user.uid)
            # These values are enforced by the try-on transaction, but adding
            # them at profile creation keeps the user document schema explicit.
            record["usage"] = {"tryOns": 0}
            record["walletBalanceRupees"] = 0

        profile_ref.set(record, merge=True)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save profile.",
        ) from exc
    return fetch_profile(current_user)


def delete_fit_profile(current_user: AuthenticatedUser, profile_id: str | None = None) -> ProfileResponse:
    """Removes fit profile data from the user document without deleting the user account."""
    profile_ref = _users_collection().document(current_user.uid)
    doc_snap = profile_ref.get()

    if not doc_snap.exists:
        return fetch_profile(current_user)

    data = doc_snap.to_dict() or {}
    fit_profiles = data.get("fitProfiles") or []

    if profile_id and isinstance(fit_profiles, list):
        remaining_profiles = [
            profile
            for profile in fit_profiles
            if isinstance(profile, dict)
            and str(profile.get("id") or profile.get("profileId")) != profile_id
        ]
    else:
        remaining_profiles = []

    has_remaining = len(remaining_profiles) > 0

    if has_remaining:
        selected_profile_id = str(data.get("selectedProfileId") or data.get("selectedProfile") or "")
        replacement_profile = next(
            (profile for profile in remaining_profiles if profile.get("isPrimary") is True),
            remaining_profiles[0],
        )
        replacement_profile_id = str(
            replacement_profile.get("id") or replacement_profile.get("profileId") or ""
        )
        updates = {
            "fitProfiles": remaining_profiles,
            "fitProfileCompleted": True,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        # If the active profile was deleted (or points to stale data), make a
        # remaining profile active and mirror its fields at the document root.
        if selected_profile_id == profile_id or not any(
            str(profile.get("id") or profile.get("profileId")) == selected_profile_id
            for profile in remaining_profiles
        ):
            updates.update({
                "selectedProfileId": replacement_profile_id,
                "selectedProfile": replacement_profile_id,
                "profileId": replacement_profile_id,
                "profileName": replacement_profile.get("profileName"),
                "gender": replacement_profile.get("gender"),
                "preferredBrand": replacement_profile.get("preferredBrand"),
                "usualSize": replacement_profile.get("usualSize"),
                "baseSize": replacement_profile.get("baseSize") or replacement_profile.get("usualSize"),
                "height": replacement_profile.get("height"),
                "weight": replacement_profile.get("weight"),
                "bodyShape": replacement_profile.get("bodyShape"),
                "shoulderType": replacement_profile.get("shoulderType"),
                "fitPreference": replacement_profile.get("fitPreference"),
                "recommendationPreferences": replacement_profile.get("recommendationPreferences"),
                "measurements": replacement_profile.get("measurements"),
                "smartFit": replacement_profile.get("smartFit"),
            })
            updates = {key: value for key, value in updates.items() if value is not None}
        profile_ref.set(updates, merge=True)
    else:
        # Clear fit profile fields while keeping user account, username, settings, followers, etc. intact
        fields_to_delete = {
            "fitProfiles": firestore.DELETE_FIELD,
            "profileId": firestore.DELETE_FIELD,
            "profileName": firestore.DELETE_FIELD,
            "gender": firestore.DELETE_FIELD,
            "preferredBrand": firestore.DELETE_FIELD,
            "usualSize": firestore.DELETE_FIELD,
            "baseSize": firestore.DELETE_FIELD,
            "height": firestore.DELETE_FIELD,
            "weight": firestore.DELETE_FIELD,
            "bodyShape": firestore.DELETE_FIELD,
            "shoulderType": firestore.DELETE_FIELD,
            "fitPreference": firestore.DELETE_FIELD,
            "selectedProfileId": firestore.DELETE_FIELD,
            "selectedProfile": firestore.DELETE_FIELD,
            "recommendationPreferences": firestore.DELETE_FIELD,
            "measurements": firestore.DELETE_FIELD,
            "smartFit": firestore.DELETE_FIELD,
            "fitProfileCompleted": False,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        profile_ref.update(fields_to_delete)

    return fetch_profile(current_user)


def _users_collection():
    return get_firestore_client().collection("users")
