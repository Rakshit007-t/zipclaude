"""Public integration endpoints.

These endpoints are unauthenticated and serve the ZipRIGHT JavaScript Widget SDK.
They resolve seller products by stable Firestore document IDs wherever possible,
falling back to title search only when no ID is supplied.

Endpoints:
  GET  /public/widget-config             - SDK initialisation payload
  GET  /public/integration/products      - List active products for a store
  GET  /public/integration/product       - Resolve a single product by id or title
  POST /public/integration/recommendation - Size recommendation (unauthenticated)
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from core.api import success_response
from firebase_config import get_firestore_client
from models.schema import (
    ApiResponse,
    NormalizedProduct,
    SizeEngineProfile,
    SizeEngineRequest,
    SizeEngineResponse,
)
from services.request_rate_limiter import enforce_rate_limit
from services.size_engine import calculate_size_recommendation

router = APIRouter(prefix="/public", tags=["public"])
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Rate limit constants (per-IP, in-process sliding window)
# ---------------------------------------------------------------------------
_RL_WINDOW = 60  # seconds
_RL_CONFIG = 30  # /widget-config and /product GET
_RL_PRODUCTS = 20  # /products list
_RL_RECOMMENDATION = 10  # /recommendation POST (most expensive)

# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class PublicRecommendationRequest(BaseModel):
    """Input for the size recommendation endpoint.

    ``product_id`` (Firestore document ID) is preferred over ``product_title``
    because IDs are stable; titles can change after import.
    """

    store_url: str
    product_id: str | None = Field(
        default=None,
        description="Stable Firestore document ID of the seller product.",
    )
    product_title: str | None = Field(
        default=None,
        description="Product title – fallback when product_id is unavailable.",
    )
    height: float = Field(..., gt=0, le=300)
    weight: float = Field(..., gt=0, le=500)
    base_size: Literal["XS", "S", "M", "L", "XL", "XXL"] = "M"
    fit_preference: Literal["slim", "regular", "relaxed", "loose", "baggy"] = "regular"
    chest: float | None = Field(default=None, gt=0, le=300)
    waist: float | None = Field(default=None, gt=0, le=300)
    shoulders: float | None = Field(default=None, gt=0, le=300)
    hips: float | None = Field(default=None, gt=0, le=300)
    legs: float | None = Field(default=None, gt=0, le=300)
    bust: float | None = Field(default=None, gt=0, le=300)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _canonical_store_key(url: str) -> str:
    """Canonical host identity of a store URL.

    Lowercases, drops the scheme, a leading ``www.``, any path/query/fragment,
    and trailing separators, leaving ``host[:port]``. Two URLs identify the
    same store iff their canonical keys are equal — used for exact matching so
    resolution can never bleed across tenants.
    """
    value = (url or "").strip().lower()
    for scheme in ("https://", "http://"):
        if value.startswith(scheme):
            value = value[len(scheme):]
            break
    value = value.split("/")[0].split("?")[0].split("#")[0]
    if value.startswith("www."):
        value = value[4:]
    return value.strip(". ")


def _get_seller_uid_by_store_url(db, store_url: str) -> str:
    """Resolve seller_uid from a registered store URL.

    Fast path: exact indexed match on the stored value (raw, then
    protocol-stripped) for backward compatibility. Fallback: canonical host
    EXACT-equality scan.

    Deliberately NOT substring matching: a substring rule let "shop.com"
    resolve to "myshop.com" and let "shop.com.attacker.com" resolve to
    "shop.com" — cross-tenant catalogue/recommendation exposure.
    """
    store_url_clean = store_url.strip().rstrip("/")

    snaps = (
        db.collection("seller_integrations")
        .where("store_url", "==", store_url_clean)
        .get()
    )
    if snaps:
        return (snaps[0].to_dict() or {}).get("seller_uid")

    # Strip protocol and retry (exact, indexed)
    fallback_url = store_url_clean.replace("https://", "").replace("http://", "")
    snaps = (
        db.collection("seller_integrations")
        .where("store_url", "==", fallback_url)
        .get()
    )
    if snaps:
        return (snaps[0].to_dict() or {}).get("seller_uid")

    # Canonical host exact-equality scan (handles scheme / www / path /
    # trailing-slash variants without cross-tenant bleed).
    target = _canonical_store_key(store_url)
    if target:
        for snap in db.collection("seller_integrations").get():
            data = snap.to_dict() or {}
            if _canonical_store_key(data.get("store_url", "")) == target:
                uid = data.get("seller_uid")
                if uid:
                    return uid

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Store connection configuration not found for URL: {store_url}",
    )


def _get_seller_product(
    db,
    seller_uid: str,
    product_id: str | None = None,
    product_title: str | None = None,
) -> dict:
    """Fetch a single seller product.

    Resolution order (most-to-least stable):
      1. Firestore document ID  (product_id param)
      2. Exact title match
      3. Substring title match
    """
    # --- primary: stable document ID ---
    if product_id:
        doc = db.collection("seller_products").document(product_id).get()
        if doc.exists:
            data = doc.to_dict() or {}
            if data.get("seller_uid") == seller_uid and data.get("status") != "archived":
                data["id"] = doc.id
                return data
        # product_id supplied but not matched – do NOT fall through to title
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Product '{product_id}' not found in store catalog.",
        )

    # --- fallback: title search ---
    if product_title:
        title_clean = product_title.strip().lower()
        snaps = (
            db.collection("seller_products")
            .where("seller_uid", "==", seller_uid)
            .get()
        )
        # exact match
        for snap in snaps:
            data = snap.to_dict() or {}
            if (
                data.get("title", "").strip().lower() == title_clean
                and data.get("status") != "archived"
            ):
                data["id"] = snap.id
                return data
        # substring match
        for snap in snaps:
            data = snap.to_dict() or {}
            if (
                title_clean in data.get("title", "").strip().lower()
                and data.get("status") != "archived"
            ):
                data["id"] = snap.id
                return data

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Product not found in store catalog.",
    )


def _flatten_size_chart(raw_chart: dict | None) -> dict[str, float]:
    """Convert nested per-size measurement maps to simple ``{size: chest_cm}`` floats.

    Supports both flat ``{"M": 100.0}`` and nested ``{"M": {"chest": 100.0}}`` formats.
    """
    if not isinstance(raw_chart, dict):
        return {}

    result: dict[str, float] = {}
    for sz_key, raw_val in raw_chart.items():
        if isinstance(raw_val, dict):
            chest_val = (
                raw_val.get("chest")
                or raw_val.get("chest_cm")
                or raw_val.get("bust")
            )
            if chest_val is not None:
                try:
                    result[sz_key] = float(chest_val)
                except (TypeError, ValueError):
                    pass
        elif isinstance(raw_val, (int, float)):
            result[sz_key] = float(raw_val)
    return result


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/widget-config",
    response_model=ApiResponse[dict],
    status_code=status.HTTP_200_OK,
)
async def get_widget_config(
    request: Request,
    store_url: str,
    db=Depends(get_firestore_client),
) -> ApiResponse[dict]:
    enforce_rate_limit(
        key=f"widget_config:{request.client.host if request.client else 'unknown'}",
        max_requests=_RL_CONFIG,
        window_seconds=_RL_WINDOW,
        detail="Too many widget config requests. Please wait a moment.",
    )
    """SDK initialisation payload.

    Returns the seller UID and store metadata so the widget can operate
    without the merchant hard-coding private identifiers.
    """
    seller_uid = _get_seller_uid_by_store_url(db, store_url)

    # Fetch seller profile for branding
    seller_doc = db.collection("sellers").document(seller_uid).get()
    seller_data = seller_doc.to_dict() or {} if seller_doc.exists else {}
    profile = seller_data.get("profile") or {}
    # M1 seller docs are flat (store_name at top level); some older docs nest it
    # under "profile". Read flat first, fall back to nested for compatibility.
    store_name = seller_data.get("store_name") or profile.get("store_name") or ""

    return success_response(
        message="Widget configuration resolved.",
        data={
            "seller_uid": seller_uid,
            "store_name": store_name,
            "store_url": store_url,
            "zipright_app_url": "https://zipright.ai",
        },
    )


@router.get(
    "/integration/products",
    response_model=ApiResponse[list[dict]],
    status_code=status.HTTP_200_OK,
)
async def list_public_products(
    request: Request,
    store_url: str,
    limit: int = 50,
    db=Depends(get_firestore_client),
) -> ApiResponse[list[dict]]:
    enforce_rate_limit(
        key=f"pub_products:{request.client.host if request.client else 'unknown'}",
        max_requests=_RL_PRODUCTS,
        window_seconds=_RL_WINDOW,
        detail="Too many product list requests. Please wait a moment.",
    )
    """List active products for a connected store (up to *limit* items).

    The widget SDK calls this to build its internal product catalogue map
    so lookups can use stable Firestore IDs after the first page load.
    """
    seller_uid = _get_seller_uid_by_store_url(db, store_url)
    snaps = (
        db.collection("seller_products")
        .where("seller_uid", "==", seller_uid)
        .get()
    )
    products: list[dict] = []
    for snap in snaps:
        data = snap.to_dict() or {}
        if data.get("status") == "archived":
            continue
        products.append({
            "id": snap.id,
            "title": data.get("title", ""),
            "brand": data.get("brand", ""),
            "category": data.get("category", ""),
            "price": data.get("price"),
            "images": data.get("images", []),
            "available_sizes": list(data.get("size_chart", {}).keys()) if data.get("size_chart") else [],
        })
        if len(products) >= limit:
            break

    return success_response(
        message=f"{len(products)} products retrieved.",
        data=products,
    )


@router.get(
    "/integration/product",
    response_model=ApiResponse[dict],
    status_code=status.HTTP_200_OK,
)
async def get_public_product(
    request: Request,
    store_url: str,
    product_id: str | None = None,
    product_title: str | None = None,
    db=Depends(get_firestore_client),
) -> ApiResponse[dict]:
    enforce_rate_limit(
        key=f"pub_product:{request.client.host if request.client else 'unknown'}",
        max_requests=_RL_CONFIG,
        window_seconds=_RL_WINDOW,
        detail="Too many product lookup requests. Please wait a moment.",
    )
    """Resolve a single product.

    ``product_id`` (Firestore document ID) is preferred for stable lookups.
    ``product_title`` is accepted as a fallback for legacy merchant integrations.
    """
    seller_uid = _get_seller_uid_by_store_url(db, store_url)
    product_data = _get_seller_product(db, seller_uid, product_id, product_title)
    return success_response(
        message="Product resolved successfully.",
        data=product_data,
    )


@router.post(
    "/integration/recommendation",
    response_model=ApiResponse[SizeEngineResponse],
    status_code=status.HTTP_200_OK,
)
async def get_public_recommendation(
    request: Request,
    payload: PublicRecommendationRequest,
    db=Depends(get_firestore_client),
) -> ApiResponse[SizeEngineResponse]:
    """Compute a size recommendation for a storefront shopper.

    This endpoint is unauthenticated and designed to be called by the
    ZipRIGHT Widget SDK from third-party merchant websites.
    """
    enforce_rate_limit(
        key=f"pub_rec:{request.client.host if request.client else 'unknown'}",
        max_requests=_RL_RECOMMENDATION,
        window_seconds=_RL_WINDOW,
        detail="Too many recommendation requests. Please wait a minute.",
    )
    seller_uid = _get_seller_uid_by_store_url(db, payload.store_url)
    product_data = _get_seller_product(
        db, seller_uid, payload.product_id, payload.product_title
    )

    # Flatten nested size charts (supports both flat and multi-measurement formats)
    flattened_chart = _flatten_size_chart(product_data.get("size_chart"))

    images = product_data.get("images", [])
    normalized_product = NormalizedProduct(
        id=product_data["id"],
        title=product_data["title"],
        brand=product_data.get("brand") or "Generic Brand",
        category=product_data.get("category") or "Clothing",
        price=product_data.get("price"),
        image=images[0] if images else None,
        url=product_data.get("source_url") or "https://placeholder-url.com",
        source="link",
        confidence=1.0,
        fit_hint=product_data.get("fit_type"),
        size_chart=flattened_chart if flattened_chart else None,
        available_sizes=list(flattened_chart.keys()) if flattened_chart else None,
        size_format=None,
    )

    profile = SizeEngineProfile(
        base_size=payload.base_size,
        fit_preference=payload.fit_preference,
        chest=payload.chest,
        waist=payload.waist,
        shoulders=payload.shoulders,
        hips=payload.hips,
        legs=payload.legs,
        bust=payload.bust,
    )

    # Storefront shoppers are anonymous (no per-user history), but brand /
    # product / category calibration MUST still apply — pass "" not None.
    result = await calculate_size_recommendation(
        SizeEngineRequest(product=normalized_product, profile=profile),
        user_id="",
    )
    return success_response(message="Size recommendation completed.", data=result)
