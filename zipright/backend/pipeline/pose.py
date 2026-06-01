from __future__ import annotations

from dataclasses import dataclass
from threading import Lock

from zipright.backend.pipeline._mediapipe_compat import ensure_protobuf_compatibility

ensure_protobuf_compatibility()

import mediapipe as mp
import numpy as np

from .preprocess import PreprocessedImage, RgbImage, ensure_rgb_image

POSE = mp.solutions.pose
LANDMARK_NAMES = {landmark.value: landmark.name.lower() for landmark in POSE.PoseLandmark}

LEFT_SHOULDER = POSE.PoseLandmark.LEFT_SHOULDER.value
RIGHT_SHOULDER = POSE.PoseLandmark.RIGHT_SHOULDER.value
LEFT_HIP = POSE.PoseLandmark.LEFT_HIP.value
RIGHT_HIP = POSE.PoseLandmark.RIGHT_HIP.value
LEFT_ANKLE = POSE.PoseLandmark.LEFT_ANKLE.value
RIGHT_ANKLE = POSE.PoseLandmark.RIGHT_ANKLE.value
LEFT_WRIST = POSE.PoseLandmark.LEFT_WRIST.value
RIGHT_WRIST = POSE.PoseLandmark.RIGHT_WRIST.value
LEFT_ELBOW = POSE.PoseLandmark.LEFT_ELBOW.value
RIGHT_ELBOW = POSE.PoseLandmark.RIGHT_ELBOW.value
LEFT_KNEE = POSE.PoseLandmark.LEFT_KNEE.value
RIGHT_KNEE = POSE.PoseLandmark.RIGHT_KNEE.value
NOSE = POSE.PoseLandmark.NOSE.value
LEFT_HEEL = POSE.PoseLandmark.LEFT_HEEL.value
RIGHT_HEEL = POSE.PoseLandmark.RIGHT_HEEL.value

_POSE_CACHE: dict[tuple[bool, int, float, float], object] = {}
_POSE_CACHE_LOCK = Lock()
_POSE_PROCESS_LOCK = Lock()


@dataclass(frozen=True)
class PoseConfig:
    static_image_mode: bool = True
    model_complexity: int = 2
    min_detection_confidence: float = 0.5
    min_tracking_confidence: float = 0.5
    shoulder_visibility_threshold: float = 0.6
    hip_visibility_threshold: float = 0.6
    ankle_visibility_threshold: float = 0.5
    max_shoulder_tilt: float = 0.05


@dataclass(frozen=True)
class PoseLandmark:
    index: int
    name: str
    x: float
    y: float
    z: float
    visibility: float

    def to_pixel(self, image_width: int, image_height: int) -> tuple[int, int]:
        px = int(round(np.clip(self.x, 0.0, 1.0) * max(image_width - 1, 0)))
        py = int(round(np.clip(self.y, 0.0, 1.0) * max(image_height - 1, 0)))
        return px, py


@dataclass(frozen=True)
class PoseDetectionResult:
    landmarks: tuple[PoseLandmark, ...]
    image_width: int
    image_height: int
    valid: bool
    issues: tuple[str, ...]
    instructions: str

    def landmark(self, index: int) -> PoseLandmark:
        return self.landmarks[index]

    def pixel_landmark(self, index: int) -> tuple[int, int]:
        return self.landmark(index).to_pixel(self.image_width, self.image_height)

    def visibility(self, index: int) -> float:
        return self.landmark(index).visibility

    def midpoint(self, left_index: int, right_index: int) -> tuple[float, float]:
        left = self.landmark(left_index)
        right = self.landmark(right_index)
        return ((left.x + right.x) / 2.0, (left.y + right.y) / 2.0)


def detect_pose(
    image: RgbImage | PreprocessedImage,
    *,
    config: PoseConfig | None = None,
) -> PoseDetectionResult:
    """Run MediaPipe Pose and validate the key body landmarks."""

    safe_config = config or PoseConfig()
    rgb_image = image.foreground_rgb if isinstance(image, PreprocessedImage) else ensure_rgb_image(image)
    image_height, image_width = rgb_image.shape[:2]
    estimator = _get_pose_estimator(safe_config)
    with _POSE_PROCESS_LOCK:
        result = estimator.process(rgb_image)
    pose_landmarks = getattr(result, "pose_landmarks", None)
    if pose_landmarks is None:
        issues = (
            "No full-body pose detected.",
            "Keep your whole body visible from head to heels and face the camera squarely.",
        )
        return PoseDetectionResult(
            landmarks=tuple(),
            image_width=image_width,
            image_height=image_height,
            valid=False,
            issues=issues,
            instructions="Retake the photo with your full body visible and the camera placed straight-on.",
        )

    landmarks = tuple(_convert_landmark(index, landmark) for index, landmark in enumerate(pose_landmarks.landmark))
    issues = tuple(validate_pose_landmarks(landmarks, safe_config))
    instructions = build_pose_instructions(issues)
    return PoseDetectionResult(
        landmarks=landmarks,
        image_width=image_width,
        image_height=image_height,
        valid=len(issues) == 0,
        issues=issues,
        instructions=instructions,
    )


