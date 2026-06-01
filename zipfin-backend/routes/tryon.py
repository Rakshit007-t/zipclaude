import logging

from fastapi import APIRouter, Depends, HTTPException, status

from core.api import success_response
from models.schema import ApiResponse, TryOnImageRequest, TryOnImageResponse
from services.firebase_auth import AuthenticatedUser, get_current_user, get_optional_user
from services.tryon_engine import process_tryon_request

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
            "Processing try-on request: user_id=%s product_image_url=%s",
            payload.user_id,
            payload.product_image_url,
        )
        result = await process_tryon_request(
            user_id=payload.user_id,
            product_image_url=str(payload.product_image_url),
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
