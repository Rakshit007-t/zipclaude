import logging
from typing import List

from fastapi import APIRouter, Depends, Request, status

from core.api import success_response
from models.schema import ApiResponse
from models.social_schema import NotificationItem
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.request_rate_limiter import enforce_rate_limit

router = APIRouter(prefix="/notifications", tags=["notifications"])
logger = logging.getLogger(__name__)


@router.get(
    "",
    response_model=ApiResponse[List[NotificationItem]],
    status_code=status.HTTP_200_OK,
)
async def get_notifications(
    request: Request,
    limit: int = 20,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[List[NotificationItem]]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"notifications:{current_user.uid}:{client_ip}",
        max_requests=60,
        window_seconds=60,
        detail="Notifications rate limit exceeded.",
    )
    items: List[NotificationItem] = []
    return success_response(message="Notifications retrieved.", data=items)


@router.put(
    "/read",
    response_model=ApiResponse[dict],
    status_code=status.HTTP_200_OK,
)
async def mark_notifications_read(
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[dict]:
    return success_response(message="Notifications marked as read.", data={"success": True})
