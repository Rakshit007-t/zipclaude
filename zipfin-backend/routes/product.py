import logging

from fastapi import APIRouter, HTTPException, Request, status

from core.api import success_response
from models.schema import ApiResponse, ExtractProductRequest, ExtractProductResponse, RecentScansResponse
from services.product_extractor import extract_product_details
from services.recent_scans import store_scan, get_recent_scans

router = APIRouter(tags=["product"])
logger = logging.getLogger(__name__)


@router.post(
    "/extract-product",
    response_model=ApiResponse[ExtractProductResponse],
    status_code=status.HTTP_200_OK,
)
async def extract_product(
    payload: ExtractProductRequest,
    request: Request,
) -> ApiResponse[ExtractProductResponse]:
    client_host = request.client.host if request.client else "unknown"
    try:
        logger.info(
            "Received product extraction request from client=%s url=%s",
            client_host,
            payload.url,
        )
        result = extract_product_details(str(payload.url), requester_id=client_host)
        
        # Store to recent scans
        store_scan(
            url=str(payload.url),
            title=result.title,
            brand=result.brand,
            image=result.image
        )
        
        return success_response(
            message="Product details extracted successfully.",
            data=result,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected product extraction failure for client=%s.", client_host)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to extract product details.",
        ) from exc

@router.get(
    "/recent-scans",
    response_model=ApiResponse[RecentScansResponse],
    status_code=status.HTTP_200_OK,
)
async def fetch_recent_scans():
    try:
        scans = get_recent_scans()
        return success_response(
            message="Recent scans fetched successfully.",
            data=RecentScansResponse(scans=scans)
        )
    except Exception as exc:
        logger.exception("Failed to fetch recent scans.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch recent scans."
        ) from exc
