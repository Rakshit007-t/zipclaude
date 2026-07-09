import pytest

from services import calibration_service, stylist_engine
from services.stylist_engine import _body_shape_label, _format_reply, _history_summary, _providers


def test_body_shape_labels():
    assert _body_shape_label({"chest": 100, "waist": 70, "hips": 98}) == "hourglass"
    assert _body_shape_label({"chest": 108, "waist": 90, "hips": 96}) == "inverted triangle (broader top)"
    assert _body_shape_label({"chest": 92, "waist": 84, "hips": 104}) == "pear (broader hips)"
    assert _body_shape_label({"chest": 96, "waist": 90, "hips": 98}) == "rectangle (straight)"
    assert _body_shape_label({"chest": 96, "waist": 90}) == ""  # not enough data


def test_history_summary_uses_feedback_docs(monkeypatch):
    docs = [
        {"product_title": "Crew tee", "brand": "TightCo", "outcome": "kept"},
        {"product_title": "Slim jeans", "brand": "DenimCo", "outcome": "returned_too_small"},
        {"outcome": "kept"},  # no identifying info -> skipped
    ]
    monkeypatch.setattr(calibration_service, "_feedback_docs", lambda field, value: docs)
    summary = _history_summary("u1")
    assert "kept TightCo Crew tee" in summary
    assert "returned DenimCo Slim jeans (too small)" in summary


def test_history_summary_empty_without_docs(monkeypatch):
    monkeypatch.setattr(calibration_service, "_feedback_docs", lambda field, value: [])
    assert _history_summary("u1") == ""


def test_providers_env_parsing(monkeypatch):
    monkeypatch.delenv("STYLIST_PROVIDERS", raising=False)
    assert _providers() == ["ollama", "gemini"]
    monkeypatch.setenv("STYLIST_PROVIDERS", "openai")
    assert _providers() == ["openai"]
    monkeypatch.setenv("STYLIST_PROVIDERS", "bogus, ollama")
    assert _providers() == ["ollama"]


def test_format_reply_caps_and_normalizes():
    raw = "\n".join(f"- bullet {i}" for i in range(10))
    formatted = _format_reply(raw)
    lines = formatted.splitlines()
    assert len(lines) == 6
    assert all(line.startswith("* ") for line in lines)
    assert _format_reply("") == ""


@pytest.mark.anyio
async def test_openai_provider_requires_config(monkeypatch):
    monkeypatch.delenv("OPENAI_COMPAT_BASE_URL", raising=False)
    with pytest.raises(RuntimeError):
        await stylist_engine._openai_compatible_reply("hi", "")
