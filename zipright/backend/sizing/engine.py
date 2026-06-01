from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SizeRecommendation:
    recommended_size: str
    confidence: float
    alternatives: list[dict[str, float | str]]
    fit_notes: list[str]


def recommend_size(*args, **kwargs) -> SizeRecommendation:
    """Module 7 placeholder."""

    raise NotImplementedError("Size recommendation will be implemented after measurement validation.")
