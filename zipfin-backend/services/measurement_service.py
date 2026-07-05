from __future__ import annotations

import base64
import logging
import math
from pathlib import Path
from threading import Lock
from typing import Iterable
from urllib.request import urlretrieve

import cv2
import numpy as np
from google.protobuf import message_factory, symbol_database


def _ensure_protobuf_compatibility() -> None:
    if hasattr(symbol_database.SymbolDatabase, "GetPrototype"):
        symbol_database_ready = True
    else:
        symbol_database_ready = False

    def _get_prototype(_, descriptor):
        return message_factory.GetMessageClass(descriptor)

    if not symbol_database_ready:
        symbol_database.SymbolDatabase.GetPrototype = _get_prototype
    if not hasattr(message_factory.MessageFactory, "GetPrototype"):
        message_factory.MessageFactory.GetPrototype = _get_prototype


_ensure_protobuf_compatibility()

import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision

from models.schema import SmartFitScanMeasurements, SmartFitScanResponse

logger = logging.getLogger(__name__)
MP_SOLUTIONS = getattr(mp, "solutions", None)
POSE = getattr(MP_SOLUTIONS, "pose", None) if MP_SOLUTIONS is not None else None
SELFIE_SEGMENTATION = (
    getattr(MP_SOLUTIONS, "selfie_segmentation", None) if MP_SOLUTIONS is not None else None
)
MODEL_STORAGE_DIR = Path(__file__).resolve().parents[1] / "storage" / "mediapipe_models"
POSE_LANDMARKER_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_full/float16/1/pose_landmarker_full.task"
)
IMAGE_SEGMENTER_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/"
    "selfie_segmenter/float16/latest/selfie_segmenter.tflite"
)
POSE_LANDMARKER_MODEL_PATH = MODEL_STORAGE_DIR / "pose_landmarker_full.task"
IMAGE_SEGMENTER_MODEL_PATH = MODEL_STORAGE_DIR / "selfie_segmenter.tflite"
_TASK_MODEL_LOCK = Lock()
_POSE_TASK_LOCK = Lock()
_SEGMENTER_TASK_LOCK = Lock()
_POSE_TASK = None
_SEGMENTER_TASK = None
HEAD_LANDMARKS = tuple(range(0, 9))
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_ELBOW = 13
RIGHT_ELBOW = 14
LEFT_WRIST = 15
RIGHT_WRIST = 16
LEFT_HIP = 23
RIGHT_HIP = 24
LEFT_KNEE = 25
RIGHT_KNEE = 26
LEFT_ANKLE = 27
RIGHT_ANKLE = 28
LEFT_HEEL = 29
RIGHT_HEEL = 30
VISIBILITY_THRESHOLD = 0.35
MIN_CORE_VISIBILITY = 0.25
MIN_ANKLE_VISIBILITY = 0.35
MIN_SILHOUETTE_FRAME_RATIO = 0.04
MIN_PIXEL_HEIGHT = 200.0
MIN_CONTRAST_STDDEV = 18.0
MAX_BODY_TILT_DEGREES = 35.0
MAX_HEIGHT_DELTA_RATIO = 0.18
ROW_SMOOTHING_OFFSETS = (-2, 0, 2)
APPROXIMATE_CONFIDENCE_THRESHOLD = 0.18
SCAN_FAILURE_MESSAGE = "Stand straight with full body visible"
INVALID_SCAN_MESSAGE = "No person detected or invalid pose"
LOW_CONFIDENCE_MESSAGE = "Slightly approximate — improve posture for better accuracy"
LOW_LIGHTING_MESSAGE = "Low lighting — accuracy slightly reduced"
CROPPED_FEET_MESSAGE = "Approximate scan — adjust framing for higher accuracy"
SCAN_MEASUREMENT_RANGES: dict[str, tuple[float, float]] = {
    "chest": (60.0, 160.0),
    "waist": (50.0, 150.0),
    "shoulders": (30.0, 70.0),
}
# Tape-measure anchor from the reported real scan:
# chest 96 cm, shoulders 47 cm, waist 88 cm, arms 53 cm, legs 84 cm.
# These are used as calibration ratios, not as returned dummy values.
REPORTED_REAL_MEASUREMENTS_CM = {
    "chest": 96.0,
    "shoulders": 47.0,
    "waist": 88.0,
    "arms": 53.0,
    "legs": 84.0,
}
LEGACY_SCAN_OUTPUT_CM = {
    "chest": 135.6,
    "waist": 136.2,
    "shoulders": 40.3,
    "arms": 55.0,
    "legs": 78.3,
}
CURRENT_SCAN_OUTPUT_CM = {
    "chest": 98.8,
    "waist": 90.9,
    "shoulders": 48.5,
    "arms": 51.4,
    "legs": 85.9,
}
CURRENT_REAL_MEASUREMENTS_CM = {
    "chest": 90.0,
    "shoulders": 46.0,
    "waist": 76.0,
    "arms": 53.0,
    "legs": 89.5,
}
CHEST_TO_SHOULDER_RATIO = (
    REPORTED_REAL_MEASUREMENTS_CM["chest"] / REPORTED_REAL_MEASUREMENTS_CM["shoulders"]
)
WAIST_TO_SHOULDER_RATIO = (
    REPORTED_REAL_MEASUREMENTS_CM["waist"] / REPORTED_REAL_MEASUREMENTS_CM["shoulders"]
)
HIP_TO_SHOULDER_RATIO = 2.02
SHOULDER_SILHOUETTE_TO_TAPE_SCALE = (
    REPORTED_REAL_MEASUREMENTS_CM["shoulders"] / LEGACY_SCAN_OUTPUT_CM["shoulders"]
)
ARM_LENGTH_SCALE = REPORTED_REAL_MEASUREMENTS_CM["arms"] / LEGACY_SCAN_OUTPUT_CM["arms"]
LEG_LENGTH_SCALE = REPORTED_REAL_MEASUREMENTS_CM["legs"] / LEGACY_SCAN_OUTPUT_CM["legs"]
CHEST_OUTPUT_CALIBRATION = 0.963
WAIST_OUTPUT_CALIBRATION = 0.961
HIP_OUTPUT_CALIBRATION = 0.98
CHEST_RATIO_CALIBRATION = (0.5066, 0.7717, 1.92, 2.25)
WAIST_RATIO_CALIBRATION = (0.4628, 0.6527, 1.62, 2.05)
HIP_RATIO_CALIBRATION = (0.35, 1.05, 1.55, 2.25)
ARM_LENGTH_CALIBRATION = (1.0, 0.0)
LEG_LENGTH_CALIBRATION = (0.6187, 39.9581)
MIN_USABLE_DEPTH_TO_WIDTH_RATIO = 0.35
MIN_USABLE_DEPTH_TO_SHOULDER_RATIO = 0.32
CHEST_MAX_DEPTH_TO_SHOULDER_RATIO = 0.78
WAIST_MAX_DEPTH_TO_SHOULDER_RATIO = 0.76
HIP_MAX_DEPTH_TO_SHOULDER_RATIO = 0.86
DIRECT_CIRCUMFERENCE_RATIO_LIMITS = {
    "chest": (1.75, 2.75),
    "waist": (1.35, 2.70),
}
DIRECT_CIRCUMFERENCE_WEIGHT_THRESHOLDS = {
    "chest": ((0.795, 0.900), (2.30, 2.45)),
    "waist": ((0.730, 0.805), (2.20, 2.32)),
}
PREVIOUS_SCAN_JITTER_CM = 3.0
PREVIOUS_SCAN_MAX_BLEND_CM = 6.0
PREVIOUS_SCAN_MAX_BLEND_RATIO = 0.08
PREVIOUS_SCAN_BLEND_WEIGHT = 0.20
KEY_VISIBILITY_LANDMARKS = (
    LEFT_SHOULDER,
    RIGHT_SHOULDER,
    LEFT_HIP,
    RIGHT_HIP,
    LEFT_ANKLE,
    RIGHT_ANKLE,
    LEFT_HEEL,
    RIGHT_HEEL,
)


