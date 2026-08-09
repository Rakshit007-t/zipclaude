import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status

from core.api import success_response
from models.schema import ApiResponse
from models.social_schema import (
    CommentCreate,
    CommentResponse,
    FollowResponse,
    ReportCreate,
    ShareCreate,
    UserSummary,
)
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.request_rate_limiter import enforce_rate_limit
from services.social_repository import SocialRepository, get_social_repository

router = APIRouter(prefix="/social", tags=["social"])
logger = logging.getLogger(__name__)


@router.post(
    "/follow/{user_id}",
    response_model=ApiResponse[FollowResponse],
    status_code=status.HTTP_200_OK,
)
async def follow_user(
    request: Request,
    user_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
    repository: SocialRepository = Depends(get_social_repository),
) -> ApiResponse[FollowResponse]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"follow:{current_user.uid}:{client_ip}",
        max_requests=30,
        window_seconds=3600,
        detail="Follow action rate limit exceeded (max 30 per hour).",
    )
    is_following = repository.toggle_follow(follower_id=current_user.uid, target_id=user_id)
    return success_response(
        message="Follow status updated.",
        data=FollowResponse(
            follower_id=current_user.uid,
            following_id=user_id,
            is_following=is_following,
            followers_count=1 if is_following else 0,
            following_count=1 if is_following else 0,
        ),
    )


@router.post(
    "/posts/{post_id}/like",
    response_model=ApiResponse[dict],
    status_code=status.HTTP_200_OK,
)
async def like_post(
    request: Request,
    post_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
    repository: SocialRepository = Depends(get_social_repository),
) -> ApiResponse[dict]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"like:{current_user.uid}:{client_ip}",
        max_requests=60,
        window_seconds=60,
        detail="Like action rate limit exceeded (max 60 per minute).",
    )
    liked, likes_count = repository.toggle_like(current_user.uid, post_id)
    return success_response(
        message="Post like status updated.",
        data={"post_id": post_id, "liked": liked, "likes_count": likes_count},
    )


@router.post(
    "/posts/{post_id}/comments",
    response_model=ApiResponse[CommentResponse],
    status_code=status.HTTP_201_CREATED,
)
async def add_comment(
    request: Request,
    post_id: str,
    payload: CommentCreate,
    current_user: AuthenticatedUser = Depends(get_current_user),
    repository: SocialRepository = Depends(get_social_repository),
) -> ApiResponse[CommentResponse]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"comment:{current_user.uid}:{client_ip}",
        max_requests=20,
        window_seconds=60,
        detail="Comment rate limit exceeded (max 20 per minute).",
    )
    comment = repository.add_comment(current_user.uid, post_id, payload)
    return success_response(message="Comment posted.", data=comment)


@router.get(
    "/posts/{post_id}/comments",
    response_model=ApiResponse[List[CommentResponse]],
)
async def list_comments(
    post_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
    repository: SocialRepository = Depends(get_social_repository),
) -> ApiResponse[List[CommentResponse]]:
    return success_response(message="Comments retrieved.", data=repository.list_comments(post_id))


@router.get(
    "/users/{user_id}/{relationship}",
    response_model=ApiResponse[List[UserSummary]],
)
async def list_relationship(
    user_id: str,
    relationship: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
    repository: SocialRepository = Depends(get_social_repository),
) -> ApiResponse[List[UserSummary]]:
    # The returned edges contain the same minimised fields as public profiles;
    # fit data and account data never leave the backend through this endpoint.
    return success_response(
        message="Social relationship retrieved.",
        data=repository.list_relationship(user_id, relationship),
    )


@router.post("/reports", response_model=ApiResponse[dict], status_code=status.HTTP_201_CREATED)
async def create_report(
    request: Request,
    payload: ReportCreate,
    current_user: AuthenticatedUser = Depends(get_current_user),
    repository: SocialRepository = Depends(get_social_repository),
) -> ApiResponse[dict]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"report:{current_user.uid}:{client_ip}",
        max_requests=20,
        window_seconds=3600,
        detail="Report rate limit exceeded (max 20 per hour).",
    )
    return success_response(message="Report submitted.", data=repository.create_report(current_user.uid, payload))


@router.post("/posts/{post_id}/share", response_model=ApiResponse[dict], status_code=status.HTTP_201_CREATED)
async def share_post(
    request: Request,
    post_id: str,
    payload: ShareCreate,
    current_user: AuthenticatedUser = Depends(get_current_user),
    repository: SocialRepository = Depends(get_social_repository),
) -> ApiResponse[dict]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"share:{current_user.uid}:{client_ip}", max_requests=30, window_seconds=3600,
        detail="Share rate limit exceeded (max 30 per hour).",
    )
    return success_response(message="Post shared.", data=repository.share_post(current_user.uid, post_id, payload))


@router.put("/users/{user_id}/{preference}", response_model=ApiResponse[dict])
async def set_safety_preference(
    request: Request,
    user_id: str,
    preference: str,
    enabled: bool = True,
    current_user: AuthenticatedUser = Depends(get_current_user),
    repository: SocialRepository = Depends(get_social_repository),
) -> ApiResponse[dict]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"safety:{current_user.uid}:{client_ip}", max_requests=60, window_seconds=3600,
        detail="Safety action rate limit exceeded.",
    )
    value = repository.set_user_preference(current_user.uid, user_id, preference, enabled)
    return success_response(message="Safety preference updated.", data={"user_id": user_id, "preference": preference, "enabled": value})
