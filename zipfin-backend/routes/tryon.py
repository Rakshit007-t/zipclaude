import logging

from fastapi import APIRouter, Depends, HTTPException, status

from core.api import success_response
from models.schema import (
    ApiResponse,
    TryOnImageRequest,
    TryOnImageResponse,
    TryOnJobCreateResponse,
    TryOnJobStatusResponse,
)
from services.firebase_auth import AuthenticatedUser, get_current_user, get_optional_user
from services.tryon_engine import process_tryon_request
from services.tryon_jobs import get_job, start_tryon_job

router = APIRouter(tags=["tryon"])
logger = logging.getLogger(__name__)


@router.post(
    "/tryon-image",
    response_model=ApiResponse[TryOnImageResponse],
    status_code=status.HTTP_200_OK,
)
async def tryon_image(
    payload: TryOnImageRequest,
    current_user: AuthenticatedUser = Depends(get_optional_user),
) -> ApiResponse[TryOnImageResponse]:
    try:
        if payload.user_id != current_user.uid:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "message": "user_id must match authenticated user.",
                    "details": {"code": "user_mismatch"},
                },
            )
        logger.info(
            "Processing try-on request: user_id=%s product_image_url=%s cloth_type=%s quality=%s",
            payload.user_id,
            payload.product_image_url,
            payload.cloth_type,
            payload.quality,
        )
        result = await process_tryon_request(
            user_id=payload.user_id,
            product_image_url=str(payload.product_image_url),
            cloth_type=payload.cloth_type,
            quality=payload.quality,
            person_image=payload.person_image,
            garment_image=payload.garment_image,
        )
        logger.info(
            "Try-on generation completed: user_id=%s tryon_image=%s",
            payload.user_id,
            result.tryon_image,
        )
        return success_response(
            message="Try-on image generated successfully.",
            data=result,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected try-on image route failure for user '%s'.", payload.user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate try-on image.",
        ) from exc


@router.post(
    "/tryon-job",
    response_model=ApiResponse[TryOnJobCreateResponse],
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_tryon_job(
    payload: TryOnImageRequest,
    current_user: AuthenticatedUser = Depends(get_optional_user),
) -> ApiResponse[TryOnJobCreateResponse]:
    """Start a try-on generation job that keeps running server-side even if
    the client disconnects (app minimized/closed)."""
    if payload.user_id != current_user.uid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "user_id must match authenticated user.",
                "details": {"code": "user_mismatch"},
            },
        )
    if not payload.garment_image and not payload.product_image_url.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide product_image_url or garment_image.",
        )
    job_id = start_tryon_job(
        user_id=payload.user_id,
        product_image_url=str(payload.product_image_url),
        cloth_type=payload.cloth_type,
        quality=payload.quality,
        person_image=payload.person_image,
        garment_image=payload.garment_image,
    )
    logger.info(
        "Started try-on job %s: user_id=%s cloth_type=%s quality=%s",
        job_id,
        payload.user_id,
        payload.cloth_type,
        payload.quality,
    )
    return success_response(
        message="Try-on job started.",
        data=TryOnJobCreateResponse(job_id=job_id),
    )


@router.get(
    "/tryon-job/{job_id}",
    response_model=ApiResponse[TryOnJobStatusResponse],
    status_code=status.HTTP_200_OK,
)
async def tryon_job_status(
    job_id: str,
    current_user: AuthenticatedUser = Depends(get_optional_user),
) -> ApiResponse[TryOnJobStatusResponse]:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Try-on job not found (it may have expired).",
        )
    if job.user_id != current_user.uid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This job belongs to another user.",
        )
    return success_response(
        message="Try-on job status.",
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