class MeasurementProcessingError(ValueError):
    pass


class _SyntheticLandmark:
    def __init__(self, x: float, y: float, *, visibility: float = 0.85) -> None:
        self.x = x
        self.y = y
        self.z = 0.0
        self.visibility = visibility


class _TaskLandmark:
    def __init__(self, landmark) -> None:
        self.x = float(getattr(landmark, "x", 0.0))
        self.y = float(getattr(landmark, "y", 0.0))
        self.z = float(getattr(landmark, "z", 0.0))
        self.visibility = max(
            float(getattr(landmark, "visibility", 0.0)),
            float(getattr(landmark, "presence", 0.0)),
        )


def _invalid_scan_result(message: str = INVALID_SCAN_MESSAGE) -> SmartFitScanResponse:
    return SmartFitScanResponse(
        is_valid=False,
        message=message,
        measurements=None,
    )


def estimate_measurements_from_scan(
    *,
    front_image_base64: str,
    side_image_base64: str,
    height_cm: float,
    previous_measurements: dict[str, float] | None = None,
) -> SmartFitScanResponse:
    if not (front_image_base64 or "").strip() or not (side_image_base64 or "").strip():
        return _invalid_scan_result()

    try:
        safe_height = _require_height(height_cm)
        front_image = _decode_image(front_image_base64)
        side_image = _decode_image(side_image_base64)
        measurements, confidence, is_approximate, quality_message = _estimate_measurements(
            front_image=front_image,
            side_image=side_image,
            height_cm=safe_height,
            previous_measurements=previous_measurements,
        )
    except Exception as exc:
        if isinstance(exc, MeasurementProcessingError):
            logger.warning("Measurement scan rejected. reason=%s", exc)
            return _invalid_scan_result()
        logger.exception("Measurement estimation crashed.")
        return _invalid_scan_result()

    if not measurements:
        return _invalid_scan_result()

    message = quality_message or (LOW_CONFIDENCE_MESSAGE if is_approximate or confidence < 0.7 else "Scan successful")
    return SmartFitScanResponse(
        is_valid=True,
        message=message,
        measurements=SmartFitScanMeasurements(
            chest=_round1(measurements["chest"]),
            waist=_round1(measurements["waist"]),
            shoulders=_round1(measurements["shoulders"]),
            arms=_round1(measurements["arms"]) if measurements.get("arms") is not None else None,
            legs=_round1(measurements["legs"]) if measurements.get("legs") is not None else None,
            torso=_round1(measurements["torso"]) if measurements.get("torso") is not None else None,
            hips=_round1(measurements["hips"]) if measurements.get("hips") is not None else None,
            bust=_round1(measurements["bust"]) if measurements.get("bust") is not None else None,
            confidence=_round2(confidence),
        ),
    )


def _estimate_measurements(
    *,
    front_image: np.ndarray,
    side_image: np.ndarray,
    height_cm: float,
    previous_measurements: dict[str, float] | None = None,
) -> tuple[dict[str, float], float, bool, str | None]:
    front_view = _analyze_view(front_image, view="front")
    side_view = _analyze_view(side_image, view="side")
    is_approximate = False
    quality_message: str | None = None
    try:
        _validate_cross_view_consistency(front_view, side_view)
    except MeasurementProcessingError:
        if _has_core_landmarks(front_view, side_view):
            is_approximate = True
        else:
            raise

    mean_pixel_height = (front_view["pixel_height"] + side_view["pixel_height"]) / 2.0
    scale_cm_per_px = height_cm / mean_pixel_height

    measurements = _extract_measurements(
        front_view=front_view,
        side_view=side_view,
        scale_cm_per_px=scale_cm_per_px,
        height_cm=height_cm,
    )
    measurements = _stabilize_with_previous_scan(measurements, previous_measurements)

    confidence = _compute_confidence(front_view, side_view)
    if front_view.get("small_silhouette") or side_view.get("small_silhouette"):
        confidence *= 0.7
        is_approximate = True
    if front_view.get("low_lighting") or side_view.get("low_lighting"):
        confidence *= 0.8
        is_approximate = True
    if front_view.get("high_tilt") or side_view.get("high_tilt"):
        confidence *= 0.8
        is_approximate = True
    if front_view.get("low_landmark_count") or side_view.get("low_landmark_count"):
        confidence *= 0.7
        is_approximate = True
    if front_view.get("flat_width_variation") or side_view.get("flat_width_variation"):
        confidence *= 0.7
        is_approximate = True
    if front_view.get("height_fallback") or side_view.get("height_fallback"):
        confidence *= 0.75
        is_approximate = True
        quality_message = CROPPED_FEET_MESSAGE
    if front_view.get("pose_fallback") or side_view.get("pose_fallback"):
        confidence *= 0.82
        is_approximate = True
    confidence = _clamp(confidence, 0.0, 1.0)

    _validate_core_measurements(measurements)
    if confidence < APPROXIMATE_CONFIDENCE_THRESHOLD:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)

    if confidence < 0.7:
        is_approximate = True
        quality_message = quality_message or LOW_CONFIDENCE_MESSAGE

    return _round_measurements(measurements), confidence, is_approximate, quality_message


def _require_height(height_cm: float) -> float:
    if not isinstance(height_cm, (int, float)) or not math.isfinite(height_cm):
        raise MeasurementProcessingError("Height must be provided.")
    if height_cm <= 0:
        raise MeasurementProcessingError("Height must be provided.")
    if height_cm < 120 or height_cm > 220:
        raise MeasurementProcessingError("Height must be between 120 cm and 220 cm.")
    return float(height_cm)


def _decode_image(image_base64: str) -> np.ndarray:
    raw_payload = (image_base64 or "").strip()
    if not raw_payload:
        raise MeasurementProcessingError("Both front and side images are required.")

    if "," in raw_payload:
        _, raw_payload = raw_payload.split(",", 1)

    try:
        image_bytes = base64.b64decode(raw_payload, validate=True)
    except Exception as exc:
        raise MeasurementProcessingError("Uploaded scan image is not valid base64.") from exc

    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image is None:
        raise MeasurementProcessingError("Uploaded scan image could not be decoded.")

    # Phone photos arrive at 4000px+; pose/segmentation on that takes minutes.
    # Landmarks are normalized ratios, so downscaling does not change the
    # resulting measurements.
    max_side = max(image.shape[:2])
    if max_side > 1280:
        scale = 1280.0 / max_side
        image = cv2.resize(
            image,
            (max(int(image.shape[1] * scale), 1), max(int(image.shape[0] * scale), 1)),
            interpolation=cv2.INTER_AREA,
        )
    return image


