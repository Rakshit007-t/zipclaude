from __future__ import annotations

import logging
import threading
import time

from models.schema import (
    NormalizedProduct,
    PredictSizeMeasurements,
    SizeEngineProfile,
    SizeEngineRequest,
    SizeEngineResponse,
)

logger = logging.getLogger(__name__)

SIZE_SCALE = ["XS", "S", "M", "L", "XL", "XXL"]
SIZE_ALIASES = {
    "2XL": "XXL",
    "XX-L": "XXL",
    "XX LARGE": "XXL",
    "XX-LARGE": "XXL",
    "EXTRA EXTRA LARGE": "XXL",
}
SIZE_BANDS = {
    "tshirt": [
        {"size": "XS", "chest": (84.0, 92.0)},
        {"size": "S", "chest": (92.0, 100.0)},
        {"size": "M", "chest": (100.0, 108.0)},
        {"size": "L", "chest": (108.0, 117.0)},
        {"size": "XL", "chest": (117.0, 126.0)},
        {"size": "XXL", "chest": (126.0, 135.0)},
    ],
    "shirt": [
        {"size": "XS", "chest": (86.0, 94.0), "shoulders": (39.0, 43.0)},
        {"size": "S", "chest": (94.0, 102.0), "shoulders": (42.0, 45.0)},
        {"size": "M", "chest": (102.0, 109.0), "shoulders": (44.0, 47.0)},
        {"size": "L", "chest": (109.0, 117.0), "shoulders": (45.0, 49.0)},
        {"size": "XL", "chest": (117.0, 126.0), "shoulders": (48.0, 52.0)},
        {"size": "XXL", "chest": (126.0, 135.0), "shoulders": (51.0, 55.0)},
    ],
    "pants": [
        {"size": "XS", "waist": (68.0, 74.0), "legs": (94.0, 100.0), "hips": (84.0, 90.0)},
        {"size": "S", "waist": (74.0, 80.0), "legs": (96.0, 102.0), "hips": (90.0, 96.0)},
        {"size": "M", "waist": (80.0, 86.0), "legs": (98.0, 104.0), "hips": (96.0, 102.0)},
        {"size": "L", "waist": (86.0, 94.0), "legs": (100.0, 106.0), "hips": (102.0, 110.0)},
        {"size": "XL", "waist": (94.0, 102.0), "legs": (102.0, 108.0), "hips": (110.0, 118.0)},
        {"size": "XXL", "waist": (102.0, 110.0), "legs": (104.0, 110.0), "hips": (118.0, 126.0)},
    ],
}
FIT_ADJUSTMENTS = {
    "slim": -0.05,
    "regular": 0.0,
    "relaxed": 0.0,
    "loose": 0.07,
    "baggy": 0.07,
}
BUFFER_CM = 2.0
SIZE_CHART_STEP_CM = 5.08
SIZE_CHART_TOLERANCE_CM = 1.0


async def calculate_size_recommendation(payload: SizeEngineRequest) -> SizeEngineResponse:
    product = payload.product
    profile = payload.profile
    normalized_category = _normalize_category(product.title, product.category)

    measurement_result = _recommend_from_product_size_chart(product, profile, normalized_category)
    used_product_chart = measurement_result is not None
    if not used_product_chart:
        measurement_result = _recommend_from_measurements(profile, normalized_category)
    if measurement_result is None:
        raise ValueError("Insufficient data")
    if not used_product_chart:
        measurement_result = _apply_base_size_prior(measurement_result, profile)
    measurement_result = _apply_product_context(measurement_result, product, profile)
    measurement_result = _apply_brand_calibration(measurement_result, product, normalized_category)

    confidence = round(measurement_result["confidence"] * 100, 2)
    return SizeEngineResponse(
        size=measurement_result["size"],
        confidence=confidence,
        risk=_risk_from_confidence(confidence),
        reason=measurement_result["reason"],
    )


