from __future__ import annotations

import json
import os
from typing import TypedDict

import httpx

GEMINI_TIMEOUT_SECONDS = 0.8
GEMINI_MODEL = "gemini-1.5-flash"
STYLIST_TIMEOUT_SECONDS = 6.0
STYLIST_FALLBACK_TIMEOUT_SECONDS = 18.0
STYLIST_MODEL_CANDIDATES = (
    "gemini-2.5-flash",
    "gemini-2.5-pro",
)
STYLIST_PROMPT_TEMPLATE = """
You are an AI fashion stylist inside a product called Zipright.

Your job is to give sharp, practical, and stylish outfit recommendations.

Rules:
- Keep answers concise (2-4 bullets max)
- Never repeat the same outfit combinations
- Adapt based on context:
    • Formal -> clean, structured outfits
    • Casual -> relaxed, everyday wear
    • Competition / fancy dress -> bold, standout, creative looks
    • Presentation -> smart, confident, polished looks

- Always include:
    • Outfit (top + bottom)
    • Footwear
    • Optional add-on (layer / accessory)

- Avoid generic answers like "white shirt + trousers" unless explicitly needed
- Prioritize variety, style, and real-world wearability

Tone:
Confident, modern, Gen-Z aware, minimal fluff.

USER INPUT
{user_msg}

Answer:
"""
STYLIST_DEFAULT_REPLY = "Try a navy polo + tapered chinos + clean white sneakers + lightweight overshirt."


class ProductSignals(TypedDict):
    category: str
    fit_hint: str


async def infer_product_signals(title: str, category_hint: str) -> ProductSignals | None:
    api_key = _resolve_gemini_api_key()
    if not api_key:
        return None

    prompt = (
        "Infer clothing category and fit hint from this product.\n"
        "Return strict JSON only with keys: category, fit_hint.\n"
        "Allowed category: tshirt, shirt, jacket.\n"
        "Allowed fit_hint: slim, regular, relaxed, oversized.\n"
        f"title: {title}\n"
        f"category_hint: {category_hint or ''}"
    )

    endpoint = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    )
    headers = {"Content-Type": "application/json"}
    body = {"contents": [{"parts": [{"text": prompt}]}]}

    try:
        async with httpx.AsyncClient(timeout=GEMINI_TIMEOUT_SECONDS) as client:
            response = await client.post(
                endpoint,
                params={"key": api_key},
                json=body,
                headers=headers,
            )
            response.raise_for_status()
            payload = response.json()
    except Exception:
        return None

    text = _extract_text(payload)
    if not text:
        return None

    parsed = _parse_json_payload(text)
    if parsed is None:
        return None

    category = str(parsed.get("category", "")).strip().lower()
    fit_hint = str(parsed.get("fit_hint", "")).strip().lower()
    if category not in {"tshirt", "shirt", "jacket"}:
        category = ""
    if fit_hint not in {"slim", "regular", "relaxed", "oversized"}:
        fit_hint = ""
    if not category and not fit_hint:
        return None
    return {"category": category, "fit_hint": fit_hint}


async def generate_stylist_reply(message: str) -> str:
    user_message = (message or "").strip()
    if not user_message:
        return "I only help with fashion styling."

    api_key = _resolve_gemini_api_key()
    if not api_key:
        raise RuntimeError("Missing Gemini API key.")

    headers = {"Content-Type": "application/json"}
    body = {
        "contents": [
            {
                "parts": [
                    {
                        "text": STYLIST_PROMPT_TEMPLATE.format(user_msg=user_message)
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.25,
            "maxOutputTokens": 140,
        },
    }

    last_error: Exception | None = None
    for model, timeout_seconds in _stylist_models_with_timeout():
        endpoint = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        )
        try:
            async with httpx.AsyncClient(timeout=timeout_seconds) as client:
                response = await client.post(
                    endpoint,
                    params={"key": api_key},
                    json=body,
                    headers=headers,
                )
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPStatusError as exc:
            last_error = exc
            continue
        except Exception as exc:
            last_error = exc
            continue

        reply = _extract_stylist_text(payload)
        reply = reply.strip()
        if len(reply) < 20:
            reply = STYLIST_DEFAULT_REPLY
        return _format_stylist_reply(reply)

    if last_error:
        return _format_stylist_reply(STYLIST_DEFAULT_REPLY)
    return _format_stylist_reply(STYLIST_DEFAULT_REPLY)


def _extract_text(payload: dict) -> str:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""
    candidate = candidates[0] or {}
    content = candidate.get("content") or {}
    parts = content.get("parts")
    if not isinstance(parts, list):
        return ""
    for part in parts:
        if isinstance(part, dict) and isinstance(part.get("text"), str):
            return part["text"]
    return ""


def _extract_stylist_text(payload: dict) -> str:
    reply = (
        payload.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )
    return str(reply or "").strip()


def _resolve_gemini_api_key() -> str:
    return (
        os.getenv("GEMINI_API_KEY", "").strip()
        or os.getenv("GOOGLE_API_KEY", "").strip()
    )


def _stylist_models_with_timeout() -> list[tuple[str, float]]:
    preferred = os.getenv("GEMINI_STYLIST_MODEL", "").strip()
    ordered_models = [preferred] if preferred else []
    ordered_models.extend(STYLIST_MODEL_CANDIDATES)

    unique_models: list[str] = []
    for model in ordered_models:
        if model and model not in unique_models:
            unique_models.append(model)

    model_timeout: list[tuple[str, float]] = []
    for model in unique_models:
        timeout_seconds = (
            STYLIST_FALLBACK_TIMEOUT_SECONDS
            if model.endswith("2.5-pro")
            else STYLIST_TIMEOUT_SECONDS
        )
        model_timeout.append((model, timeout_seconds))
    return model_timeout


def _format_stylist_reply(raw_text: str) -> str:
    reply = (raw_text or "").strip()
    if len(reply) < 20:
        reply = STYLIST_DEFAULT_REPLY

    lines = [line.strip() for line in reply.replace("\r", "\n").splitlines() if line.strip()]
    if not lines:
        lines = [reply]

    bullets: list[str] = []
    for line in lines:
        normalized = " ".join(line.lstrip("-*• ").split())
        if not normalized:
            continue
        bullets.append(f"* {normalized}")
        if len(bullets) == 4:
            break

    if not bullets:
        return f"* {STYLIST_DEFAULT_REPLY}"

    return "\n".join(bullets)


def _parse_json_payload(raw_text: str) -> dict | None:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    try:
        parsed = json.loads(text)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None