def _analyze_view(image: np.ndarray, *, view: str = "front") -> dict[str, object]:
    image_height, image_width = image.shape[:2]
    contrast_score = _estimate_contrast(image)
    low_lighting = contrast_score < MIN_CONTRAST_STDDEV

    silhouette = _extract_silhouette(image)
    small_silhouette = float(silhouette["frame_ratio"]) < MIN_SILHOUETTE_FRAME_RATIO

    landmarks = _detect_pose(image, silhouette=silhouette)
    pose_fallback = _landmarks_are_synthetic(landmarks)
    try:
        _validate_required_landmarks(landmarks)
    except MeasurementProcessingError:
        landmarks = _synthetic_pose_from_silhouette(silhouette, image_width, image_height)
        pose_fallback = True
    landmark_count = _visible_landmark_count(landmarks)
    low_landmark_count = landmark_count < 15

    shoulder_mid = _paired_midpoint(landmarks, LEFT_SHOULDER, RIGHT_SHOULDER, image_width, image_height)
    hip_mid = _paired_midpoint(landmarks, LEFT_HIP, RIGHT_HIP, image_width, image_height)
    if shoulder_mid is None or hip_mid is None or hip_mid["y"] <= shoulder_mid["y"]:
        if pose_fallback:
            raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)
        landmarks = _synthetic_pose_from_silhouette(silhouette, image_width, image_height)
        pose_fallback = True
        landmark_count = _visible_landmark_count(landmarks)
        low_landmark_count = landmark_count < 15
        shoulder_mid = _paired_midpoint(landmarks, LEFT_SHOULDER, RIGHT_SHOULDER, image_width, image_height)
        hip_mid = _paired_midpoint(landmarks, LEFT_HIP, RIGHT_HIP, image_width, image_height)
        if shoulder_mid is None or hip_mid is None or hip_mid["y"] <= shoulder_mid["y"]:
            raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)

    tilt_degrees = _body_tilt_degrees(shoulder_mid, hip_mid)
    high_tilt = tilt_degrees > MAX_BODY_TILT_DEGREES

    head_y = min(_pick_head_y(landmarks, image_width, image_height), silhouette["bbox"][1])
    foot_y = _pick_foot_y(landmarks, image_width, image_height)
    feet_detected = foot_y is not None
    height_fallback = False
    torso_height_px = hip_mid["y"] - shoulder_mid["y"]
    if not feet_detected:
        pixel_height = torso_height_px * 2.2
        height_fallback = True
    else:
        pixel_height = foot_y - head_y
    chest_y = shoulder_mid["y"] + 0.35 * (hip_mid["y"] - shoulder_mid["y"])
    waist_y = shoulder_mid["y"] + 0.60 * (hip_mid["y"] - shoulder_mid["y"])
    hip_y = hip_mid["y"]

    flat_width_variation = not _has_body_width_variation(silhouette["mask"], shoulder_mid["y"], hip_y)

    shoulder_landmark_width_px = _paired_distance(
        landmarks,
        LEFT_SHOULDER,
        RIGHT_SHOULDER,
        image_width,
        image_height,
        min_visibility=MIN_CORE_VISIBILITY,
    )
    hip_landmark_width_px = _paired_distance(
        landmarks,
        LEFT_HIP,
        RIGHT_HIP,
        image_width,
        image_height,
        min_visibility=MIN_CORE_VISIBILITY,
    )
    torso_height_px = hip_mid["y"] - shoulder_mid["y"]
    band_half_height = max(4.0, torso_height_px * 0.055)
    # In profile photos the left/right shoulder landmarks overlap, so pair width
    # is not a safe cap for front-to-back body depth.
    use_anatomy_limits = not pose_fallback and view != "side"
    shoulder_max_width_px = shoulder_landmark_width_px * 1.22 if use_anatomy_limits and shoulder_landmark_width_px else None
    chest_max_width_px = shoulder_landmark_width_px * 1.16 if use_anatomy_limits and shoulder_landmark_width_px else None
    waist_max_width_px = (
        max(
            shoulder_landmark_width_px * 1.04 if shoulder_landmark_width_px else 0.0,
            hip_landmark_width_px * 1.28 if hip_landmark_width_px else 0.0,
        )
        if use_anatomy_limits
        else None
    )
    shoulder_width_stats = _band_width_stats(
        silhouette["mask"],
        shoulder_mid["y"],
        band_half_height,
        center_x=shoulder_mid["x"],
        max_width_px=shoulder_max_width_px,
    )
    chest_width_stats = _band_width_stats(
        silhouette["mask"],
        chest_y,
        band_half_height,
        center_x=_interpolate_center_x(shoulder_mid, hip_mid, shoulder_mid["y"], hip_mid["y"], chest_y),
        max_width_px=chest_max_width_px,
    )
    waist_width_stats = _band_width_stats(
        silhouette["mask"],
        waist_y,
        band_half_height,
        center_x=_interpolate_center_x(shoulder_mid, hip_mid, shoulder_mid["y"], hip_mid["y"], waist_y),
        max_width_px=waist_max_width_px,
    )
    hip_width_stats = _band_width_stats(
        silhouette["mask"],
        hip_y,
        band_half_height,
        center_x=hip_mid["x"],
        max_width_px=hip_landmark_width_px * 1.30 if use_anatomy_limits and hip_landmark_width_px else None,
    )
    shoulder_width_px = shoulder_width_stats["p50"]
    chest_width_px = chest_width_stats["p45"]
    waist_width_px = waist_width_stats["p40"]
    hip_width_px = hip_width_stats["p50"]

    segment_lengths = _segment_lengths(
        landmarks,
        image_width,
        image_height,
        (
            (LEFT_SHOULDER, LEFT_ELBOW, LEFT_WRIST),
            (RIGHT_SHOULDER, RIGHT_ELBOW, RIGHT_WRIST),
        ),
    )
    leg_lengths = _segment_lengths(
        landmarks,
        image_width,
        image_height,
        (
            (LEFT_HIP, LEFT_KNEE, LEFT_ANKLE),
            (RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE),
        ),
    )
    torso_lengths = _segment_lengths(
        landmarks,
        image_width,
        image_height,
        (
            (LEFT_SHOULDER, LEFT_HIP),
            (RIGHT_SHOULDER, RIGHT_HIP),
        ),
    )
    torso_length_px = sum(torso_lengths) / len(torso_lengths) if torso_lengths else torso_height_px
    if torso_length_px <= 0:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)

    silhouette_quality = _score_silhouette_quality(
        frame_ratio=float(silhouette["frame_ratio"]),
        contrast_score=contrast_score,
    )
    symmetry_score = _calculate_symmetry_score(
        mask=silhouette["mask"],
        shoulder_mid=shoulder_mid,
        hip_mid=hip_mid,
        rows={
            "shoulder": shoulder_mid["y"],
            "chest": chest_y,
            "waist": waist_y,
            "hip": hip_y,
        },
    )

    return {
        "landmarks": landmarks,
        "mask": silhouette["mask"],
        "pixel_height": pixel_height,
        "shoulder_mid": shoulder_mid,
        "hip_mid": hip_mid,
        "widths_px": {
            "shoulders": shoulder_width_px,
            "chest": chest_width_px,
            "waist": waist_width_px,
            "hips": hip_width_px,
        },
        "width_stats_px": {
            "shoulders": shoulder_width_stats,
            "chest": chest_width_stats,
            "waist": waist_width_stats,
            "hips": hip_width_stats,
        },
        "landmark_widths_px": {
            "shoulders": shoulder_landmark_width_px,
            "hips": hip_landmark_width_px,
        },
        "depths_px": {
            "chest": chest_width_px,
            "waist": waist_width_px,
            "hips": hip_width_px,
        },
        "arm_length_px": sum(segment_lengths) / len(segment_lengths) if segment_lengths else None,
        "leg_length_px": sum(leg_lengths) / len(leg_lengths) if leg_lengths else None,
        "torso_length_px": torso_length_px,
        "pose_confidence": _estimate_view_confidence(landmarks),
        "landmark_visibility": _average_visibility(landmarks, KEY_VISIBILITY_LANDMARKS),
        "silhouette_quality": silhouette_quality,
        "symmetry_score": symmetry_score,
        "contrast_score": contrast_score,
        "low_lighting": low_lighting,
        "small_silhouette": small_silhouette,
        "high_tilt": high_tilt,
        "low_landmark_count": low_landmark_count,
        "flat_width_variation": flat_width_variation,
        "height_fallback": height_fallback,
        "feet_detected": feet_detected,
        "pose_fallback": pose_fallback,
    }


