from __future__ import annotations

from dataclasses import dataclass


class MeasurementExtractionError(ValueError):
    """Raised when measurements cannot be safely extracted."""


@dataclass(frozen=True)
class MeasurementResult:
    measurements: dict[str, float]
    confidences: dict[str, float]
    warnings: list[str]


def extract_measurements(*args, **kwargs) -> MeasurementResult:
    """Modules 4 and 5 placeholder."""

    raise NotImplementedError("Measurement extraction will be implemented in the next module.")