def validate_pose_landmarks(
    landmarks: tuple[PoseLandmark, ...] | list[PoseLandmark],
    config: PoseConfig | None = None,
) -> list[str]:
    """Apply the user-defined pose quality rules to the detected landmarks."""

    safe_config = config or PoseConfig()
    if len(landmarks) != 33:
        return ["Expected 33 pose landmarks but did not receive a complete body pose."]

    issues: list[str] = []
    left_shoulder = landmarks[LEFT_SHOULDER]
    right_shoulder = landmarks[RIGHT_SHOULDER]
    left_hip = landmarks[LEFT_HIP]
    right_hip = landmarks[RIGHT_HIP]
    left_ankle = landmarks[LEFT_ANKLE]
    right_ankle = landmarks[RIGHT_ANKLE]

    if min(left_shoulder.visibility, right_shoulder.visibility) < safe_config.shoulder_visibility_threshold:
        issues.append("Both shoulders must be clearly visible. Stand straight and keep upper body fully in frame.")

    if min(left_hip.visibility, right_hip.visibility) < safe_config.hip_visibility_threshold:
        issues.append("Both hips must be clearly visible. Avoid side obstructions and keep legs apart naturally.")

    if min(left_ankle.visibility, right_ankle.visibility) < safe_config.ankle_visibility_threshold:
        issues.append("Both ankles and heels must be visible. Step back so your full lower body stays inside the frame.")

    if abs(left_shoulder.y - right_shoulder.y) > safe_config.max_shoulder_tilt:
        issues.append("Shoulders are tilted. Stand upright with the camera level before retaking the photo.")

    return issues


def build_pose_instructions(issues: tuple[str, ...] | list[str]) -> str:
    if not issues:
        return "Pose looks good. Keep the same stance for the matching front or side capture."

    normalized = " ".join(issues).lower()
    instructions: list[str] = []
    if "shoulder" in normalized:
        instructions.append("Keep both shoulders square to the camera and relax your arms slightly away from your torso.")
    if "hip" in normalized:
        instructions.append("Make sure the camera captures both hips clearly without cropping or heavy shadows.")
    if "ankle" in normalized or "heel" in normalized:
        instructions.append("Step back until your full body, including heels, is visible from head to toe.")
    if "tilted" in normalized or "upright" in normalized:
        instructions.append("Stand tall with level shoulders and keep the phone or camera straight.")
    if not instructions:
        instructions.append("Retake the photo with your full body visible against a clean, well-lit background.")
    return " ".join(dict.fromkeys(instructions))


def landmark_distance_pixels(
    result: PoseDetectionResult,
    first_index: int,
    second_index: int,
) -> float:
    first_x, first_y = result.pixel_landmark(first_index)
    second_x, second_y = result.pixel_landmark(second_index)
    return float(np.hypot(first_x - second_x, first_y - second_y))


def close_pose_estimators() -> None:
    with _POSE_CACHE_LOCK:
        for estimator in _POSE_CACHE.values():
            close = getattr(estimator, "close", None)
            if callable(close):
                close()
        _POSE_CACHE.clear()


def _convert_landmark(index: int, landmark: object) -> PoseLandmark:
    return PoseLandmark(
        index=index,
        name=LANDMARK_NAMES.get(index, f"landmark_{index}"),
        x=float(getattr(landmark, "x", 0.0)),
        y=float(getattr(landmark, "y", 0.0)),
        z=float(getattr(landmark, "z", 0.0)),
        visibility=float(getattr(landmark, "visibility", 0.0)),
    )


def _get_pose_estimator(config: PoseConfig) -> object:
    cache_key = (
        config.static_image_mode,
        config.model_complexity,
        config.min_detection_confidence,
        config.min_tracking_confidence,
    )
    with _POSE_CACHE_LOCK:
        estimator = _POSE_CACHE.get(cache_key)
        if estimator is None:
            estimator = POSE.Pose(
                static_image_mode=config.static_image_mode,
                model_complexity=config.model_complexity,
                min_detection_confidence=config.min_detection_confidence,
                min_tracking_confidence=config.min_tracking_confidence,
            )
            _POSE_CACHE[cache_key] = estimator
        return estimator