def _detect_pose(image: np.ndarray, *, silhouette: dict[str, object] | None = None):
    if POSE is None:
        try:
            return _detect_pose_with_tasks(image)
        except Exception as exc:
            logger.warning("MediaPipe Tasks pose fallback failed. reason=%s", exc)
            if silhouette is None:
                raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE) from exc
            return _synthetic_pose_from_silhouette(silhouette, image.shape[1], image.shape[0])

    rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    with POSE.Pose(
        static_image_mode=True,
        model_complexity=2,
        enable_segmentation=False,
        min_detection_confidence=0.5,
    ) as pose:
        result = pose.process(rgb_image)

    if not result.pose_landmarks:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)

    return result.pose_landmarks.landmark


def _extract_silhouette(image: np.ndarray) -> dict[str, object]:
    if SELFIE_SEGMENTATION is None:
        try:
            return _extract_silhouette_with_tasks(image)
        except Exception as exc:
            logger.warning("MediaPipe Tasks segmentation fallback failed. reason=%s", exc)
            return _extract_silhouette_with_opencv(image)

    rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    with SELFIE_SEGMENTATION.SelfieSegmentation(model_selection=1) as segmenter:
        segmentation = segmenter.process(rgb_image).segmentation_mask

    if segmentation is None:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)

    binary_mask = (segmentation >= 0.5).astype(np.uint8) * 255
    kernel = np.ones((5, 5), dtype=np.uint8)
    closed_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_CLOSE, kernel)

    contours_info = cv2.findContours(closed_mask.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = contours_info[0] if len(contours_info) == 2 else contours_info[1]
    if not contours:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)

    largest_contour = max(contours, key=cv2.contourArea)
    filled_mask = np.zeros_like(closed_mask)
    cv2.drawContours(filled_mask, [largest_contour], contourIdx=-1, color=255, thickness=cv2.FILLED)

    x, y, width, height = cv2.boundingRect(largest_contour)
    silhouette_area = float(cv2.countNonZero(filled_mask))
    frame_area = float(image.shape[0] * image.shape[1])

    return {
        "mask": filled_mask,
        "bbox": (int(x), int(y), int(width), int(height)),
        "frame_ratio": silhouette_area / max(frame_area, 1.0),
    }


def _detect_pose_with_tasks(image: np.ndarray) -> list[_TaskLandmark]:
    landmarker = _get_pose_landmarker()
    rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb_image))
    with _POSE_TASK_LOCK:
        result = landmarker.detect(mp_image)

    pose_landmarks = getattr(result, "pose_landmarks", None)
    if not pose_landmarks:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)
    return [_TaskLandmark(landmark) for landmark in pose_landmarks[0]]


def _extract_silhouette_with_tasks(image: np.ndarray) -> dict[str, object]:
    segmenter = _get_image_segmenter()
    rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb_image))
    with _SEGMENTER_TASK_LOCK:
        result = segmenter.segment(mp_image)

    confidence_masks = getattr(result, "confidence_masks", None)
    if confidence_masks:
        mask_index = 1 if len(confidence_masks) > 1 else 0
        segmentation = np.asarray(confidence_masks[mask_index].numpy_view(), dtype=np.float32)
        binary_mask = (segmentation >= 0.45).astype(np.uint8) * 255
    else:
        category_mask = getattr(result, "category_mask", None)
        if category_mask is None:
            raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)
        segmentation = np.asarray(category_mask.numpy_view())
        binary_mask = (segmentation > 0).astype(np.uint8) * 255

    if binary_mask.shape[:2] != image.shape[:2]:
        binary_mask = cv2.resize(binary_mask, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_NEAREST)

    return _silhouette_from_binary_mask(binary_mask, image.shape)


def _get_pose_landmarker():
    global _POSE_TASK
    if _POSE_TASK is not None:
        return _POSE_TASK
    with _POSE_TASK_LOCK:
        if _POSE_TASK is not None:
            return _POSE_TASK
        model_path = _ensure_task_model(
            POSE_LANDMARKER_MODEL_PATH,
            POSE_LANDMARKER_MODEL_URL,
        )
        options = vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=0.35,
            min_pose_presence_confidence=0.35,
            min_tracking_confidence=0.35,
        )
        _POSE_TASK = vision.PoseLandmarker.create_from_options(options)
    return _POSE_TASK


def _get_image_segmenter():
    global _SEGMENTER_TASK
    if _SEGMENTER_TASK is not None:
        return _SEGMENTER_TASK
    with _SEGMENTER_TASK_LOCK:
        if _SEGMENTER_TASK is not None:
            return _SEGMENTER_TASK
        model_path = _ensure_task_model(
            IMAGE_SEGMENTER_MODEL_PATH,
            IMAGE_SEGMENTER_MODEL_URL,
        )
        options = vision.ImageSegmenterOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.IMAGE,
            output_confidence_masks=True,
        )
        _SEGMENTER_TASK = vision.ImageSegmenter.create_from_options(options)
    return _SEGMENTER_TASK


def _ensure_task_model(path: Path, source_url: str) -> Path:
    if path.exists() and path.stat().st_size > 0:
        return path
    with _TASK_MODEL_LOCK:
        if path.exists() and path.stat().st_size > 0:
            return path
        path.parent.mkdir(parents=True, exist_ok=True)
        logger.info("Downloading MediaPipe model: %s", path.name)
        urlretrieve(source_url, path)
    return path


def _silhouette_from_binary_mask(binary_mask: np.ndarray, image_shape: tuple[int, ...]) -> dict[str, object]:
    kernel = np.ones((5, 5), dtype=np.uint8)
    closed_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours_info = cv2.findContours(closed_mask.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = contours_info[0] if len(contours_info) == 2 else contours_info[1]
    if not contours:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)

    largest_contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest_contour) <= 0:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)

    filled_mask = np.zeros_like(closed_mask)
    cv2.drawContours(filled_mask, [largest_contour], contourIdx=-1, color=255, thickness=cv2.FILLED)
    x, y, width, height = cv2.boundingRect(largest_contour)
    silhouette_area = float(cv2.countNonZero(filled_mask))
    frame_area = float(image_shape[0] * image_shape[1])

    return {
        "mask": filled_mask,
        "bbox": (int(x), int(y), int(width), int(height)),
        "frame_ratio": silhouette_area / max(frame_area, 1.0),
    }


def _extract_silhouette_with_opencv(image: np.ndarray) -> dict[str, object]:
    image_height, image_width = image.shape[:2]
    rect = (
        max(1, int(image_width * 0.06)),
        max(1, int(image_height * 0.03)),
        max(1, int(image_width * 0.88)),
        max(1, int(image_height * 0.94)),
    )
    grabcut_mask = np.zeros((image_height, image_width), dtype=np.uint8)
    bgd_model = np.zeros((1, 65), dtype=np.float64)
    fgd_model = np.zeros((1, 65), dtype=np.float64)

    try:
        cv2.grabCut(image, grabcut_mask, rect, bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_RECT)
        binary_mask = np.where(
            (grabcut_mask == cv2.GC_FGD) | (grabcut_mask == cv2.GC_PR_FGD),
            255,
            0,
        ).astype(np.uint8)
    except cv2.error:
        binary_mask = _contrast_silhouette_mask(image)

    if cv2.countNonZero(binary_mask) < image_height * image_width * 0.03:
        binary_mask = _contrast_silhouette_mask(image)

    kernel = np.ones((7, 7), dtype=np.uint8)
    binary_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_OPEN, kernel)
    closed_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours_info = cv2.findContours(closed_mask.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = contours_info[0] if len(contours_info) == 2 else contours_info[1]
    if not contours:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)

    largest_contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest_contour) <= 0:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)

    filled_mask = np.zeros_like(closed_mask)
    cv2.drawContours(filled_mask, [largest_contour], contourIdx=-1, color=255, thickness=cv2.FILLED)
    x, y, width, height = cv2.boundingRect(largest_contour)
    silhouette_area = float(cv2.countNonZero(filled_mask))
    frame_area = float(image_height * image_width)

    return {
        "mask": filled_mask,
        "bbox": (int(x), int(y), int(width), int(height)),
        "frame_ratio": silhouette_area / max(frame_area, 1.0),
    }


