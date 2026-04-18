import logging

from fastapi import APIRouter, HTTPException, status

from core.api import success_response
from models.schema import ApiResponse, SizeEngineRequest, SizeEngineResponse
from services.size_engine import calculate_size_recommendation

router = APIRouter(tags=["size"])
logger = logging.getLogger(__name__)


@router.post(
    "/size-engine",
    response_model=ApiResponse[SizeEngineResponse],
    status_code=status.HTTP_200_OK,
)
async def size_engine(payload: SizeEngineRequest) -> ApiResponse[SizeEngineResponse]:
    try:
        logger.info(
            "Processing size recommendation request: chest=%s waist_cm=%s hip_cm=%s fit=%s brand=%s range=%s",
            payload.chest,
            payload.waist_cm,
            payload.hip_cm,
            payload.fit,
            payload.brand,
            payload.range,
        )
        result = calculate_size_recommendation(payload)
        logger.info(
            "Size recommendation completed: size=%s confidence=%s risk=%s",
            result.size,
            result.confidence,
            result.risk,
        )
        return success_response(
            message="Size recommendation calculated successfully.",
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
        logger.exception("Unexpected size engine route failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to calculate size recommendation.",
        ) from exc
