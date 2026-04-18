import logging
import math
import sqlite3
from threading import Lock

from fastapi import HTTPException, status
from pydantic import ValidationError

from models.schema import (
    GarmentCreateRequest,
    GarmentResponse,
    GarmentTransform,
    LiveTryOnFrameRequest,
    LiveTryOnFrameResponse,
    LiveTryOnSessionCreateRequest,
    LiveTryOnSessionResponse,
)
from services.tryon_live_store import (
    create_garment_record,
    create_session_record,
    get_garment_record,
    get_session_record,
    list_garment_records,
)

logger = logging.getLogger(__name__)

REQUIRED_LANDMARKS = (
    "left_shoulder",
    "right_shoulder",
)
OPTIONAL_LANDMARKS = (
    "left_hip",
    "right_hip",
)
PREFERRED_LANDMARKS = [
    "left_shoulder",
    "right_shoulder",
    "left_hip",
    "right_hip",
    "nose",
]
VISIBILITY_THRESHOLD = 0.45
_SESSION_TRANSFORM_CACHE: dict[str, dict] = {}
_SESSION_CACHE_LOCK = Lock()


def register_garment(payload: GarmentCreateRequest) -> GarmentResponse:
    try:
        record = create_garment_record(payload.model_dump(mode="json"))
    except sqlite3.IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Garment with sku '{payload.sku}' already exists.",
        ) from exc
    except sqlite3.DatabaseError as exc:
        logger.exception("Failed to create garment '%s'.", payload.sku)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create garment record.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected garment creation failure for '%s'.", payload.sku)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create garment record.",
        ) from exc
    return _validate_garment_response(record)


def list_garments() -> list[GarmentResponse]:
    try:
        records = list_garment_records()
        return [_validate_garment_response(record) for record in records]
    except HTTPException:
        raise
    except sqlite3.DatabaseError as exc:
        logger.exception("Failed to list garments.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load garments.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected garment listing failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load garments.",
        ) from exc


def create_live_tryon_session(
    payload: LiveTryOnSessionCreateRequest,
) -> LiveTryOnSessionResponse:
    garment_record = _fetch_garment_record(
        payload.garment_id,
        not_found_detail=f"Garment '{payload.garment_id}' was not found.",
    )

    try:
        session_record = create_session_record(payload.model_dump())
    except sqlite3.DatabaseError as exc:
        logger.exception(
            "Failed to create live try-on session for user '%s' and garment '%s'.",
            payload.user_id,
            payload.garment_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create live try-on session.",
        ) from exc
    except Exception as exc:
        logger.exception(
            "Unexpected session creation failure for user '%s' and garment '%s'.",
            payload.user_id,
            payload.garment_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create live try-on session.",
        ) from exc

    try:
        garment = _validate_garment_response(garment_record)
        return LiveTryOnSessionResponse(
            session_id=session_record["session_id"],
            user_id=session_record["user_id"],
            garment=garment,
            render_mode="client_ar_overlay",
            tracking_target="upper_body",
            recommended_landmarks=PREFERRED_LANDMARKS,
            websocket_path=f"/tryon-live/ws/{session_record['session_id']}",
            created_at=session_record["created_at"],
        )
    except ValidationError as exc:
        logger.exception("Invalid live try-on session response generated for '%s'.", payload.user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Generated live try-on session is invalid.",
        ) from exc


def estimate_live_tryon_frame(
    payload: LiveTryOnFrameRequest,
) -> LiveTryOnFrameResponse:
    session_record = _fetch_session_record(
        payload.session_id,
        not_found_detail=f"Session '{payload.session_id}' was not found.",
    )
    garment_record = _fetch_garment_record(
        session_record["garment_id"],
        not_found_detail=f"Garment '{session_record['garment_id']}' was not found.",
    )

    try:
        transform = _build_transform(
            frame_width=payload.frame_width,
            frame_height=payload.frame_height,
            landmarks=payload.landmarks,
            garment_record=garment_record,
            previous_transform=_get_previous_transform(payload.session_id, session_record),
        )
    except ValidationError as exc:
        logger.exception("Invalid transform generated for session '%s'.", payload.session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to build garment transform.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected frame estimation failure for session '%s'.", payload.session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to estimate live try-on frame.",
        ) from exc

    if transform is None:
        return LiveTryOnFrameResponse(
            session_id=payload.session_id,
            garment_id=garment_record["garment_id"],
            tracking_status="lost",
            missing_landmarks=_missing_landmarks(payload.landmarks),
            transform=None,
        )

    _cache_transform(payload.session_id, transform.model_dump())
    missing_landmarks = _missing_landmarks(payload.landmarks)
    tracking_status = "tracked" if not missing_landmarks else "partial"

    return LiveTryOnFrameResponse(
        session_id=payload.session_id,
        garment_id=garment_record["garment_id"],
        tracking_status=tracking_status,
        missing_landmarks=missing_landmarks,
        transform=transform,
    )