def _contrast_silhouette_mask(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, otsu_dark = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    _, otsu_light = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    dark_area = cv2.countNonZero(otsu_dark)
    light_area = cv2.countNonZero(otsu_light)
    frame_area = image.shape[0] * image.shape[1]
    if abs((dark_area / max(frame_area, 1)) - 0.35) < abs((light_area / max(frame_area, 1)) - 0.35):
        return otsu_dark.astype(np.uint8)
    return otsu_light.astype(np.uint8)


def _synthetic_pose_from_silhouette(
    silhouette: dict[str, object],
    image_width: int,
    image_height: int,
) -> list[_SyntheticLandmark]:
    x, y, width, height = silhouette["bbox"]
    center_x = x + (width / 2.0)
    top = y
    bottom = y + height
    shoulder_y = y + (height * 0.23)
    hip_y = y + (height * 0.55)
    knee_y = y + (height * 0.76)
    ankle_y = min(bottom, image_height - 1)
    shoulder_half = width * 0.22
    hip_half = width * 0.18
    wrist_half = width * 0.30
    ankle_half = width * 0.12

    def normalized(px: float, py: float, visibility: float = 0.78) -> _SyntheticLandmark:
        return _SyntheticLandmark(
            _clamp(px / max(image_width, 1), 0.0, 1.0),
            _clamp(py / max(image_height, 1), 0.0, 1.0),
            visibility=visibility,
        )

    landmarks = [normalized(center_x, y + (height * 0.45), visibility=0.45) for _ in range(33)]
    for index in HEAD_LANDMARKS:
        landmarks[index] = normalized(center_x, top + (height * 0.03), visibility=0.72)
    landmarks[LEFT_SHOULDER] = normalized(center_x - shoulder_half, shoulder_y)
    landmarks[RIGHT_SHOULDER] = normalized(center_x + shoulder_half, shoulder_y)
    landmarks[LEFT_ELBOW] = normalized(center_x - wrist_half, y + (height * 0.38), visibility=0.65)
    landmarks[RIGHT_ELBOW] = normalized(center_x + wrist_half, y + (height * 0.38), visibility=0.65)
    landmarks[LEFT_WRIST] = normalized(center_x - wrist_half, y + (height * 0.58), visibility=0.62)
    landmarks[RIGHT_WRIST] = normalized(center_x + wrist_half, y + (height * 0.58), visibility=0.62)
    landmarks[LEFT_HIP] = normalized(center_x - hip_half, hip_y)
    landmarks[RIGHT_HIP] = normalized(center_x + hip_half, hip_y)
    landmarks[LEFT_KNEE] = normalized(center_x - ankle_half, knee_y, visibility=0.70)
    landmarks[RIGHT_KNEE] = normalized(center_x + ankle_half, knee_y, visibility=0.70)
    landmarks[LEFT_ANKLE] = normalized(center_x - ankle_half, ankle_y, visibility=0.70)
    landmarks[RIGHT_ANKLE] = normalized(center_x + ankle_half, ankle_y, visibility=0.70)
    landmarks[LEFT_HEEL] = normalized(center_x - ankle_half, ankle_y, visibility=0.66)
    landmarks[RIGHT_HEEL] = normalized(center_x + ankle_half, ankle_y, visibility=0.66)
    return landmarks


def _validate_required_landmarks(landmarks) -> None:
    required_pairs = (
        (LEFT_SHOULDER, RIGHT_SHOULDER),
        (LEFT_HIP, RIGHT_HIP),
    )
    for left_index, right_index in required_pairs:
        left_visible = _landmark_visibility(landmarks, left_index) >= MIN_CORE_VISIBILITY
        right_visible = _landmark_visibility(landmarks, right_index) >= MIN_CORE_VISIBILITY
        if not (left_visible or right_visible):
            raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)


def _pick_head_y(landmarks, image_width: int, image_height: int) -> float:
    candidates = [
        _visible_point(landmarks, index, image_width, image_height, min_visibility=0.2)
        for index in HEAD_LANDMARKS
    ]
    visible_candidates = [candidate for candidate in candidates if candidate is not None]
    if not visible_candidates:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)
    return min(candidate["y"] for candidate in visible_candidates)


def _pick_foot_y(landmarks, image_width: int, image_height: int) -> float | None:
    heel_points = [
        _visible_point(landmarks, index, image_width, image_height, min_visibility=0.2)
        for index in (LEFT_HEEL, RIGHT_HEEL)
    ]
    visible_heels = [point for point in heel_points if point is not None]
    if visible_heels:
        return max(point["y"] for point in visible_heels)

    ankle_points = [
        _visible_point(landmarks, index, image_width, image_height, min_visibility=MIN_ANKLE_VISIBILITY)
        for index in (LEFT_ANKLE, RIGHT_ANKLE)
    ]
    visible_ankles = [point for point in ankle_points if point is not None]
    if visible_ankles:
        return max(point["y"] for point in visible_ankles)

    return None


def _visible_point(
    landmarks,
    index: int,
    image_width: int,
    image_height: int,
    *,
    min_visibility: float = VISIBILITY_THRESHOLD,
):
    try:
        landmark = landmarks[index]
    except IndexError:
        return None

    visibility = float(getattr(landmark, "visibility", 0.0))
    if visibility < min_visibility:
        return None

    return {
        "x": float(landmark.x) * image_width,
        "y": float(landmark.y) * image_height,
    }


def _paired_midpoint(
    landmarks,
    left_index: int,
    right_index: int,
    image_width: int,
    image_height: int,
):
    left_point = _visible_point(
        landmarks,
        left_index,
        image_width,
        image_height,
        min_visibility=MIN_CORE_VISIBILITY,
    )
    right_point = _visible_point(
        landmarks,
        right_index,
        image_width,
        image_height,
        min_visibility=MIN_CORE_VISIBILITY,
    )
    if left_point is not None and right_point is not None:
        return _midpoint(left_point, right_point)
    return left_point or right_point


def _midpoint(point_a: dict[str, float] | None, point_b: dict[str, float] | None):
    if point_a is None or point_b is None:
        return None
    return {
        "x": (point_a["x"] + point_b["x"]) / 2.0,
        "y": (point_a["y"] + point_b["y"]) / 2.0,
    }


def _body_tilt_degrees(shoulder_mid: dict[str, float], hip_mid: dict[str, float]) -> float:
    delta_x = shoulder_mid["x"] - hip_mid["x"]
    delta_y = hip_mid["y"] - shoulder_mid["y"]
    if delta_y <= 0:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)
    return abs(math.degrees(math.atan2(delta_x, delta_y)))


def _smoothed_width(mask: np.ndarray, target_y: float) -> float:
    widths: list[float] = []
    base_row = int(round(target_y))
    max_row = mask.shape[0] - 1

    for offset in ROW_SMOOTHING_OFFSETS:
        row_index = max(0, min(max_row, base_row + offset))
        xs = np.where(mask[row_index, :] > 0)[0]
        if xs.size == 0:
            continue
        widths.append(float(xs.max() - xs.min()))

    if not widths:
        for offset in range(-20, 21, 4):
            row_index = max(0, min(max_row, base_row + offset))
            xs = np.where(mask[row_index, :] > 0)[0]
            if xs.size == 0:
                continue
            widths.append(float(xs.max() - xs.min()))

    if not widths:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)

    return sum(widths) / len(widths)


