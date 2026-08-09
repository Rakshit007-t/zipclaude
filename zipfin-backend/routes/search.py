import logging
from typing import List

from fastapi import APIRouter, Depends, Request, status

from core.api import success_response
from models.schema import ApiResponse
from models.social_schema import UserSummary
from models.brand_schema import BrandProfile
from services.request_rate_limiter import enforce_rate_limit

router = APIRouter(prefix="/search", tags=["search"])
logger = logging.getLogger(__name__)


@router.get(
    "/users",
    response_model=ApiResponse[List[UserSummary]],
    status_code=status.HTTP_200_OK,
)
async def search_users(
    request: Request,
    q: str,
    limit: int = 20,
) -> ApiResponse[List[UserSummary]]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"search_users:{client_ip}",
        max_requests=30,
        window_seconds=60,
        detail="Search rate limit exceeded.",
    )
    query_str = (q or "").strip().lower()
    results: List[UserSummary] = []
    if query_str:
        results.append(
            UserSummary(
                uid="user_demo_1",
                display_name=f"User matching '{query_str}'",
                username=f"{query_str}_stylist",
                photo_url=None,
                bio="Fashion stylist & designer",
                is_following=False,
            )
        )
    return success_response(message="Users retrieved.", data=results)


@router.get(
    "/brands",
    response_model=ApiResponse[List[BrandProfile]],
    status_code=status.HTTP_200_OK,
)
async def search_brands(
    request: Request,
    q: str,
    limit: int = 20,
) -> ApiResponse[List[BrandProfile]]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"search_brands:{client_ip}",
        max_requests=30,
        window_seconds=60,
        detail="Brand search rate limit exceeded.",
    )
    query_str = (q or "").strip().lower()
    results: List[BrandProfile] = []
    if query_str:
        results.append(
            BrandProfile(
                id="brand_demo_1",
                seller_uid="seller_demo_1",
                brand_name=f"Brand {query_str.capitalize()}",
                slug=f"brand-{query_str}",
                logo_url=None,
                bio=f"Official {query_str} fit store on ZipRIGHT",
                is_verified=True,
                followers_count=120,
                products_count=45,
                created_at="2026-07-28T00:00:00Z",
            )
        )
    return success_response(message="Brands retrieved.", data=results)