def _normalize_category(title: str, category: str) -> str:
    text = f"{title} {category}".lower()
    if any(keyword in text for keyword in ("pant", "trouser", "jean", "short")):
        return "pants"
    if "shirt" in text and "tshirt" not in text and "t-shirt" not in text and "tee" not in text:
        return "shirt"
    return "tshirt"


def _fit_adjustment(fit_preference: str) -> int:
    fit = (fit_preference or "").lower()
    if fit in {"loose", "baggy"}:
        return 1
    if fit == "slim":
        return -1
    return 0


def _recommend_from_product_size_chart(
    product: NormalizedProduct,
    profile: SizeEngineProfile,
    category: str,
) -> dict[str, float | str] | None:
    if category not in {"tshirt", "shirt"}:
        return None

    chest = _positive(profile.chest or profile.bust)
    if chest is None:
        return None

    size_chart = _normalize_size_chart(product.size_chart)
    if not size_chart:
        return None

    expanded_chart, inferred = _expand_sparse_chart(size_chart)
    base_size = _pick_chart_size(expanded_chart, chest)
    if base_size is None:
        return None

    fit_step = _fit_adjustment(profile.fit_preference)
    size = _size_with_step(base_size, fit_step)
    confidence = _chart_confidence(
        chest=chest,
        chart_value=expanded_chart.get(base_size),
        inferred=inferred,
        adjusted=fit_step != 0,
    )
    chest_inches = chest / 2.54
    chart_inches = (expanded_chart.get(base_size) or chest) / 2.54
    if fit_step:
        direction = "up" if fit_step > 0 else "down"
        reason = (
            f"Product chest chart maps {chest_inches:.1f} in closest to {base_size}; "
            f"{profile.fit_preference} fit sizes {direction} to {size}"
        )
    else:
        reason = (
            f"Product chest chart maps {chest_inches:.1f} in to {size} "
            f"({chart_inches:.0f} in chest)"
        )

    return {"size": size, "confidence": confidence, "reason": reason}


def _normalize_size_chart(size_chart: dict[str, float] | None) -> dict[str, float]:
    if not isinstance(size_chart, dict):
        return {}

    normalized: dict[str, float] = {}
    for raw_size, raw_value in size_chart.items():
        size = _normalize_size_key(raw_size)
        value = _normalize_chart_value_cm(raw_value)
        if size and value is not None:
            normalized[size] = value
    return normalized


def _normalize_size_key(raw_size: object) -> str:
    size = str(raw_size or "").strip().upper()
    if size in SIZE_SCALE:
        return size
    compact_size = size.replace(".", "").replace(" ", "").replace("-", "")
    if compact_size in SIZE_SCALE:
        return compact_size
    return SIZE_ALIASES.get(size) or SIZE_ALIASES.get(compact_size, "")


def _normalize_chart_value_cm(raw_value: object) -> float | None:
    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    if value < 70:
        value *= 2.54
    if value > 220:
        return None
    return round(value, 2)


def _expand_sparse_chart(size_chart: dict[str, float]) -> tuple[dict[str, float], bool]:
    if len(size_chart) != 1:
        return size_chart, False

    known_size, known_value = next(iter(size_chart.items()))
    known_index = SIZE_SCALE.index(known_size)
    expanded: dict[str, float] = {}
    for index, size in enumerate(SIZE_SCALE):
        projected_value = known_value + ((index - known_index) * SIZE_CHART_STEP_CM)
        if projected_value > 0:
            expanded[size] = round(projected_value, 2)
    return expanded, True


def _pick_chart_size(size_chart: dict[str, float], chest_cm: float) -> str | None:
    ranked_sizes = sorted(size_chart, key=SIZE_SCALE.index)
    for size in ranked_sizes:
        if chest_cm <= size_chart[size] + SIZE_CHART_TOLERANCE_CM:
            return size
    return ranked_sizes[-1] if ranked_sizes else None


def _size_with_step(size: str, step: int) -> str:
    index = SIZE_SCALE.index(size)
    next_index = max(0, min(len(SIZE_SCALE) - 1, index + step))
    return SIZE_SCALE[next_index]


