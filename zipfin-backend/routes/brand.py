import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status

from core.api import success_response
from models.schema import ApiResponse
from models.brand_schema import BrandProfile, CollectionResponse
from services.request_rate_limiter import enforce_rate_limit

router = APIRouter(prefix="/brands", tags=["brands"])
logger = logging.getLogger(__name__)


@router.get(
    "/{slug_or_id}",
    response_model=ApiResponse[BrandProfile],
    status_code=status.HTTP_200_OK,
)
async def get_brand_profile(
    request: Request,
    slug_or_id: str,
) -> ApiResponse[BrandProfile]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"brand_profile:{client_ip}",
        max_requests=60,
        window_seconds=60,
        detail="Brand profile rate limit exceeded.",
    )
    brand = BrandProfile(
        id=f"brand_{slug_or_id}",
        seller_uid="seller_demo",
        brand_name=slug_or_id.replace("-", " ").capitalize(),
        slug=slug_or_id.lower(),
        logo_url=None,
        banner_url=None,
        bio=f"Official ZipRIGHT Brand Profile for {slug_or_id}",
        website_url=f"https://{slug_or_id}.com",
        is_verified=True,
        followers_count=340,
        products_count=28,
        created_at="2026-07-28T00:00:00Z",
    )
    return success_response(message="Brand profile retrieved.", data=brand)


@router.get(
    "/{slug_or_id}/collections",
    response_model=ApiResponse[List[CollectionResponse]],
    status_code=status.HTTP_200_OK,
)
async def get_brand_collections(
    request: Request,
    slug_or_id: str,
) -> ApiResponse[List[CollectionResponse]]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"brand_collections:{client_ip}",
        max_requests=60,
        window_seconds=60,
        detail="Brand collections rate limit exceeded.",
    )
    collections = [
        CollectionResponse(
            id=f"col_summer_{slug_or_id}",
            brand_id=slug_or_id,
            name="Summer Essentials '26",
            slug="summer-essentials-26",
            description="Lightweight breathable fits calibrated for summer",
            cover_image_url=None,
            product_count=12,
            is_public=True,
            product_ids=[],
            created_at="2026-07-28T00:00:00Z",
        )
    ]
    return success_response(message="Brand collections retrieved.", data=collections)
