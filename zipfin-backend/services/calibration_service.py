"""Feedback-driven size calibration — the rule-based core of the learning loop.

    User Scan -> Measurement Extraction -> Size Recommendation -> Purchase
    -> Feedback (POST /size-feedback -> Firestore `size_feedback`)
    -> Calibration Update (this module) -> Improved Future Recommendations

The size engine asks this module one question — "given this brand / category /
product / user, how should the base recommendation shift, and how trustworthy
has it been?" — and gets back a plain CalibrationSignal. Everything else
(which granularity wins, sample thresholds, caching) is internal, so a
learned model can replace `_signal_from_outcomes` later without touching
size_engine or any API.

Granularities, most specific first (a specific signal needs fewer samples
because its evidence is more homogeneous):
  product        >= 3 samples
  brand+category >= 4 samples
  brand          >= 5 samples  (matches the previous brand-only behavior)
plus an independent per-user signal (>= 4 samples) capturing a shopper whose
measurements systematically run ahead/behind our estimates.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

FEEDBACK_COLLECTION = "size_feedback"
VALID_OUTCOMES = {"kept", "returned_too_small", "returned_too_large"}
SKEW_THRESHOLD = 0.4
MIN_SAMPLES = {"product": 3, "brand+category": 4, "brand": 5, "user": 4}
CACHE_TTL_SECONDS = 600.0
QUERY_LIMIT = 300

_CACHE: dict[tuple[str, str], tuple[float, list[dict]]] = {}
_CACHE_LOCK = threading.Lock()


@dataclass(frozen=True)
class CalibrationSignal:
    """What the feedback history says about a recommendation before it ships."""

    step: int = 0  # -1 = size down, +1 = size up (already clamped)
    label: str = ""  # human-readable cause, e.g. "runs small"
    source: str = ""  # granularity that produced the step
    samples: int = 0  # records backing the step decision
    keep_rate: float | None = None  # observed kept-fraction at that granularity
    confidence_delta: float = 0.0  # bounded confidence adjustment from outcomes
    notes: list[str] = field(default_factory=list)


def calibration_for(
    *,
    brand: str = "",
    category: str = "",
    product_id: str = "",
    user_id: str = "",
) -> CalibrationSignal:
    """Combine item-level and user-level feedback into one bounded signal.

    Never raises: any storage failure degrades to the neutral signal, exactly
    like the previous brand-only calibration did.
    """
    try:
        # Coerce to str first: a None from any caller must never raise here and
        # silently disable the entire calibration layer (brand + product +
        # category), which is exactly what an unguarded .strip() did.
        return _calibration_for(
            brand=str(brand or "").strip(),
            category=str(category or "").strip().lower(),
            product_id=str(product_id or "").strip(),
            user_id=str(user_id or "").strip(),
        )
    except Exception as exc:
        logger.debug("Calibration unavailable (brand=%r): %s", brand, exc)
        return CalibrationSignal()


def _calibration_for(*, brand: str, category: str, product_id: str, user_id: str) -> CalibrationSignal:
    brand_docs = _feedback_docs("brand", brand) if brand else []

    item_signal = None
    for source, docs in (
        ("product", _feedback_docs("product_id", product_id) if product_id else []),
        ("brand+category", [d for d in brand_docs if str(d.get("category", "")).lower() == category] if category else []),
        ("brand", brand_docs),
    ):
        candidate = _signal_from_outcomes(docs, source)
        if candidate is not None:
            item_signal = candidate
            break

    user_signal = _signal_from_outcomes(
        _feedback_docs("user_id", user_id) if user_id else [], "user"
    )

    item_step = item_signal.step if item_signal else 0
    user_step = user_signal.step if user_signal else 0
    step = max(-1, min(1, item_step + user_step))

    primary = item_signal or user_signal or CalibrationSignal()
    notes = []
    if item_signal and item_signal.step:
        if item_signal.source == "product":
            notes.append(f"feedback on this product shows it {item_signal.label}")
        elif item_signal.source == "brand+category":
            notes.append(f"shopper feedback shows {brand} {category} {item_signal.label}")
        else:
            notes.append(f"shopper feedback shows {brand} {item_signal.label}")
    if user_signal and user_signal.step:
        direction = "up" if user_signal.step > 0 else "down"
        notes.append(f"your fit history suggests sizing {direction}")

    return CalibrationSignal(
        step=step,
        label=primary.label,
        source=primary.source,
        samples=primary.samples,
        keep_rate=primary.keep_rate,
        confidence_delta=primary.confidence_delta,
        notes=notes,
    )


def _signal_from_outcomes(docs: list[dict], source: str) -> CalibrationSignal | None:
    """Turn raw feedback docs into a step decision for one granularity.

    Returns None when there is not enough evidence, so the caller can fall
    through to a broader granularity.
    """
    total = too_small = too_large = kept = 0
    for doc in docs:
        if not doc.get("followed_recommendation", True):
            continue
        outcome = str(doc.get("outcome", ""))
        if outcome not in VALID_OUTCOMES:
            continue
        total += 1
        if outcome == "returned_too_small":
            too_small += 1
        elif outcome == "returned_too_large":
            too_large += 1
        else:
            kept += 1

    if total < MIN_SAMPLES.get(source, 5):
        return None

    step, label = 0, ""
    if too_small / total >= SKEW_THRESHOLD:
        step, label = 1, "runs small"
    elif too_large / total >= SKEW_THRESHOLD:
        step, label = -1, "runs large"

    keep_rate = kept / total
    # Outcome-calibrated confidence: recommendations that historically stick
    # earn a small boost; ones that keep coming back get honestly riskier.
    if step == 0 and keep_rate >= 0.8:
        confidence_delta = 0.02
    elif keep_rate < 0.5:
        confidence_delta = -0.06
    else:
        confidence_delta = 0.0

    if step == 0 and confidence_delta == 0.0:
        # Balanced-but-mediocre evidence: nothing actionable at this level,
        # but do not fall through to a broader (less relevant) granularity.
        return CalibrationSignal(source=source, samples=total, keep_rate=keep_rate)

    return CalibrationSignal(
        step=step,
        label=label,
        source=source,
        samples=total,
        keep_rate=keep_rate,
        confidence_delta=confidence_delta,
    )


def _feedback_docs(fieldname: str, value: str) -> list[dict]:
    """Fetch (with a short TTL cache) feedback records matching one filter."""
    if not value:
        return []
    key = (fieldname, value.lower())
    now = time.monotonic()
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
        if cached and now - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]

    docs = _fetch_feedback_docs(fieldname, value)

    with _CACHE_LOCK:
        _CACHE[key] = (now, docs)
    return docs


def _fetch_feedback_docs(fieldname: str, value: str) -> list[dict]:
    """Single seam to the storage backend — replaceable/mockable in tests."""
    from firebase_config import get_firestore_client

    client = get_firestore_client()
    stream = (
        client.collection(FEEDBACK_COLLECTION)
        .where(fieldname, "==", value)
        .limit(QUERY_LIMIT)
        .stream()
    )
    return [doc.to_dict() or {} for doc in stream]


def clear_cache() -> None:
    """Testing/ops helper: drop memoized feedback aggregates."""
    with _CACHE_LOCK:
        _CACHE.clear()
