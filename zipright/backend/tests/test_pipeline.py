from __future__ import annotations

import numpy as np

from zipright.backend.pipeline.pose import LEFT_SHOULDER, RIGHT_SHOULDER, PoseLandmark, validate_pose_landmarks
from zipright.backend.pipeline.preprocess import (
    BoundingBox,
    apply_clahe_rgb,
    calculate_silhouette_metrics,
    resize_and_pad_image,
)


def _landmarks_with_defaults() -> list[PoseLandmark]:
    return [
        PoseLandmark(index=index, name=f"landmark_{index}", x=0.5, y=0.5, z=0.0, visibility=1.0)
        for index in range(33)
    ]


def test_resize_and_pad_image_preserves_square_target() -> None:
    image = np.full((200, 100, 3), 40, dtype=np.uint8)
    resized, metadata = resize_and_pad_image(image, target_size=512)
    assert resized.shape == (512, 512, 3)
    assert metadata.resized_height == 512
    assert metadata.resized_width == 256
    assert metadata.pad_left == 128
    assert metadata.pad_right == 128


def test_apply_clahe_rgb_preserves_shape_and_dtype() -> None:
    image = np.full((64, 64, 3), 128, dtype=np.uint8)
    enhanced = apply_clahe_rgb(image)
    assert enhanced.shape == image.shape
    assert enhanced.dtype == np.uint8


def test_calculate_silhouette_metrics_reports_fill_ratio() -> None:
    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[20:80, 30:70] = 255
    contour = np.array([[[30, 20]], [[69, 20]], [[69, 79]], [[30, 79]]], dtype=np.int32)
    metrics = calculate_silhouette_metrics(mask, contour, BoundingBox(x=30, y=20, width=40, height=60))
    assert metrics.silhouette_area > 0
    assert 0.95 <= metrics.fill_ratio <= 1.05


def test_validate_pose_landmarks_flags_tilted_shoulders() -> None:
    landmarks = _landmarks_with_defaults()
    landmarks[LEFT_SHOULDER] = PoseLandmark(
        index=LEFT_SHOULDER,
        name="left_shoulder",
        x=0.4,
        y=0.3,
        z=0.0,
        visibility=1.0,
    )
    landmarks[RIGHT_SHOULDER] = PoseLandmark(
        index=RIGHT_SHOULDER,
        name="right_shoulder",
        x=0.6,
        y=0.4,
        z=0.0,
        visibility=1.0,
    )
    issues = validate_pose_landmarks(landmarks)
    assert any("tilted" in issue.lower() for issue in issues)
