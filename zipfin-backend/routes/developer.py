import logging

from fastapi import APIRouter, Depends, HTTPException, status

from core.api import success_response
from models.developer_schema import (
    ApiKeyCreateRequest,
    ApiKeyCreateResponse,
    ApiKeyMetadataResponse,
    UsageAnalyticsResponse,
)
from models.schema import ApiResponse
from services.developer_service import (
    create_api_key,
    list_api_keys,
    revoke_api_key,
    get_developer_analytics,
)
from services.firebase_auth import AuthenticatedUser, get_current_user

router = APIRouter(prefix="/developer", tags=["developer"])
logger = logging.getLogger(__name__)


@router.post(
    "/keys",
    response_model=ApiResponse[ApiKeyCreateResponse],
    status_code=status.HTTP_201_CREATED,
)
async def generate_api_key(
    payload: ApiKeyCreateRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[ApiKeyCreateResponse]:
    """Generate a new API Key for the authenticated developer."""
    try:
        result = create_api_key(current_user.uid, payload)
        return success_response(
            message="API key created successfully. Save the raw key securely.", 
            data=result
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected API Key creation failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create API key.",
        ) from exc


@router.get(
    "/keys",
    response_model=ApiResponse[list[ApiKeyMetadataResponse]],
    status_code=status.HTTP_200_OK,
)
async def get_api_keys(
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[list[ApiKeyMetadataResponse]]:
    """List all active API Keys for the authenticated developer."""
    try:
        result = list_api_keys(current_user.uid)
        return success_response(
            message="API keys fetched successfully.", 
            data=result
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected API Key fetch failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch API keys.",
        ) from exc


@router.delete(
    "/keys/{key_id}",
    response_model=ApiResponse[dict],
    status_code=status.HTTP_200_OK,
)
async def delete_api_key(
    key_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[dict]:
    """Revoke an API Key."""
    try:
        revoke_api_key(current_user.uid, key_id)
        return success_response(
            message="API key revoked successfully.", 
            data={"success": True}
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected API Key revoke failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to revoke API key.",
        ) from exc


@router.get(
    "/analytics",
    response_model=ApiResponse[UsageAnalyticsResponse],
    status_code=status.HTTP_200_OK,
)
async def get_analytics(
    time_range: str = "24h",
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[UsageAnalyticsResponse]:
    """Retrieve usage analytics metrics for the authenticated developer."""
    try:
        data = get_developer_analytics(current_user.uid, time_range=time_range)
        return success_response(
            message="Analytics retrieved successfully.",
            data=data,
        )
    except Exception as exc:
        logger.exception("Unexpected analytics fetch failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch analytics.",
        ) from exc
