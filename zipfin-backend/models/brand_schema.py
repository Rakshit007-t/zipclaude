from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field


class BrandProfile(BaseModel):
    id: str
    seller_uid: str
    brand_name: str
    slug: str
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None
    bio: Optional[str] = None
    website_url: Optional[str] = None
    is_verified: bool = True
    followers_count: int = 0
    products_count: int = 0
    created_at: str


class CollectionCreate(BaseModel):
    name: str = Field(..., max_length=100)
    slug: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    cover_image_url: Optional[str] = None
    is_public: bool = True
    product_ids: List[str] = Field(default_factory=list)


class CollectionResponse(BaseModel):
    id: str
    brand_id: str
    name: str
    slug: str
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    product_count: int = 0
    is_public: bool = True
    product_ids: List[str] = Field(default_factory=list)
    created_at: str


class SellerUsageMetrics(BaseModel):
    total_api_calls: int = 0
    widget_impressions: int = 0
    tryon_generations: int = 0
    size_recommendations: int = 0
    rate_limit_hits: int = 0
    recent_activity: List[dict] = Field(default_factory=list)
