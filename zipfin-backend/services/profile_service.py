from fastapi import HTTPException, status
from postgrest import APIError

from core.supabase import get_supabase_user_client
from models.schema import ProfileResponse, ProfileUpsertRequest
from services.auth_service import CurrentUser


def fetch_profile(current_user: CurrentUser) -> ProfileResponse:
    client = get_supabase_user_client(current_user.access_token)

    try:
        response = (
            client.table("profiles")
            .select("id,email,brand,size,fit")
            .eq("id", current_user.id)
            .maybe_single()
            .execute()
        )
    except APIError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_extract_api_error_message(exc, "Failed to fetch profile from Supabase."),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch profile from Supabase.",
        ) from exc

    profile_data = response.data
    if profile_data is None:
        return save_profile(
            current_user=current_user,
            payload=ProfileUpsertRequest(),
        )

    return _build_profile_response(profile_data, current_user)


def save_profile(
    current_user: CurrentUser,
    payload: ProfileUpsertRequest,
) -> ProfileResponse:
    client = get_supabase_user_client(current_user.access_token)
    profile_record = {
        "id": current_user.id,
        "email": current_user.email,
        "brand": payload.brand,
        "size": payload.size,
        "fit": payload.fit,
    }

    try:
        client.table("profiles").upsert(profile_record, on_conflict="id").execute()
    except APIError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_extract_api_error_message(exc, "Failed to save profile to Supabase."),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to save profile to Supabase.",
        ) from exc

    return fetch_profile(current_user)


def _build_profile_response(
    profile_data: dict,
    current_user: CurrentUser,
) -> ProfileResponse:
    return ProfileResponse(
        id=str(profile_data.get("id", current_user.id)),
        email=str(profile_data.get("email", current_user.email)),
        brand=profile_data.get("brand"),
        size=profile_data.get("size"),
        fit=profile_data.get("fit"),
    )


def _extract_api_error_message(exc: APIError, default_message: str) -> str:
    message = getattr(exc, "message", None)
    if isinstance(message, str) and message.strip():
        return message
    return default_message