def _apply_base_size_prior(
    result: dict[str, float | str],
    profile: SizeEngineProfile,
) -> dict[str, float | str]:
    size = _normalize_size_key(result.get("size"))
    base_size = _normalize_size_key(profile.base_size)
    if not size or not base_size:
        return result

    size_index = SIZE_SCALE.index(size)
    base_index = SIZE_SCALE.index(base_size)
    if abs(size_index - base_index) < 2:
        return result

    direction = 1 if base_index > size_index else -1
    adjusted_size = _size_with_step(size, direction)
    return {
        **result,
        "size": adjusted_size,
        "confidence": max(0.65, float(result["confidence"]) - 0.05),
        "reason": (
            f"{result['reason']}; saved usual size {base_size} keeps fallback "
            f"recommendation closer to profile"
        ),
    }


def _apply_product_context(
    result: dict[str, float | str],
    product: NormalizedProduct,
    profile: SizeEngineProfile,
) -> dict[str, float | str]:
    size = _normalize_size_key(result.get("size"))
    if not size:
        return result

    adjusted = dict(result)
    product_step, fit_label = _product_fit_step(product)
    if product_step:
        fit_adjusted_size = _size_with_step(size, product_step)
        if fit_adjusted_size != size:
            size = fit_adjusted_size
            adjusted["size"] = fit_adjusted_size
            adjusted["confidence"] = max(0.65, float(adjusted["confidence"]) - 0.03)
            adjusted["reason"] = f"{adjusted['reason']}; adjusted for {fit_label} product fit"

    available_sizes = _available_size_keys(product)
    if not available_sizes:
        return adjusted

    available_size = _nearest_available_size(size, available_sizes, profile.fit_preference)
    if available_size == size:
        adjusted["confidence"] = min(0.99, float(adjusted["confidence"]) + 0.01)
        return adjusted

    adjusted["size"] = available_size
    adjusted["confidence"] = max(0.62, float(adjusted["confidence"]) - 0.04)
    adjusted["reason"] = f"{adjusted['reason']}; closest available stocked size is {available_size}"
    return adjusted


def _available_size_keys(product: NormalizedProduct) -> list[str]:
    sizes: list[str] = []
    for raw_size in product.available_sizes or []:
        size = _normalize_size_key(raw_size)
        if size and size not in sizes:
            sizes.append(size)

    if not sizes:
        for size in _normalize_size_chart(product.size_chart):
            if size not in sizes:
                sizes.append(size)

    return sorted(sizes, key=SIZE_SCALE.index)


def _nearest_available_size(size: str, available_sizes: list[str], fit_preference: str) -> str:
    target_index = SIZE_SCALE.index(size)
    prefer_smaller = fit_preference == "slim"

    def rank(candidate: str) -> tuple[int, int]:
        candidate_index = SIZE_SCALE.index(candidate)
        distance = abs(candidate_index - target_index)
        tie_breaker = candidate_index if prefer_smaller else -candidate_index
        return distance, tie_breaker

    return min(available_sizes, key=rank)


def _product_fit_step(product: NormalizedProduct) -> tuple[int, str]:
    text = " ".join(
        str(value or "").lower()
        for value in (
            product.fit_hint,
            product.title,
            product.category,
            product.size_format,
        )
    )
    if any(term in text for term in ("compression", "tight fit", "muscle fit", "skinny fit", "slim fit")):
        return 1, "slim"
    if any(term in text for term in ("oversized", "oversize", "boxy", "baggy")):
        return -1, "roomy"
    return 0, ""


def _chart_confidence(
    *,
    chest: float,
    chart_value: float | None,
    inferred: bool,
    adjusted: bool,
) -> float:
    if chart_value is None:
        return 0.78
    gap = abs(chart_value - chest)
    confidence = 0.94 - min(gap, 12.0) / 60.0
    if inferred:
        confidence -= 0.04
    if adjusted:
        confidence -= 0.03
    return max(0.7, min(0.97, confidence))


