import asyncio

import pytest

from models.schema import NormalizedProduct, SizeEngineProfile, SizeEngineRequest
from services import calibration_service
from services.calibration_service import CalibrationSignal, calibration_for
from services.size_engine import calculate_size_recommendation


def _doc(outcome="kept", followed=True, category="tshirt"):
    return {
        "outcome": outcome,
        "followed_recommendation": followed,
        "category": category,
    }


@pytest.fixture(autouse=True)
def _fresh_cache():
    calibration_service.clear_cache()
    yield
    calibration_service.clear_cache()


@pytest.fixture
def fake_feedback(monkeypatch):
    """Route _fetch_feedback_docs to an in-memory store keyed by (field, value)."""
    store: dict[tuple[str, str], list[dict]] = {}

    def _fetch(fieldname, value):
        return store.get((fieldname, value), [])

    monkeypatch.setattr(calibration_service, "_fetch_feedback_docs", _fetch)
    return store


def test_brand_runs_small_steps_up(fake_feedback):
    fake_feedback[("brand", "TightCo")] = [_doc("returned_too_small")] * 3 + [_doc("kept")] * 2
    signal = calibration_for(brand="TightCo")
    assert signal.step == 1
    assert signal.source == "brand"
    assert "TightCo" in signal.notes[0]


def test_brand_runs_large_steps_down(fake_feedback):
    fake_feedback[("brand", "BigCo")] = [_doc("returned_too_large")] * 4 + [_doc("kept")] * 2
    assert calibration_for(brand="BigCo").step == -1


def test_none_user_id_does_not_disable_calibration(fake_feedback):
    # Regression: the public/widget path historically passed user_id=None,
    # which raised inside calibration_for and silently returned a neutral
    # signal — disabling brand calibration for every storefront shopper.
    fake_feedback[("brand", "TightCo")] = [_doc("returned_too_small")] * 5
    signal = calibration_for(brand="TightCo", user_id=None)
    assert signal.step == 1
    assert signal.source == "brand"


def test_none_args_are_neutral_not_crashing(fake_feedback):
    # Fully-None inputs must degrade to a neutral signal, never raise.
    assert calibration_for(brand=None, category=None, product_id=None, user_id=None) == CalibrationSignal()


def test_insufficient_samples_is_neutral(fake_feedback):
    fake_feedback[("brand", "NewCo")] = [_doc("returned_too_small")] * 4  # below brand min of 5
    signal = calibration_for(brand="NewCo")
    assert signal.step == 0
    assert signal.source == ""


def test_product_granularity_beats_brand(fake_feedback):
    fake_feedback[("brand", "MixedCo")] = [_doc("returned_too_small")] * 5
    fake_feedback[("product_id", "p42")] = [_doc("returned_too_large")] * 3
    signal = calibration_for(brand="MixedCo", product_id="p42")
    assert signal.step == -1
    assert signal.source == "product"


def test_brand_category_granularity_beats_brand(fake_feedback):
    fake_feedback[("brand", "SplitCo")] = (
        [_doc("returned_too_large", category="pants")] * 4
        + [_doc("returned_too_small", category="tshirt")] * 4
    )
    signal = calibration_for(brand="SplitCo", category="tshirt")
    assert signal.step == 1
    assert signal.source == "brand+category"


def test_user_signal_combines_and_clamps(fake_feedback):
    fake_feedback[("brand", "TightCo")] = [_doc("returned_too_small")] * 5
    fake_feedback[("user_id", "u1")] = [_doc("returned_too_small")] * 4
    assert calibration_for(brand="TightCo", user_id="u1").step == 1  # clamped, not +2

    fake_feedback[("user_id", "u2")] = [_doc("returned_too_large")] * 4
    assert calibration_for(brand="TightCo", user_id="u2").step == 0  # opposing signals cancel


def test_not_followed_recommendations_are_excluded(fake_feedback):
    fake_feedback[("brand", "IgnoredCo")] = [_doc("returned_too_small", followed=False)] * 10
    assert calibration_for(brand="IgnoredCo").step == 0


def test_confidence_delta_from_keep_rate(fake_feedback):
    fake_feedback[("brand", "GreatCo")] = [_doc("kept")] * 9 + [_doc("returned_too_small")] * 1
    good = calibration_for(brand="GreatCo")
    assert good.step == 0
    assert good.confidence_delta == pytest.approx(0.02)

    fake_feedback[("brand", "BadCo")] = (
        [_doc("kept")] * 2 + [_doc("returned_too_small")] * 4 + [_doc("returned_too_large")] * 4
    )
    bad = calibration_for(brand="BadCo")
    assert bad.confidence_delta == pytest.approx(-0.06)


def test_storage_failure_degrades_to_neutral(monkeypatch):
    def _boom(fieldname, value):
        raise RuntimeError("firestore down")

    monkeypatch.setattr(calibration_service, "_fetch_feedback_docs", _boom)
    assert calibration_for(brand="AnyCo") == CalibrationSignal()


def test_size_engine_applies_calibration_step(fake_feedback):
    fake_feedback[("brand", "TightCo")] = [_doc("returned_too_small")] * 5
    product = NormalizedProduct(
        id="p1",
        title="TightCo crew tee",
        brand="TightCo",
        category="tshirt",
        url="https://example.com/p",
        source="link",
        confidence=0.8,
    )
    profile = SizeEngineProfile(
        base_size="M", fit_preference="regular", chest=104.0, waist=84.0
    )
    result = asyncio.run(
        calculate_size_recommendation(SizeEngineRequest(product=product, profile=profile))
    )
    assert result.size == "L"  # chest 104 maps to M; brand runs small -> L
    assert "TightCo" in result.reason