def _band_width_stats(
    mask: np.ndarray,
    target_y: float,
    half_height: float,
    *,
    center_x: float | None = None,
    max_width_px: float | None = None,
) -> dict[str, float]:
    base_row = int(round(target_y))
    radius = max(2, int(round(half_height)))
    min_row = max(0, base_row - radius)
    max_row = min(mask.shape[0] - 1, base_row + radius)
    widths: list[float] = []

    for row_index in range(min_row, max_row + 1):
        width = _row_body_width(mask, row_index, center_x=center_x, max_width_px=max_width_px)
        if width is None:
            continue
        widths.append(width)

    if not widths:
        smoothed = _smoothed_width(mask, target_y)
        widths = [smoothed]

    values = np.asarray(widths, dtype=np.float32)
    return {
        "p25": float(np.percentile(values, 25)),
        "p30": float(np.percentile(values, 30)),
        "p35": float(np.percentile(values, 35)),
        "p40": float(np.percentile(values, 40)),
        "p45": float(np.percentile(values, 45)),
        "p50": float(np.percentile(values, 50)),
        "p60": float(np.percentile(values, 60)),
    }


def _row_body_width(
    mask: np.ndarray,
    row_index: int,
    *,
    center_x: float | None = None,
    max_width_px: float | None = None,
) -> float | None:
    xs = np.where(mask[row_index, :] > 0)[0]
    if xs.size == 0:
        return None

    left = float(xs.min())
    right = float(xs.max())
    if center_x is not None:
        segments = _contiguous_segments(xs)
        if segments:
            selected = min(
                segments,
                key=lambda segment: 0.0
                if segment[0] <= center_x <= segment[1]
                else min(abs(center_x - segment[0]), abs(center_x - segment[1])),
            )
            left, right = selected

    width = max(right - left, 0.0)
    if isinstance(max_width_px, (int, float)) and math.isfinite(max_width_px) and max_width_px > 0:
        width = min(width, float(max_width_px))
    return width if width > 0 else None


def _contiguous_segments(xs: np.ndarray) -> list[tuple[float, float]]:
    if xs.size == 0:
        return []

    segments: list[tuple[float, float]] = []
    start = int(xs[0])
    previous = int(xs[0])
    for raw_value in xs[1:]:
        value = int(raw_value)
        if value > previous + 1:
            segments.append((float(start), float(previous)))
            start = value
        previous = value
    segments.append((float(start), float(previous)))
    return segments


def _paired_distance(
    landmarks,
    left_index: int,
    right_index: int,
    image_width: int,
    image_height: int,
    *,
    min_visibility: float,
) -> float | None:
    left_point = _visible_point(
        landmarks,
        left_index,
        image_width,
        image_height,
        min_visibility=min_visibility,
    )
    right_point = _visible_point(
        landmarks,
        right_index,
        image_width,
        image_height,
        min_visibility=min_visibility,
    )
    if left_point is None or right_point is None:
        return None
    return _distance(left_point, right_point)


def _has_body_width_variation(mask: np.ndarray, shoulder_y: float, hip_y: float) -> bool:
    top = int(round(min(shoulder_y, hip_y)))
    bottom = int(round(max(shoulder_y, hip_y)))
    if bottom <= top:
        return False

    rows = np.linspace(top, bottom, num=7)
    widths: list[float] = []
    max_row = mask.shape[0] - 1
    for row in rows:
        row_index = max(0, min(max_row, int(round(row))))
        xs = np.where(mask[row_index, :] > 0)[0]
        if xs.size > 0:
            widths.append(float(xs.max() - xs.min()))

    if len(widths) < 4:
        return True

    mean_width = sum(widths) / len(widths)
    if mean_width <= 0:
        return False

    return (max(widths) - min(widths)) >= max(6.0, mean_width * 0.03)


def _segment_lengths(
    landmarks,
    image_width: int,
    image_height: int,
    chains: Iterable[tuple[int, ...]],
) -> list[float]:
    lengths: list[float] = []
    for chain in chains:
        points = [
            _visible_point(landmarks, index, image_width, image_height, min_visibility=VISIBILITY_THRESHOLD)
            for index in chain
        ]
        if any(point is None for point in points):
            continue
        chain_length = 0.0
        for current_point, next_point in zip(points, points[1:]):
            chain_length += _distance(current_point, next_point)
        if chain_length > 0:
            lengths.append(chain_length)
    return lengths


def _extract_measurements(
    *,
    front_view: dict[str, object],
    side_view: dict[str, object],
    scale_cm_per_px: float,
    height_cm: float,
) -> dict[str, float]:
    front_widths = front_view["widths_px"]
    front_stats = front_view.get("width_stats_px", {})
    side_stats = side_view.get("width_stats_px", {})
    landmark_widths = front_view.get("landmark_widths_px", {})

    shoulder_width_px = _max_optional(
        float(front_widths["shoulders"]),
        _dict_number(landmark_widths, "shoulders"),
    )
    shoulder_width_cm = shoulder_width_px * scale_cm_per_px * SHOULDER_SILHOUETTE_TO_TAPE_SCALE

    chest_width_cm = _measurement_width_px(front_stats, front_widths, "chest", "p45") * scale_cm_per_px
    waist_width_cm = _measurement_width_px(front_stats, front_widths, "waist", "p40") * scale_cm_per_px
    hip_width_cm = _measurement_width_px(front_stats, front_widths, "hips", "p50") * scale_cm_per_px
    chest_depth_cm = _measurement_width_px(side_stats, side_view["depths_px"], "chest", "p30") * scale_cm_per_px
    waist_depth_cm = _measurement_width_px(side_stats, side_view["depths_px"], "waist", "p25") * scale_cm_per_px
    hip_depth_cm = _measurement_width_px(side_stats, side_view["depths_px"], "hips", "p35") * scale_cm_per_px
    chest_depth_cm = min(chest_depth_cm, shoulder_width_cm * CHEST_MAX_DEPTH_TO_SHOULDER_RATIO)
    waist_depth_cm = min(waist_depth_cm, shoulder_width_cm * WAIST_MAX_DEPTH_TO_SHOULDER_RATIO)
    hip_depth_cm = min(hip_depth_cm, shoulder_width_cm * HIP_MAX_DEPTH_TO_SHOULDER_RATIO)

    chest_raw = calculate_circumference(chest_width_cm, chest_depth_cm)
    waist_raw = calculate_circumference(waist_width_cm, waist_depth_cm)
    hips_raw = calculate_circumference(hip_width_cm, hip_depth_cm)
    chest = _calibrated_body_circumference(
        chest_raw,
        shoulder_width_cm,
        chest_width_cm,
        chest_depth_cm,
        CHEST_RATIO_CALIBRATION,
        measurement_name="chest",
    )
    waist = _calibrated_body_circumference(
        waist_raw,
        shoulder_width_cm,
        waist_width_cm,
        waist_depth_cm,
        WAIST_RATIO_CALIBRATION,
        measurement_name="waist",
    )
    hips = _calibrated_ratio_measurement(hips_raw, shoulder_width_cm, HIP_RATIO_CALIBRATION)
    chest, waist, hips = _apply_body_shape_sanity(chest, waist, hips, height_cm)

    torso_px = (float(front_view["torso_length_px"]) + float(side_view["torso_length_px"])) / 2.0
    arm_px = _average_optional(float(front_view["arm_length_px"]) if front_view["arm_length_px"] is not None else None,
        float(side_view["arm_length_px"]) if side_view["arm_length_px"] is not None else None)
    leg_px = _average_optional(float(front_view["leg_length_px"]) if front_view["leg_length_px"] is not None else None,
        float(side_view["leg_length_px"]) if side_view["leg_length_px"] is not None else None)
    arms_raw_cm = arm_px * scale_cm_per_px if arm_px is not None else None
    legs_raw_cm = leg_px * scale_cm_per_px if leg_px is not None else None
    arms_cm = _calibrated_linear_measurement(arms_raw_cm, ARM_LENGTH_CALIBRATION) if arms_raw_cm is not None else None
    legs_cm = _calibrated_linear_measurement(legs_raw_cm, LEG_LENGTH_CALIBRATION) if legs_raw_cm is not None else None

    measurements = {
        "chest": chest,
        "waist": waist,
        "shoulders": shoulder_width_cm,
        "arms": arms_cm,
        "legs": legs_cm,
        "torso": torso_px * scale_cm_per_px,
        "hips": hips,
        "bust": chest,
    }
    return measurements


