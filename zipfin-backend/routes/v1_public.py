import asyncio
import logging
from typing import Any, Literal
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from core.api import error_response, success_response
from core.api_key_auth import AuthenticatedApiKey, verify_api_key
from models.schema import (
    ApiResponse,
    NormalizedProduct,
    PredictSizeMeasurements,
    SmartFitScanMeasurements,
    TryOnJobStatusResponse,
)
from services.measurement_service import (
    MeasurementProcessingError,
    estimate_measurements_from_scan,
)
from services.size_engine import (
    build_profile_from_body_metrics,
    calculate_size_recommendation,
)
from services.tryon_engine import process_tryon_request
from services.tryon_jobs import get_job, start_tryon_job

router = APIRouter(prefix="/v1", tags=["public_v1"])
logger = logging.getLogger(__name__)


# ── Schemas for Public V1 Endpoints ───────────────────────────────────────────

class V1TryOnRequest(BaseModel):
    person_image: str | None = Field(
        default=None,
        max_length=15_000_000,
        description="Base64 data URL or public URL of person photo",
    )
    garment_image: str | None = Field(
        default=None,
        max_length=15_000_000,
        description="Base64 data URL or public URL of garment photo",
    )
    product_image_url: str | None = Field(
        default=None,
        max_length=2048,
        description="URL of garment product image",
    )
    cloth_type: Literal["upper_body", "lower_body", "dress", "auto"] = Field(
        default="auto", description="Garment type classification"
    )
    quality: Literal["fast", "hd", "2k"] = Field(
        default="hd", description="Output rendering quality"
    )
    async_job: bool = Field(
        default=False,
        description="Set to true for async non-blocking queue execution",
    )


class V1TryOnResponse(BaseModel):
    job_id: str | None = None
    tryon_image: str | None = None
    engine: str | None = None
    status: Literal["completed", "queued"] = "completed"


class V1FitProfileRequest(BaseModel):
    height: float = Field(..., gt=0, le=300, description="Person height in cm")
    front_image: str = Field(
        ...,
        min_length=10,
        description="Base64 data URL of front full-body photo",
    )
    side_image: str = Field(
        ...,
        min_length=10,
        description="Base64 data URL of side full-body photo",
    )


class V1FitProfileResponse(BaseModel):
    is_valid: bool
    message: str
    measurements: SmartFitScanMeasurements | None = None


class V1SizeRecommendationRequest(BaseModel):
    product: NormalizedProduct = Field(..., description="Target product payload")
    height: float = Field(..., gt=0, le=300, description="Person height in cm")
    measurements: PredictSizeMeasurements | None = None
    base_size: Literal["XS", "S", "M", "L", "XL", "XXL"] | None = Field(
        default=None, description="Current typical base size"
    )
    fit_preference: Literal["slim", "regular", "relaxed", "loose", "baggy"] = Field(
        default="regular", description="Fit tightness preference"
    )


class V1SizeRecommendationResponse(BaseModel):
    size: str
    confidence: float
    risk: str | None = None
    reason: str | None = None


# ── Public V1 Endpoints ───────────────────────────────────────────────────────

@router.post(
    "/try-on",
    response_model=ApiResponse[V1TryOnResponse],
    status_code=status.HTTP_200_OK,
)
async def public_v1_tryon(
    payload: V1TryOnRequest,
    api_key: AuthenticatedApiKey = Depends(verify_api_key),
) -> ApiResponse[V1TryOnResponse]:
    """Generate virtual try-on image or queue an asynchronous job using API Key."""
    garment_src = payload.garment_image or (payload.product_image_url or "").strip()
    if not garment_src:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "Must provide either 'garment_image' or 'product_image_url'.",
                "details": {"code": "missing_garment"},
            },
        )

    logger.info(
        "Public V1 Try-On: api_key_id=%s user_id=%s async=%s cloth_type=%s",
        api_key.key_id,
        api_key.user_id,
        payload.async_job,
        payload.cloth_type,
    )

    if payload.async_job:
        job_id = start_tryon_job(
            user_id=api_key.user_id,
            product_image_url=str(payload.product_image_url or ""),
            cloth_type=payload.cloth_type,
            quality=payload.quality,
            person_image=payload.person_image,
            garment_image=payload.garment_image,
        )
        return success_response(
            message="Try-on job queued successfully.",
            data=V1TryOnResponse(job_id=job_id, status="queued"),
        )
    else:
        try:
            result = await process_tryon_request(
                user_id=api_key.user_id,
                product_image_url=str(payload.product_image_url or ""),
                cloth_type=payload.cloth_type,
                quality=payload.quality,
                person_image=payload.person_image,
                garment_image=payload.garment_image,
            )
            return success_response(
                message="Try-on completed successfully.",
                data=V1TryOnResponse(
                    tryon_image=result.tryon_image,
                    engine=result.engine,
                    status="completed",
                ),
            )
        except Exception as exc:
            logger.exception("Failed to process public try-on request.")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Try-on generation failed.",
            ) from exc


