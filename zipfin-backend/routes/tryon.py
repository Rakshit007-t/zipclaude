import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status

from core.api import success_response
from models.schema import (
    ApiResponse,
    TryOnImageRequest,
    TryOnImageResponse,
    TryOnJobCreateResponse,
    TryOnJobStatusResponse,
)
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.request_rate_limiter import enforce_rate_limit
from services.tryon_access import consume_tryon_credit
from services.tryon_engine import process_tryon_request
from services.tryon_jobs import get_job, start_tryon_job

router = APIRouter(tags=["tryon"])
logger = logging.getLogger(__name__)


def log_tryon_event(user_id: str, product_image_url: str) -> None:
    try:
        from firebase_admin import firestore
        from firebase_config import get_firestore_client
        db = get_firestore_client()
        
        # Look up if this image belongs to a seller product
        snapshots = db.collection("seller_products").where("images", "array_contains", product_image_url).get()
        product = None
        for snap in snapshots:
            product = snap.to_dict()
            product["id"] = snap.id
            break
        
        event = {
            "user_id": user_id,
            "product_image_url": product_image_url,
            "timestamp": firestore.SERVER_TIMESTAMP,
        }
        if product:
            event["product_id"] = product["id"]
            event["seller_uid"] = product.get("seller_uid")
            event["brand"] = product.get("brand")
            
        db.collection("tryon_events").add(event)
    except Exception as exc:
        logger.warning("Failed to log tryon event: %s", exc)


@router.post(
    "/tryon-image",
    response_model=ApiResponse[TryOnImageResponse],
    status_code=status.HTTP_200_OK,
)
async def tryon_image(
    request: Request,
    payload: TryOnImageRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[TryOnImageResponse]:
    try:
        client_ip = request.client.host if request.client else "unknown"
        enforce_rate_limit(
            key=f"tryon-image:{current_user.uid}:{client_ip}",
            max_requests=10,
            window_seconds=60,
            detail="Rate limit exceeded for Virtual Try-On requests.",
        )
        if payload.user_id != current_user.uid:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "message": "user_id must match authenticated user.",
                    "details": {"code": "user_mismatch"},
                },
            )
        consume_tryon_credit(current_user)
        logger.info(
            "Processing try-on request: user_id=%s product_image_url=%s cloth_type=%s quality=%s",
            payload.user_id,
            payload.product_image_url,
            payload.cloth_type,
            payload.quality,
        )
        if payload.product_image_url:
            await asyncio.to_thread(log_tryon_event, payload.user_id, str(payload.product_image_url))
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
    request: Request,
    payload: TryOnImageRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
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
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"tryon-job:{current_user.uid}:{client_ip}",
        max_requests=10,
        window_seconds=60,
        detail="Rate limit exceeded for Virtual Try-On requests.",
    )
    # Reserve the free use / deduct the wallet before the background worker can
    # reach generate_vton_image().
    consume_tryon_credit(current_user)
    if payload.product_image_url:
        await asyncio.to_thread(log_tryon_event, payload.user_id, str(payload.product_image_url))
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
    current_user: AuthenticatedUser = Depends(get_current_user),
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
