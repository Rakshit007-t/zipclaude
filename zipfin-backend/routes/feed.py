import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status

from core.api import success_response
from models.schema import ApiResponse
from models.social_schema import FeedResponse, PostCreate, PostResponse
from services.firebase_auth import AuthenticatedUser, get_optional_user, get_current_user
from services.request_rate_limiter import enforce_rate_limit
from services.social_repository import SocialRepository, get_social_repository

router = APIRouter(prefix="/feed", tags=["feed"])
logger = logging.getLogger(__name__)


@router.get(
    "/home",
    response_model=ApiResponse[FeedResponse],
    status_code=status.HTTP_200_OK,
)
async def get_home_feed(
    request: Request,
    limit: int = 20,
    current_user: AuthenticatedUser = Depends(get_optional_user),
    repository: SocialRepository = Depends(get_social_repository),
) -> ApiResponse[FeedResponse]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"feed_home:{client_ip}",
        max_requests=60,
        window_seconds=60,
        detail="Too many feed requests.",
    )
    feed_data = repository.get_feed(user_id=current_user.uid, post_type="post", limit=limit)
    return success_response(message="Home feed retrieved.", data=feed_data)


@router.get(
    "/reels",
    response_model=ApiResponse[FeedResponse],
    status_code=status.HTTP_200_OK,
)
async def get_reels_feed(
    request: Request,
    limit: int = 10,
    current_user: AuthenticatedUser = Depends(get_optional_user),
    repository: SocialRepository = Depends(get_social_repository),
) -> ApiResponse[FeedResponse]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"feed_reels:{client_ip}",
        max_requests=60,
        window_seconds=60,
        detail="Too many reels feed requests.",
    )
    reels_data = repository.get_feed(user_id=current_user.uid, post_type="reel", limit=limit)
    return success_response(message="Fashion reels feed retrieved.", data=reels_data)


@router.post(
    "/posts",
    response_model=ApiResponse[PostResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_post(
    request: Request,
    payload: PostCreate,
    current_user: AuthenticatedUser = Depends(get_current_user),
    repository: SocialRepository = Depends(get_social_repository),
) -> ApiResponse[PostResponse]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"post_create:{current_user.uid}:{client_ip}",
        max_requests=5,
        window_seconds=3600,
        detail="Post creation rate limit reached (max 5 per hour).",
    )
    post = repository.create_post(user_id=current_user.uid, payload=payload)
    return success_response(message="Post published successfully.", data=post)
