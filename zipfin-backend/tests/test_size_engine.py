import asyncio

from models.schema import (
    NormalizedProduct,
    PredictSizeMeasurements,
    SizeEngineProfile,
    SizeEngineRequest,
)
from services.size_engine import build_profile_from_body_metrics, calculate_size_recommendation


def _product(**overrides):
    data = {
        "id": "p1",
        "title": "ZipRIGHT test t-shirt",
        "brand": "ZipRIGHT",
        "category": "tshirt",
        "url": "https://example.com/product",
        "source": "link",
        "confidence": 0.8,
    }
    data.update(overrides)
    return NormalizedProduct(**data)


def _recommend(product, profile):
    return asyncio.run(calculate_size_recommendation(SizeEngineRequest(product=product, profile=profile)))


def test_unavailable_xs_maps_to_closest_stocked_size():
    profile = SizeEngineProfile(
        base_size="M",
        fit_preference="regular",
        chest=86,
        waist=72,
        shoulders=40,
    )
    product = _product(available_sizes=["M", "L", "XL"])

    result = _recommend(product, profile)

    assert result.size == "M"
    assert "available" in result.reason


def test_product_size_chart_changes_recommendation_for_same_profile():
    profile = SizeEngineProfile(
        base_size="M",
        fit_preference="regular",
        chest=99,
        waist=80,
        shoulders=43,
    )
    tighter_product = _product(
        id="tight",
        title="Tighter cut t-shirt",
        size_chart={"S": 96, "M": 104, "L": 112},
        available_sizes=["S", "M", "L"],
    )
    roomier_product = _product(
        id="roomy",
        title="Roomier cut t-shirt",
        size_chart={"XS": 92, "S": 100, "M": 108},
        available_sizes=["XS", "S", "M"],
    )

    tighter_result = _recommend(tighter_product, profile)
    roomier_result = _recommend(roomier_product, profile)

    assert tighter_result.size == "M"
    assert roomier_result.size == "S"
    assert tighter_result.size != roomier_result.size


def test_predict_profile_can_use_selected_usual_size():
    profile = build_profile_from_body_metrics(
        174,
        PredictSizeMeasurements(chest=86, waist=70, shoulders=40),
        "regular",
        "L",
    )

    assert profile.base_size == "L"
