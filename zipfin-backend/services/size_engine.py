import re

from models.schema import SizeEngineRequest, SizeEngineResponse


def calculate_size_recommendation(payload: SizeEngineRequest) -> SizeEngineResponse:
    print(f"size inputs: {payload.dict()}")

    if not payload.range or not payload.brand or not payload.fit:
        raise ValueError("Missing required fields: range, brand, or fit")

    normalized_range = payload.range.strip().upper()
    size_order = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"]

    matched_size = None
    # match exact first
    for s in size_order:
        if s == normalized_range:
            matched_size = s
            break
            
    if not matched_size:
        # fallback search
        for s in sorted(size_order, key=len, reverse=True):
            if s in normalized_range:
                matched_size = s
                break
                
    if not matched_size:
        raise ValueError(f"Could not determine base size from: {payload.range}")

    current_index = size_order.index(matched_size)
    brand = payload.brand.strip().lower()
    fit = payload.fit.strip().lower()

    reason = "True to your profile's base size."

    if "zara" in brand or "hm" in brand or "h&m" in brand:
        if "slim" in fit:
            current_index -= 1
            reason = f"{brand.upper()} slim fit runs small, sizing down."
        elif "relaxed" in fit or "oversized" in fit:
            current_index += 1
            reason = f"{brand.upper()} relaxed fit runs large, sizing up."
        else:
            reason = f"{brand.upper()} regular fit is true to your size."
    elif "shein" in brand:
        current_index += 1
        reason = "SHEIN sizing typically runs small, sizing up."
    else:
        if "slim" in fit:
            current_index -= 1
            reason = "Slim fit styled garments generally require sizing down."
        elif "relaxed" in fit or "oversized" in fit:
            current_index += 1
            reason = "Relaxed fit styled garments generally allow sizing up."

    current_index = max(0, min(len(size_order) - 1, current_index))
    size = size_order[current_index]

    waist_cm = payload.waist_cm or _estimate_waist(payload.chest, fit)
    hip_cm = payload.hip_cm or _estimate_hip(payload.chest, fit)
    measurement_frame = (payload.chest + waist_cm + hip_cm) / 3
    body_index = _estimate_body_index(payload.chest, waist_cm, hip_cm, payload.range)

    confidence = _calculate_confidence(
        payload=payload,
        frame_score=measurement_frame,
        body_index=body_index,
        waist_cm=waist_cm,
        hip_cm=hip_cm,
    )
    risk = _determine_return_risk(confidence)

    return SizeEngineResponse(
        size=size,
        confidence=confidence,
        risk=risk,
        reason=reason,
    )


def _calculate_confidence(
    payload: SizeEngineRequest,
    frame_score: float,
    body_index: float,
    waist_cm: float,
    hip_cm: float,
) -> float:
    bmi_alignment = max(0.0, 1 - abs(body_index - 22) / 18)
    measurement_balance = max(0.0, 1 - abs(payload.chest - hip_cm) / 80)
    waist_balance = max(0.0, 1 - abs(waist_cm - (frame_score * 0.9)) / 70)
    range_consistency = _range_consistency(payload.range)
    completeness_bonus = _input_completeness_bonus(payload)

    fit_bonus = {
        "slim": -2.0,
        "regular": 3.0,
        "relaxed": 1.0,
    }.get(payload.fit.lower(), 0.0)

    confidence = (
        bmi_alignment * 30
        + measurement_balance * 25
        + waist_balance * 20
        + min(frame_score / 120, 1.0) * 10
        + range_consistency * 10
        + completeness_bonus
        + fit_bonus
    )

    brand_adjustment = {
        "zara": -5.0,
        "h&m": 2.0,
        "hm": 2.0,
    }.get(payload.brand.strip().lower(), 0.0)

    adjusted_confidence = max(0.0, min(confidence + brand_adjustment, 99.0))
    return round(adjusted_confidence, 2)


def _determine_return_risk(confidence: float) -> str:
    if confidence > 90:
        return "very low"
    if confidence >= 75:
        return "medium"
    return "high"


def _estimate_waist(chest: int, fit: str) -> float:
    fit_offset = {
        "slim": -10.0,
        "regular": -6.0,
        "relaxed": -2.0,
    }.get(fit.lower(), -6.0)
    return max(55.0, chest + fit_offset)


def _estimate_hip(chest: int, fit: str) -> float:
    fit_offset = {
        "slim": -2.0,
        "regular": 0.0,
        "relaxed": 3.0,
    }.get(fit.lower(), 0.0)
    return max(60.0, chest + fit_offset)


def _estimate_body_index(
    chest: int,
    waist_cm: float,
    hip_cm: float,
    size_range: str,
) -> float:
    balance_score = ((waist_cm / chest) * 0.6) + ((hip_cm / chest) * 0.4)
    range_midpoint = _parse_range_hint(size_range)
    range_factor = 0.0 if range_midpoint is None else (range_midpoint - 100) / 25
    return max(16.0, min(34.0, 20.0 + (balance_score * 4.5) + range_factor))


def _parse_range_hint(size_range: str) -> float | None:
    normalized = size_range.strip().lower()
    token_map = {
        "xs": 84.0,
        "s": 92.0,
        "m": 100.0,
        "l": 108.0,
        "xl": 116.0,
        "xxl": 124.0,
    }

    matched_scores = [
        score
        for token, score in token_map.items()
        if re.search(rf"(?<![a-z]){re.escape(token)}(?![a-z])", normalized)
    ]
    if matched_scores:
        return sum(matched_scores) / len(matched_scores)

    numeric_values = [int(value) for value in re.findall(r"\d+", normalized)]
    if not numeric_values:
        return None

    midpoint = sum(numeric_values) / len(numeric_values)
    if midpoint < 45:
        return 84.0 + ((midpoint - 28.0) * 2.0)
    return midpoint


def _range_consistency(size_range: str) -> float:
    numeric_values = [int(value) for value in re.findall(r"\d+", size_range)]
    if len(numeric_values) >= 2:
        spread = max(numeric_values) - min(numeric_values)
        return max(0.4, 1 - (spread / 20))
    return 0.9


def _input_completeness_bonus(payload: SizeEngineRequest) -> float:
    provided_measurements = sum(
        measurement is not None for measurement in (payload.waist_cm, payload.hip_cm)
    )
    if provided_measurements == 2:
        return 5.0
    if provided_measurements == 1:
        return 2.5
    return 0.0