def calculate_circumference(width_cm: float, depth_cm: float) -> float:
    a = max(width_cm / 2.0, 0.1)
    b = max(depth_cm / 2.0, 0.1)
    h = ((a - b) ** 2) / ((a + b) ** 2)
    return math.pi * (a + b) * (1.0 + ((3.0 * h) / (10.0 + math.sqrt(4.0 - (3.0 * h)))))


def _measurement_width_px(
    stats_by_name: object,
    fallback_by_name: object,
    measurement_name: str,
    percentile_key: str,
) -> float:
    if isinstance(stats_by_name, dict):
        stats = stats_by_name.get(measurement_name)
        if isinstance(stats, dict):
            value = stats.get(percentile_key)
            if isinstance(value, (int, float)) and math.isfinite(value) and value > 0:
                return float(value)

    if isinstance(fallback_by_name, dict):
        fallback = fallback_by_name.get(measurement_name)
        if isinstance(fallback, (int, float)) and math.isfinite(fallback) and fallback > 0:
            return float(fallback)

    raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)


def _dict_number(payload: object, key: str) -> float | None:
    if not isinstance(payload, dict):
        return None
    value = payload.get(key)
    if isinstance(value, (int, float)) and math.isfinite(value) and value > 0:
        return float(value)
    return None


def _max_optional(value: float | None, *candidates: float | None) -> float:
    values = [
        float(candidate)
        for candidate in (value, *candidates)
        if isinstance(candidate, (int, float)) and math.isfinite(candidate) and candidate > 0
    ]
    if not values:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)
    return max(values)


def _calibrated_ratio_measurement(
    raw_measurement: float,
    shoulder_width_cm: float,
    calibration: tuple[float, float, float, float],
) -> float:
    if not math.isfinite(raw_measurement) or raw_measurement <= 0:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)
    if not math.isfinite(shoulder_width_cm) or shoulder_width_cm <= 0:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)

    slope, intercept, minimum_ratio, maximum_ratio = calibration
    raw_ratio = raw_measurement / shoulder_width_cm
    calibrated_ratio = (slope * raw_ratio) + intercept
    if raw_ratio < minimum_ratio:
        calibrated_ratio = max(calibrated_ratio, minimum_ratio)
    calibrated_ratio = min(calibrated_ratio, maximum_ratio)
    return shoulder_width_cm * calibrated_ratio


def _calibrated_body_circumference(
    raw_measurement: float,
    shoulder_width_cm: float,
    width_cm: float,
    depth_cm: float,
    fallback_calibration: tuple[float, float, float, float],
    *,
    measurement_name: str,
) -> float:
    fallback_estimate = _calibrated_ratio_measurement(
        raw_measurement,
        shoulder_width_cm,
        fallback_calibration,
    )

    if _has_usable_side_depth(width_cm, depth_cm, shoulder_width_cm):
        raw_ratio = raw_measurement / shoulder_width_cm
        width_ratio = width_cm / shoulder_width_cm
        correction = _direct_circumference_correction(measurement_name, raw_ratio)
        minimum_ratio, maximum_ratio = DIRECT_CIRCUMFERENCE_RATIO_LIMITS.get(
            measurement_name,
            (fallback_calibration[2], fallback_calibration[3]),
        )
        direct_estimate = _clamp(
            raw_measurement * correction,
            shoulder_width_cm * minimum_ratio,
            shoulder_width_cm * maximum_ratio,
        )
        direct_weight = _direct_circumference_weight(
            measurement_name,
            raw_ratio,
            width_ratio,
        )
        return (fallback_estimate * (1.0 - direct_weight)) + (direct_estimate * direct_weight)

    return fallback_estimate


def _has_usable_side_depth(width_cm: float, depth_cm: float, shoulder_width_cm: float) -> bool:
    if not (
        math.isfinite(width_cm)
        and math.isfinite(depth_cm)
        and math.isfinite(shoulder_width_cm)
        and width_cm > 0
        and depth_cm > 0
        and shoulder_width_cm > 0
    ):
        return False

    return (
        depth_cm / width_cm >= MIN_USABLE_DEPTH_TO_WIDTH_RATIO
        and depth_cm / shoulder_width_cm >= MIN_USABLE_DEPTH_TO_SHOULDER_RATIO
    )


def _direct_circumference_correction(measurement_name: str, raw_ratio: float) -> float:
    if measurement_name == "waist":
        broadness = _clamp((raw_ratio - 1.65) / 0.75, 0.0, 1.0)
        return 0.97 - (broadness * 0.08)
    if measurement_name == "chest":
        broadness = _clamp((raw_ratio - 2.10) / 0.55, 0.0, 1.0)
        return 1.00 - (broadness * 0.01)
    return 1.0


def _direct_circumference_weight(
    measurement_name: str,
    raw_ratio: float,
    width_ratio: float,
) -> float:
    thresholds = DIRECT_CIRCUMFERENCE_WEIGHT_THRESHOLDS.get(measurement_name)
    if thresholds is None:
        return 1.0

    width_threshold, raw_threshold = thresholds
    width_score = _range_score(width_ratio, width_threshold[0], width_threshold[1])
    raw_score = _range_score(raw_ratio, raw_threshold[0], raw_threshold[1])
    return max(width_score, raw_score)


def _range_score(value: float, lower: float, upper: float) -> float:
    if not math.isfinite(value):
        return 0.0
    span = upper - lower
    if span <= 0:
        return 0.0
    return _clamp((value - lower) / span, 0.0, 1.0)


def _calibrated_linear_measurement(
    raw_measurement: float,
    calibration: tuple[float, float],
) -> float:
    slope, intercept = calibration
    return max(1.0, (raw_measurement * slope) + intercept)


def _blend_with_body_prior(raw_measurement: float, prior_measurement: float) -> float:
    if not math.isfinite(raw_measurement) or raw_measurement <= 0:
        return prior_measurement
    if not math.isfinite(prior_measurement) or prior_measurement <= 0:
        return raw_measurement

    difference_ratio = abs(raw_measurement - prior_measurement) / max(prior_measurement, 1.0)
    if difference_ratio <= 0.08:
        prior_weight = 0.25
    else:
        prior_weight = _clamp(0.65 + ((difference_ratio - 0.08) / 0.20) * 0.25, 0.65, 0.90)
    return (raw_measurement * (1.0 - prior_weight)) + (prior_measurement * prior_weight)


def _apply_body_shape_sanity(
    chest: float,
    waist: float,
    hips: float,
    height_cm: float,
) -> tuple[float, float, float]:
    chest = _clamp(chest, height_cm * 0.38, height_cm * 0.78)
    waist = _clamp(waist, height_cm * 0.32, height_cm * 0.72)
    hips = _clamp(hips, height_cm * 0.35, height_cm * 0.80)

    if waist > chest * 1.08:
        waist = (waist * 0.45) + (chest * 0.95 * 0.55)
    if hips < waist * 0.92:
        hips = (hips * 0.45) + (waist * 1.02 * 0.55)

    return chest, waist, hips


def _stabilize_with_previous_scan(
    measurements: dict[str, float],
    previous_measurements: dict[str, float] | None,
) -> dict[str, float]:
    if not previous_measurements:
        return measurements

    stabilized = dict(measurements)
    for key in ("chest", "waist", "hips"):
        previous_value = previous_measurements.get(key)
        current_value = stabilized.get(key)
        if _should_blend_previous_scan_value(current_value, previous_value):
            stabilized[key] = (
                (float(current_value) * (1.0 - PREVIOUS_SCAN_BLEND_WEIGHT))
                + (float(previous_value) * PREVIOUS_SCAN_BLEND_WEIGHT)
            )
    if stabilized.get("bust") is not None:
        stabilized["bust"] = stabilized["chest"]
    return stabilized