def _recommend_from_measurements(profile: SizeEngineProfile, category: str) -> dict[str, float | str] | None:
    if category == "tshirt":
        chest = _positive(profile.chest or profile.bust)
        if chest is None:
            return None
        return _score_size_band(
            size_bands=SIZE_BANDS["tshirt"],
            measurements={"chest": chest},
            weights={"chest": 1.0},
            fit_preference=profile.fit_preference,
            explanation_template="Chest fits {size} range comfortably",
        )

    if category == "shirt":
        chest = _positive(profile.chest or profile.bust)
        shoulders = _positive(profile.shoulders)
        if chest is None or shoulders is None:
            return None
        return _score_size_band(
            size_bands=SIZE_BANDS["shirt"],
            measurements={"chest": chest, "shoulders": shoulders},
            weights={"chest": 0.7, "shoulders": 0.3},
            fit_preference=profile.fit_preference,
            explanation_template="Chest and shoulder fit place you in {size}",
        )

    waist = _positive(profile.waist)
    inseam = _positive(profile.legs)
    hips = _positive(profile.hips)
    if waist is None or inseam is None:
        return None
    measurements = {"waist": waist, "legs": inseam}
    weights = {"waist": 0.7, "legs": 0.3}
    if hips is not None:
        measurements["hips"] = hips
        weights = {"waist": 0.55, "legs": 0.2, "hips": 0.25}
    return _score_size_band(
        size_bands=SIZE_BANDS["pants"],
        measurements=measurements,
        weights=weights,
        fit_preference=profile.fit_preference,
        explanation_template="Waist, hip and inseam fit align best with {size}",
    )


def _score_size_band(
    *,
    size_bands: list[dict[str, object]],
    measurements: dict[str, float],
    weights: dict[str, float],
    fit_preference: str,
    explanation_template: str,
) -> dict[str, float | str]:
    best_band: dict[str, object] | None = None
    best_score = -1.0

    for band in size_bands:
        score_sum = 0.0
        weight_sum = 0.0
        for measurement_name, weight in weights.items():
            value = measurements.get(measurement_name)
            band_range = band.get(measurement_name)
            if value is None or not isinstance(band_range, tuple):
                continue
            score_sum += weight * _range_score(value, band_range[0], band_range[1], BUFFER_CM)
            weight_sum += weight
        if weight_sum <= 0:
            continue
        score = score_sum / weight_sum
        score += FIT_ADJUSTMENTS.get((fit_preference or "").lower(), 0.0)
        if score > best_score:
            best_score = score
            best_band = band

    if best_band is None:
        raise ValueError("Insufficient data")

    bounded_score = max(0.0, min(0.99, best_score))
    size = str(best_band["size"])
    return {
        "size": size,
        "confidence": bounded_score,
        "reason": explanation_template.format(size=size),
    }


def _range_score(value: float, minimum: float, maximum: float, buffer_cm: float) -> float:
    buffered_min = minimum - buffer_cm
    buffered_max = maximum + buffer_cm
    if value < buffered_min or value > buffered_max:
        overflow = min(abs(value - buffered_min), abs(value - buffered_max))
        return max(0.0, 0.35 - (overflow / 10.0))

    center = (minimum + maximum) / 2.0
    spread = max(((maximum - minimum) / 2.0) + buffer_cm, 1.0)
    normalized_distance = abs(value - center) / spread
    return max(0.45, 1.0 - (normalized_distance * 0.4))


def _positive(value: float | None) -> float | None:
    if value is None:
        return None
    if value <= 0:
        return None
    return float(value)


def _risk_from_confidence(confidence: float) -> str:
    if confidence >= 85:
        return "low"
    if confidence >= 70:
        return "medium"
    return "high"