def _build_transform(
    *,
    frame_width: int,
    frame_height: int,
    landmarks: dict,
    garment_record: dict,
    previous_transform: dict | None,
) -> GarmentTransform | None:
    if _missing_required_landmarks(landmarks):
        return None

    left_shoulder = landmarks["left_shoulder"]
    right_shoulder = landmarks["right_shoulder"]
    left_hip = landmarks.get("left_hip")
    right_hip = landmarks.get("right_hip")

    shoulder_center_x = (left_shoulder.x + right_shoulder.x) / 2
    shoulder_center_y = (left_shoulder.y + right_shoulder.y) / 2

    shoulder_width = _distance(left_shoulder.x, left_shoulder.y, right_shoulder.x, right_shoulder.y)
    if shoulder_width <= 0:
        return None

    optional_missing = _missing_optional_landmarks(landmarks)
    if optional_missing:
        torso_height = shoulder_width * 1.45
        hip_center_x = shoulder_center_x
        hip_center_y = shoulder_center_y + torso_height
        z_samples = [left_shoulder.z, right_shoulder.z]
        confidence_samples = [left_shoulder.visibility, right_shoulder.visibility]
    else:
        hip_center_x = (left_hip.x + right_hip.x) / 2
        hip_center_y = (left_hip.y + right_hip.y) / 2
        torso_height = _distance(
            shoulder_center_x,
            shoulder_center_y,
            hip_center_x,
            hip_center_y,
        )
        z_samples = [left_shoulder.z, right_shoulder.z, left_hip.z, right_hip.z]
        confidence_samples = [
            left_shoulder.visibility,
            right_shoulder.visibility,
            left_hip.visibility,
            right_hip.visibility,
        ]

    if torso_height <= 0:
        return None

    anchor_profile = garment_record["anchor_profile"]
    scale_multiplier = garment_record["scale_multiplier"]

    raw_anchor_x = shoulder_center_x
    raw_anchor_y = shoulder_center_y + (torso_height * anchor_profile["y_offset"])
    raw_anchor_z = (sum(z_samples) / len(z_samples)) + anchor_profile["z_offset"]
    raw_width_px = shoulder_width * frame_width * anchor_profile["width_scale"] * scale_multiplier
    raw_height_px = torso_height * frame_height * anchor_profile["height_scale"] * scale_multiplier
    raw_rotation = math.degrees(
        math.atan2(
            right_shoulder.y - left_shoulder.y,
            right_shoulder.x - left_shoulder.x,
        )
    )
    raw_confidence = min(confidence_samples)

    current_transform = {
        "anchor_x": _clamp(raw_anchor_x, 0.0, 1.0),
        "anchor_y": _clamp(raw_anchor_y, 0.0, 1.0),
        "anchor_z": raw_anchor_z,
        "width_px": raw_width_px,
        "height_px": raw_height_px,
        "rotation_degrees": raw_rotation,
        "confidence": raw_confidence,
    }
    smoothed_transform = _smooth_transform(
        previous_transform=previous_transform,
        current_transform=current_transform,
        smoothing=anchor_profile["smoothing"],
    )
    return GarmentTransform.model_validate(smoothed_transform)


def _missing_required_landmarks(landmarks: dict) -> list[str]:
    missing = []
    for name in REQUIRED_LANDMARKS:
        landmark = landmarks.get(name)
        if landmark is None or landmark.visibility < VISIBILITY_THRESHOLD:
            missing.append(name)
    return missing


def _missing_optional_landmarks(landmarks: dict) -> list[str]:
    missing = []
    for name in OPTIONAL_LANDMARKS:
        landmark = landmarks.get(name)
        if landmark is None or landmark.visibility < VISIBILITY_THRESHOLD:
            missing.append(name)
    return missing


def _missing_landmarks(landmarks: dict) -> list[str]:
    return _missing_required_landmarks(landmarks) + _missing_optional_landmarks(landmarks)


def _distance(ax: float, ay: float, bx: float, by: float) -> float:
    return math.hypot(bx - ax, by - ay)


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(value, maximum))


def _smooth_transform(
    *,
    previous_transform: dict | None,
    current_transform: dict,
    smoothing: float,
) -> dict:
    if not previous_transform:
        return current_transform

    alpha = max(0.0, min(1.0, 1.0 - smoothing))
    return {
        key: (alpha * current_transform[key]) + ((1.0 - alpha) * previous_transform[key])
        for key in current_transform
    }


def _get_previous_transform(session_id: str, session_record: dict) -> dict | None:
    with _SESSION_CACHE_LOCK:
        cached_transform = _SESSION_TRANSFORM_CACHE.get(session_id)
    if cached_transform is not None:
        return cached_transform
    return session_record.get("last_transform")


def _cache_transform(session_id: str, transform: dict) -> None:
    with _SESSION_CACHE_LOCK:
        _SESSION_TRANSFORM_CACHE[session_id] = transform


def _fetch_garment_record(garment_id: str, *, not_found_detail: str) -> dict:
    try:
        record = get_garment_record(garment_id)
    except sqlite3.DatabaseError as exc:
        logger.exception("Failed to load garment '%s'.", garment_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load garment.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected garment lookup failure for '%s'.", garment_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load garment.",
        ) from exc

    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=not_found_detail,
        )
    return record


def _fetch_session_record(session_id: str, *, not_found_detail: str) -> dict:
    try:
        record = get_session_record(session_id)
    except sqlite3.DatabaseError as exc:
        logger.exception("Failed to load live try-on session '%s'.", session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load live try-on session.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected session lookup failure for '%s'.", session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load live try-on session.",
        ) from exc

    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=not_found_detail,
        )
    return record


def _validate_garment_response(record: dict) -> GarmentResponse:
    try:
        return GarmentResponse.model_validate(record)
    except ValidationError as exc:
        logger.exception(
            "Invalid garment response generated for garment '%s'.",
            record.get("garment_id", "<unknown>"),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Generated garment response is invalid.",
        ) from exc
