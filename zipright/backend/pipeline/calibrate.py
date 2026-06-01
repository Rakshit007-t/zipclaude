from __future__ import annotations

from dataclasses import dataclass


class CalibrationError(ValueError):
    """Raised when height-based scale calibration cannot be trusted."""


@dataclass(frozen=True)
class ScaleCalibrationResult:
    head_top_px: float
    foot_bottom_px: float
    height_px: float
    scale_cm_per_px: float


def calibrate_scale(*args, **kwargs) -> ScaleCalibrationResult:
    """Module 3 placeholder. To be implemented after preprocessing and pose are locked."""

    raise NotImplementedError("Scale calibration is the next module to implement.")