def build_profile_from_body_metrics(
    height_cm: float,
    measurements: PredictSizeMeasurements | None = None,
    fit_preference: str = "regular",
    base_size: str | None = None,
) -> SizeEngineProfile:
    if measurements is None:
        raise ValueError("Insufficient data")

    measurement_payload = measurements
    chest = measurement_payload.chest or measurement_payload.bust
    waist = measurement_payload.waist
    shoulders = measurement_payload.shoulders
    if chest is None or waist is None:
        raise ValueError("Insufficient data")

    estimated_base_size = _estimate_base_size(chest, waist, height_cm)
    normalized_base_size = _normalize_size_key(base_size) or estimated_base_size
    return SizeEngineProfile(
        base_size=normalized_base_size,
        fit_preference=fit_preference or "regular",
        chest=chest,
        waist=waist,
        shoulders=shoulders,
        hips=measurement_payload.hips,
        legs=measurement_payload.legs,
        bust=measurement_payload.bust,
    )


def _estimate_base_size(chest_cm: float, waist_cm: float, height_cm: float) -> str:
    del height_cm
    anchor = max(chest_cm, waist_cm + 8)
    thresholds = [
        (88, "XS"),
        (96, "S"),
        (104, "M"),
        (112, "L"),
        (120, "XL"),
    ]

    base_size = "XXL"
    for limit, size in thresholds:
        if anchor <= limit:
            base_size = size
            break

    return base_size


# --- Brand calibration from real outcomes -----------------------------------
# Reads aggregated size_feedback (kept / returned_too_small / returned_too_large)
# and shifts recommendations for brands that consistently run small or large.
# This is the loop that actually raises accuracy over time: every logged
# outcome makes the next recommendation for that brand better.

_BRAND_STATS_CACHE: dict[str, tuple[float, tuple[int, str]]] = {}
_BRAND_STATS_TTL_SECONDS = 600.0
_BRAND_STATS_LOCK = threading.Lock()
_BRAND_MIN_SAMPLES = 5
_BRAND_SKEW_THRESHOLD = 0.4


def _brand_calibration_step(brand: str) -> tuple[int, str]:
    key = brand.strip().lower()
    if not key:
        return 0, ""

    now = time.monotonic()
    with _BRAND_STATS_LOCK:
        cached = _BRAND_STATS_CACHE.get(key)
        if cached and now - cached[0] < _BRAND_STATS_TTL_SECONDS:
            return cached[1]

    step, label = 0, ""
    try:
        from firebase_config import get_firestore_client

        client = get_firestore_client()
        docs = (
            client.collection("size_feedback")
            .where("brand", "==", brand.strip())
            .limit(200)
            .stream()
        )
        total = too_small = too_large = 0
        for doc in docs:
            record = doc.to_dict() or {}
            if not record.get("followed_recommendation", True):
                continue
            outcome = str(record.get("outcome", ""))
            if outcome not in {"kept", "returned_too_small", "returned_too_large"}:
                continue
            total += 1
            if outcome == "returned_too_small":
                too_small += 1
            elif outcome == "returned_too_large":
                too_large += 1

        if total >= _BRAND_MIN_SAMPLES:
            if too_small / total >= _BRAND_SKEW_THRESHOLD:
                step, label = 1, "runs small"
            elif too_large / total >= _BRAND_SKEW_THRESHOLD:
                step, label = -1, "runs large"
    except Exception as exc:
        logger.debug("Brand calibration unavailable for '%s': %s", brand, exc)

    with _BRAND_STATS_LOCK:
        _BRAND_STATS_CACHE[key] = (now, (step, label))
    return step, label


def _apply_brand_calibration(
    result: dict[str, float | str],
    product: NormalizedProduct,
    category: str,
) -> dict[str, float | str]:
    del category
    size = _normalize_size_key(result.get("size"))
    brand = (product.brand or "").strip()
    if not size or not brand:
        return result

    step, label = _brand_calibration_step(brand)
    if not step:
        return result

    adjusted_size = _size_with_step(size, step)
    if adjusted_size == size:
        return result

    return {
        **result,
        "size": adjusted_size,
        "confidence": min(0.99, float(result["confidence"]) + 0.02),
        "reason": (
            f"{result['reason']}; shopper feedback shows {brand} {label}, "
            f"so we recommend {adjusted_size}"
        ),
    }
