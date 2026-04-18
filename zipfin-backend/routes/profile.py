import logging

from fastapi import APIRouter, Depends, HTTPException, status

from core.api import success_response
from models.schema import ApiResponse, ProfileResponse, ProfileUpsertRequest
from services.auth_service import CurrentUser, get_current_user
from services.profile_service import fetch_profile, save_profile

router = APIRouter(prefix="/profiles", tags=["profiles"])
logger = logging.getLogger(__name__)


@router.get(
    "/me",
    response_model=ApiResponse[ProfileResponse],
    status_code=status.HTTP_200_OK,
)
async def get_my_profile(
    current_user: CurrentUser = Depends(get_current_user),
) -> ApiResponse[ProfileResponse]:
    try:
        profile = fetch_profile(current_user)
        return success_response(message="Profile fetched successfully.", data=profile)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected profile fetch failure for user '%s'.", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch profile.",
        ) from exc


@router.put(
    "/me",
    response_model=ApiResponse[ProfileResponse],
    status_code=status.HTTP_200_OK,
)
async def save_my_profile(
    payload: ProfileUpsertRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> ApiResponse[ProfileResponse]:
    try:
        profile = save_profile(current_user, payload)
        return success_response(message="Profile saved successfully.", data=profile)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected profile save failure for user '%s'.", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save profile.",
        ) from exc