@router.post(
    "/fit-profile",
    response_model=ApiResponse[V1FitProfileResponse],
    status_code=status.HTTP_200_OK,
)
async def public_v1_fit_profile(
    payload: V1FitProfileRequest,
    api_key: AuthenticatedApiKey = Depends(verify_api_key),
) -> ApiResponse[V1FitProfileResponse]:
    """Estimate precision body measurements from front and side photos using API Key."""
    logger.info(
        "Public V1 Fit Profile: api_key_id=%s user_id=%s height=%.2f",
        api_key.key_id,
        api_key.user_id,
        payload.height,
    )

    try:
        result = await asyncio.to_thread(
            estimate_measurements_from_scan,
            front_image_base64=payload.front_image,
            side_image_base64=payload.side_image,
            height_cm=payload.height,
        )

        return success_response(
            message=result.message or "Fit profile computed successfully.",
            data=V1FitProfileResponse(
                is_valid=result.is_valid,
                message=result.message or "Success",
                measurements=result.measurements,
            ),
        )
    except MeasurementProcessingError as exc:
        return error_response(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": str(exc) or "Failed to analyze photos."},
        )
    except Exception as exc:
        logger.exception("Failed to process public fit profile.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Fit profile estimation failed.",
        ) from exc


@router.post(
    "/size-recommendation",
    response_model=ApiResponse[V1SizeRecommendationResponse],
    status_code=status.HTTP_200_OK,
)
async def public_v1_size_recommendation(
    payload: V1SizeRecommendationRequest,
    api_key: AuthenticatedApiKey = Depends(verify_api_key),
) -> ApiResponse[V1SizeRecommendationResponse]:
    """Calculate AI size recommendation for a product using API Key."""
    logger.info(
        "Public V1 Size Recommendation: api_key_id=%s product=%s height=%.2f",
        api_key.key_id,
        payload.product.title,
        payload.height,
    )

    try:
        profile = build_profile_from_body_metrics(
            payload.height,
            payload.measurements,
            payload.fit_preference,
            payload.base_size,
        )

        from models.schema import SizeEngineRequest
        result = await calculate_size_recommendation(
            SizeEngineRequest(product=payload.product, profile=profile),
            user_id=api_key.user_id,
        )

        return success_response(
            message="Size recommendation computed successfully.",
            data=V1SizeRecommendationResponse(
                size=result.size,
                confidence=round(result.confidence, 2),
                risk=result.risk,
                reason=result.reason,
            ),
        )
    except ValueError as exc:
        return error_response(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": str(exc) or "Insufficient sizing data."},
        )
    except Exception as exc:
        logger.exception("Failed to calculate public size recommendation.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Size recommendation calculation failed.",
        ) from exc


@router.get(
    "/jobs/{job_id}",
    response_model=ApiResponse[TryOnJobStatusResponse],
    status_code=status.HTTP_200_OK,
)
async def public_v1_job_status(
    job_id: str,
    api_key: AuthenticatedApiKey = Depends(verify_api_key),
) -> ApiResponse[TryOnJobStatusResponse]:
    """Query status and result of an async try-on job using API Key."""
    job = get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "message": "Job ID not found or expired.",
                "details": {"code": "job_not_found"},
            },
        )

    if job.user_id != api_key.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "Not authorized to access this job.",
                "details": {"code": "job_forbidden"},
            },
        )

    return success_response(
        message="Job status retrieved successfully.",
        data=TryOnJobStatusResponse(
            job_id=job.job_id,
            status=job.status,  # type: ignore[arg-type]
            progress=job.progress,
            stage=job.stage,
            engine=job.engine,
            tryon_image=job.result_url,
            error=job.error,
        ),
    )


@router.get(
    "/health",
    response_model=ApiResponse[dict[str, Any]],
    status_code=status.HTTP_200_OK,
)
async def public_v1_health() -> ApiResponse[dict[str, Any]]:
    """Public API health check (no API Key required)."""
    return success_response(
        message="ZipRIGHT Public API v1 operational.",
        data={
            "status": "online",
            "version": "1.0.0",
            "api_version": "v1",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
