from __future__ import annotations

import asyncio
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from core.api import error_response, success_response
from models.schema import ApiResponse, ExtractProductRequest, ExtractProductResponse
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.product_providers import get_provider_for_url, validate_product_url
from services.request_rate_limiter import enforce_rate_limit

router = APIRouter(tags=["product"])
logger = logging.getLogger(__name__)

RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_USER_MAX_REQUESTS = 20
RATE_LIMIT_IP_MAX_REQUESTS = 40
INVALID_TITLE_VALUES = {"", "product"}
INVALID_BRAND_VALUES = {""}
INVALID_CATEGORY_VALUES = {""}
EXTRACTION_ATTEMPTS = 3
EXTRACTION_TIMEOUT_SECONDS = 35.0


def _clean_text(value: str | None) -> str:
    return str(value or "").strip()


def _validated_product(
    extracted: ExtractProductResponse,
    normalized_url: str,
) -> ExtractProductResponse | None:
    title = _clean_text(extracted.title)
    brand = _clean_text(extracted.brand)
    category = _clean_text(extracted.category)
    image = _clean_text(extracted.image)
    url = _clean_text(extracted.url) or normalized_url

    if title.lower() in INVALID_TITLE_VALUES:
        return None
    if brand.lower() in INVALID_BRAND_VALUES:
        return None
    if category.lower() in INVALID_CATEGORY_VALUES:
        return None
    if not image:
        return None
    if not url:
        return None

    return extracted.model_copy(
        update={
            "title": title,
            "brand": brand,
            "category": category,
            "image": image,
            "url": url,
        }
    )


async def _fetch_product_with_retries(provider, normalized_url: str, requester_id: str) -> ExtractProductResponse:
    """Retry transient retailer/browser failures before surfacing an extraction error."""
    last_error: Exception | None = None
    for attempt in range(EXTRACTION_ATTEMPTS):
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(provider.fetch, normalized_url, requester_id),
                timeout=EXTRACTION_TIMEOUT_SECONDS,
            )
        except HTTPException as exc:
            # Invalid requests cannot recover, while provider 5xx responses can.
            if exc.status_code < 500 or attempt == EXTRACTION_ATTEMPTS - 1:
                raise
            last_error = exc
        except (asyncio.TimeoutError, OSError, RuntimeError) as exc:
            last_error = exc

        await asyncio.sleep(0.5 * (attempt + 1))

    raise HTTPException(
        status_code=status.HTTP_504_GATEWAY_TIMEOUT,
        detail="Product extraction is taking longer than expected. Please try again shortly.",
    ) from last_error


@router.post(
    "/extract-product",
    response_model=ApiResponse[ExtractProductResponse],
    status_code=status.HTTP_200_OK,
)
async def extract_product(
    payload: ExtractProductRequest,
    request: Request,
    response: Response,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[ExtractProductResponse]:
    client_ip = request.client.host if request.client else "unknown"
    request_id = request.headers.get("X-Request-Id", "").strip() or str(uuid4())
    response.headers["X-Request-Id"] = request_id

    try:
        normalized_url = validate_product_url(payload.url)
        enforce_rate_limit(
            key=f"extract:user:{current_user.uid}",
            max_requests=RATE_LIMIT_USER_MAX_REQUESTS,
            window_seconds=RATE_LIMIT_WINDOW_SECONDS,
            detail="Too many extraction requests for this user.",
        )
        enforce_rate_limit(
            key=f"extract:ip:{client_ip}",
            max_requests=RATE_LIMIT_IP_MAX_REQUESTS,
            window_seconds=RATE_LIMIT_WINDOW_SECONDS,
            detail="Too many extraction requests from this IP.",
        )

        provider = get_provider_for_url(normalized_url)
        extracted = await _fetch_product_with_retries(provider, normalized_url, current_user.uid)

        validated = _validated_product(extracted, normalized_url)
        if validated is None:
            return error_response(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"message": "Product extraction failed"},
            )
        logger.info(
            "extract-product audit request_id=%s user_id=%s ip=%s source=%s url=%s confidence=%.2f",
            request_id,
            current_user.uid,
            client_ip,
            validated.source,
            validated.url,
            validated.confidence,
        )

        return success_response(
            message="Product details extracted successfully.",
            data=validated,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "Invalid product extraction request.",
                "details": {"code": "invalid_request", "reason": str(exc)},
            },
        ) from exc
    except Exception as exc:
        logger.exception(
            "Unexpected product extraction failure request_id=%s user_id=%s ip=%s",
            request_id,
            current_user.uid,
            client_ip,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to extract product details.",
        ) from exc