def _should_blend_previous_scan_value(
    current_value: float | None,
    previous_value: float | None,
) -> bool:
    if not (
        isinstance(previous_value, (int, float))
        and math.isfinite(previous_value)
        and previous_value > 0
        and isinstance(current_value, (int, float))
        and math.isfinite(current_value)
        and current_value > 0
    ):
        return False

    difference = abs(float(current_value) - float(previous_value))
    if difference <= PREVIOUS_SCAN_JITTER_CM:
        return False

    max_blend_difference = max(
        PREVIOUS_SCAN_MAX_BLEND_CM,
        abs(float(current_value)) * PREVIOUS_SCAN_MAX_BLEND_RATIO,
    )
    return difference <= max_blend_difference


def _validate_cross_view_consistency(front_view: dict[str, object], side_view: dict[str, object]) -> None:
    front_height = float(front_view["pixel_height"])
    side_height = float(side_view["pixel_height"])
    height_delta = abs(side_height - front_height) / max(front_height, 1.0)
    if height_delta > MAX_HEIGHT_DELTA_RATIO:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)


def _has_core_landmarks(front_view: dict[str, object], side_view: dict[str, object]) -> bool:
    return bool(
        front_view.get("shoulder_mid") is not None
        and front_view.get("hip_mid") is not None
        and side_view.get("shoulder_mid") is not None
        and side_view.get("hip_mid") is not None
    )


def _compute_confidence(front_view: dict[str, object], side_view: dict[str, object]) -> float:
    pose_confidence = (float(front_view["pose_confidence"]) + float(side_view["pose_confidence"])) / 2.0
    landmark_visibility = (float(front_view["landmark_visibility"]) + float(side_view["landmark_visibility"])) / 2.0
    silhouette_quality = (float(front_view["silhouette_quality"]) + float(side_view["silhouette_quality"])) / 2.0
    return _clamp(
        (pose_confidence + landmark_visibility + silhouette_quality) / 3.0,
        0.0,
        1.0,
    )


def _estimate_view_confidence(landmarks) -> float:
    head_score = max((_landmark_visibility(landmarks, index) for index in HEAD_LANDMARKS), default=0.0)
    core_scores = [_landmark_visibility(landmarks, index) for index in (LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP)]
    lower_body_score = max((_landmark_visibility(landmarks, index) for index in (LEFT_ANKLE, RIGHT_ANKLE, LEFT_HEEL, RIGHT_HEEL)), default=0.0)
    average_core = sum(core_scores) / len(core_scores)
    return _clamp((head_score * 0.20) + (average_core * 0.55) + (lower_body_score * 0.25), 0.0, 1.0)


def _average_visibility(landmarks, indices: Iterable[int]) -> float:
    scores = [_landmark_visibility(landmarks, index) for index in indices]
    if not scores:
        return 0.0
    return sum(scores) / len(scores)


def _landmark_visibility(landmarks, index: int) -> float:
    try:
        visibility = float(getattr(landmarks[index], "visibility", 0.0))
    except IndexError:
        return 0.0
    return _clamp(visibility, 0.0, 1.0)


def _landmarks_are_synthetic(landmarks) -> bool:
    return any(isinstance(landmark, _SyntheticLandmark) for landmark in landmarks)


def _visible_landmark_count(landmarks, *, min_visibility: float = 0.2) -> int:
    return sum(
        1
        for landmark in landmarks
        if float(getattr(landmark, "visibility", 0.0)) >= min_visibility
    )


def _estimate_contrast(image: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return float(np.std(gray))


def _score_silhouette_quality(*, frame_ratio: float, contrast_score: float) -> float:
    silhouette_score = _clamp((frame_ratio - MIN_SILHOUETTE_FRAME_RATIO) / 0.25, 0.0, 1.0)
    normalized_contrast = _clamp((contrast_score - MIN_CONTRAST_STDDEV) / 24.0, 0.0, 1.0)
    return _clamp((silhouette_score * 0.7) + (normalized_contrast * 0.3), 0.0, 1.0)


def _calculate_symmetry_score(
    *,
    mask: np.ndarray,
    shoulder_mid: dict[str, float],
    hip_mid: dict[str, float],
    rows: dict[str, float],
) -> float:
    scores: list[float] = []
    shoulder_y = shoulder_mid["y"]
    hip_y = hip_mid["y"]

    for name, target_y in rows.items():
        row_index = max(0, min(mask.shape[0] - 1, int(round(target_y))))
        xs = np.where(mask[row_index, :] > 0)[0]
        if xs.size == 0:
            continue
        if name == "shoulder":
            center_x = shoulder_mid["x"]
        elif name == "hip":
            center_x = hip_mid["x"]
        else:
            center_x = _interpolate_center_x(shoulder_mid, hip_mid, shoulder_y, hip_y, target_y)
        left_span = max(center_x - float(xs.min()), 1.0)
        right_span = max(float(xs.max()) - center_x, 1.0)
        average_span = (left_span + right_span) / 2.0
        asymmetry_ratio = abs(left_span - right_span) / max(average_span, 1.0)
        scores.append(1.0 - min(1.0, asymmetry_ratio))

    if not scores:
        return 0.0
    return sum(scores) / len(scores)


def _interpolate_center_x(
    shoulder_mid: dict[str, float],
    hip_mid: dict[str, float],
    shoulder_y: float,
    hip_y: float,
    target_y: float,
) -> float:
    if hip_y <= shoulder_y:
        return (shoulder_mid["x"] + hip_mid["x"]) / 2.0
    ratio = _clamp((target_y - shoulder_y) / (hip_y - shoulder_y), 0.0, 1.0)
    return shoulder_mid["x"] + ((hip_mid["x"] - shoulder_mid["x"]) * ratio)


def _validate_core_measurements(measurements: dict[str, float | None]) -> None:
    for key in ("chest", "waist", "shoulders"):
        value = measurements.get(key)
        if value is None or not math.isfinite(value) or value <= 0:
            raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)


def _validate_measurement_ranges(measurements: dict[str, float | None]) -> None:
    for key, (minimum, maximum) in SCAN_MEASUREMENT_RANGES.items():
        value = measurements.get(key)
        if value is None or not math.isfinite(value) or value < minimum or value > maximum:
            raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)


def _validate_measurement_geometry(measurements: dict[str, float | None]) -> None:
    chest = measurements["chest"]
    waist = measurements["waist"]
    shoulders = measurements["shoulders"]
    hips = measurements["hips"]

    if chest is None or waist is None or shoulders is None or hips is None:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)
    if chest <= waist:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)
    if hips < waist:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)
    if shoulders < chest * 0.25 or shoulders > chest * 0.70:
        raise MeasurementProcessingError(SCAN_FAILURE_MESSAGE)


def _distance(point_a: dict[str, float], point_b: dict[str, float]) -> float:
    return math.hypot(point_a["x"] - point_b["x"], point_a["y"] - point_b["y"])


def _average_optional(value_a: float | None, value_b: float | None) -> float | None:
    values = [value for value in (value_a, value_b) if value is not None and math.isfinite(value)]
    if not values:
        return None
    return sum(values) / len(values)


def _round_measurements(measurements: dict[str, float | None]) -> dict[str, float | None]:
    rounded: dict[str, float | None] = {}
    for key, value in measurements.items():
        rounded[key] = round(value, 1) if isinstance(value, (int, float)) and math.isfinite(value) else None
    return rounded


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _round1(value: float) -> float:
    return round(value, 1)


def _round2(value: float) -> float:
    return round(value, 2)
