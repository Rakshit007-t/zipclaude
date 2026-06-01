import asyncio
import json
import logging

from firebase_admin import firestore as firebase_firestore
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import ValidationError

from core.api import error_response, success_response
from firebase_config import initialize_firebase
from models.schema import (
    ApiResponse,
    PredictSizeRequest,
    PredictSizeResponse,
    SmartFitScanRequest,
    SmartFitScanResponse,
    SizeEngineRequest,
    SizeEngineResponse,
)
from services.firebase_auth import AuthenticatedUser, get_current_user, get_optional_user
from services.measurement_service import (
    MeasurementProcessingError,
    estimate_measurements_from_scan,
)
from services.size_engine import (
    build_profile_from_body_metrics,
    calculate_size_recommendation,
)

router = APIRouter(tags=["size"])
logger = logging.getLogger(__name__)
INVALID_SCAN_MESSAGE = "Stand straight, full body visible, good lighting"


def _invalid_scan_response(message: str = INVALID_SCAN_MESSAGE) -> ApiResponse[SmartFitScanResponse]:
    return success_response(
        message=message,
        data=SmartFitScanResponse(
            is_valid=False,
            message=message,
            measurements=None,
        ),
    )


def _get_previous_smartfit(uid: str) -> dict[str, float] | None:
    try:
        initialize_firebase()
        client = firebase_firestore.client()
        snapshot = client.collection("users").document(uid).get()
    except Exception as exc:
        logger.warning("Unable to load previous smartFit scan. user_id=%s reason=%s", uid, exc)
        return None

    if not snapshot.exists:
        return None

    payload = snapshot.to_dict() or {}
    smart_fit = payload.get("smartFit")
    if not isinstance(smart_fit, dict):
        return None

    previous_measurements: dict[str, float] = {}
    for key in ("chest", "waist", "hips"):
        value = smart_fit.get(key)
        if isinstance(value, (int, float)) and value > 0:
            previous_measurements[key] = float(value)

    return previous_measurements or None


@router.post(
    "/size-engine",
    response_model=ApiResponse[SizeEngineResponse],
    status_code=status.HTTP_200_OK,
)
async def size_engine(
    payload: SizeEngineRequest,
    current_user: AuthenticatedUser = Depends(get_optional_user),
) -> ApiResponse[SizeEngineResponse]:
    try:
        logger.info(
            "Processing size recommendation request: user_id=%s product_id=%s source=%s",
            current_user.uid,
            payload.product.id,
            payload.product.source,
        )
        result = await calculate_size_recommendation(payload)
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
        return error_response(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": str(exc) or "Insufficient data"},
        )
    except Exception as exc:
        logger.exception("Unexpected size engine route failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to calculate size recommendation.",
        ) from exc


@router.post(
    "/predict-size",
    response_model=ApiResponse[PredictSizeResponse],
    status_code=status.HTTP_200_OK,
)
async def predict_size(
    payload: PredictSizeRequest,
    current_user: AuthenticatedUser = Depends(get_optional_user),
) -> ApiResponse[PredictSizeResponse]:
    try:
        if payload.product is None:
            return error_response(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"message": "Insufficient data"},
            )

        profile = build_profile_from_body_metrics(
            payload.height,
            payload.measurements,
            payload.fit_preference,
            payload.base_size,
        )

        logger.info(
            "Predict size request: user_id=%s url=%s height=%s",
            current_user.uid,
            payload.product.url,
            payload.height,
        )

        result = await calculate_size_recommendation(
            SizeEngineRequest(product=payload.product, profile=profile)
        )

        return success_response(
            message="Size predicted successfully.",
            data=PredictSizeResponse(
                size=result.size,
                confidence=round(result.confidence / 100, 2),
                risk=result.risk,
                reason=result.reason,
            ),
        )
    except HTTPException:
        raise
    except ValueError as exc:
        return error_response(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": str(exc) or "Insufficient data"},
        )
    except Exception as exc:
        logger.exception("Unexpected predict-size route failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to predict size.",
        ) from exc


@router.post(
    "/smart-fit/measurements",
    response_model=ApiResponse[SmartFitScanResponse],
    status_code=status.HTTP_200_OK,
)
async def smart_fit_measurements(
    request: Request,
    current_user: AuthenticatedUser = Depends(get_optional_user),
) -> ApiResponse[SmartFitScanResponse]:
    try:
        raw_body = await request.body()
        raw_body_text = raw_body.decode("utf-8", errors="replace")

        try:
            body = json.loads(raw_body_text) if raw_body_text else {}
        except json.JSONDecodeError:
            return _invalid_scan_response()

        if not isinstance(body, dict):
            return _invalid_scan_response()

        payload = SmartFitScanRequest.model_validate(body)
        if payload.height is None or payload.height <= 0:
            return _invalid_scan_response()
        if not payload.front_image or not payload.side_image:
            return _invalid_scan_response()

        logger.info(
            "Smart fit measurement request: user_id=%s height=%.2f",
            current_user.uid,
            payload.height,
        )
        previous_measurements = await asyncio.to_thread(_get_previous_smartfit, current_user.uid)
        result = await asyncio.to_thread(
            estimate_measurements_from_scan,
            front_image_base64=payload.front_image,
            side_image_base64=payload.side_image,
            height_cm=payload.height,
            previous_measurements=previous_measurements,
        )
        return success_response(
            message=result.message or ("Measurements calculated successfully." if result.is_valid else INVALID_SCAN_MESSAGE),
            data=result,
        )
    except ValidationError:
        return _invalid_scan_response()
    except MeasurementProcessingError as exc:
        logger.warning(
            "Smart fit processing failed. user_id=%s reason=%s",
            current_user.uid,
            exc,
        )
        return _invalid_scan_response(str(exc) or INVALID_SCAN_MESSAGE)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Unexpected smart-fit measurement failure.")
        return _invalid_scan_response()
