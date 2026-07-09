"""Provider-modular AI stylist: local LLM first, cloud fallback second.

The /stylist API contract is unchanged — this module only decides which brain
answers. Provider order comes from STYLIST_PROVIDERS (default
"ollama,gemini"):

  ollama  — fully local, no API keys, no cost. Talks to an Ollama server at
            OLLAMA_HOST (default http://localhost:11434) running
            OLLAMA_STYLIST_MODEL (default qwen2.5:3b, fits a 6GB GPU).
  openai  — any OpenAI-compatible /v1/chat/completions endpoint. This is the
            production scale-out seam: point OPENAI_COMPAT_BASE_URL at a
            vLLM or TensorRT-LLM server running an open-weight model
            (Qwen 3 / Gemma 3 / Llama 3.3) and set STYLIST_PROVIDERS=openai.
            No code changes needed to scale.
  gemini  — the pre-existing cloud path (services.gemini_inference), kept as
            fallback and as proof the provider seam works both ways.

When the caller passes a user id, the shopper's context is injected so advice
is personal without ever echoing raw numbers back:
  - Fit Profile (Smart Fit measurements, usual size, fit preference, brand)
  - derived body shape (rule-based from chest/waist/hip/shoulder ratios)
  - recent purchase & recommendation history (size_feedback outcomes)
"""

from __future__ import annotations

import asyncio
import logging
import os

import httpx

logger = logging.getLogger(__name__)

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL_ENV = "OLLAMA_STYLIST_MODEL"
OLLAMA_DEFAULT_MODEL = "qwen2.5:3b"
# First call after idle loads the model into VRAM; allow for it.
OLLAMA_TIMEOUT_SECONDS = 90.0
MAX_REPLY_BULLETS = 6  # up to 5 outfit bullets + the trailing "Why:" bullet

FALLBACK_REPLY = "Try a navy polo + tapered chinos + clean white sneakers + lightweight overshirt."

SYSTEM_PROMPT = """You are the AI fashion stylist inside a shopping app called ZipRIGHT.

Give sharp, practical, stylish outfit advice: outfit combinations, color
matching, occasion and seasonal recommendations, and body-shape aware tips.

Rules:
- Answer with 3-5 short bullets, each starting with "- ".
- Always cover: outfit (top + bottom), footwear, one optional add-on.
- End with one bullet starting "Why:" explaining the reasoning in one sentence.
- If fit profile context is provided, tailor silhouettes to it (e.g. drape,
  rise, fit) but NEVER repeat the person's measurements back to them.
- Avoid generic answers like "white shirt + trousers" unless asked.
- No preamble, no closing remarks — bullets only.

Tone: confident, modern, minimal fluff."""


async def generate_stylist_reply(message: str, user_id: str = "") -> str:
    user_message = (message or "").strip()
    if not user_message:
        return "I only help with fashion styling."

    fit_context = await _load_fit_context(user_id) if user_id else ""

    for provider in _providers():
        try:
            if provider == "ollama":
                reply = await _ollama_reply(user_message, fit_context)
            elif provider == "openai":
                reply = await _openai_compatible_reply(user_message, fit_context)
            elif provider == "gemini":
                from services.gemini_inference import generate_stylist_reply as gemini_reply

                reply = await gemini_reply(user_message)
            else:
                continue
            formatted = _format_reply(reply)
            if formatted:
                return formatted
        except Exception as exc:
            logger.warning("Stylist provider '%s' failed: %s", provider, exc)

    return f"* {FALLBACK_REPLY}"


def _providers() -> list[str]:
    raw = os.getenv("STYLIST_PROVIDERS", "ollama,gemini")
    ordered = [item.strip().lower() for item in raw.split(",") if item.strip()]
    allowed = {"ollama", "openai", "gemini"}
    return [item for item in ordered if item in allowed] or ["ollama", "gemini"]


async def _openai_compatible_reply(message: str, fit_context: str) -> str:
    """vLLM / TensorRT-LLM / llama.cpp all speak this protocol.

    Deploying at scale means running e.g. `vllm serve Qwen/Qwen3-8B` and
    pointing OPENAI_COMPAT_BASE_URL at it — the stylist API stays identical.
    """
    base_url = os.getenv("OPENAI_COMPAT_BASE_URL", "").strip().rstrip("/")
    if not base_url:
        raise RuntimeError("OPENAI_COMPAT_BASE_URL is not configured.")
    model = os.getenv("OPENAI_COMPAT_MODEL", "").strip()
    if not model:
        raise RuntimeError("OPENAI_COMPAT_MODEL is not configured.")

    user_content = message if not fit_context else f"{fit_context}\n\nQuestion: {message}"
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.6,
        "max_tokens": 320,
    }
    headers = {}
    api_key = os.getenv("OPENAI_COMPAT_API_KEY", "").strip()  # vLLM often runs keyless
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
        response = await client.post(
            f"{base_url}/v1/chat/completions", json=body, headers=headers
        )
        response.raise_for_status()
        payload = response.json()
    choices = payload.get("choices") or [{}]
    reply = str(((choices[0].get("message") or {}).get("content")) or "").strip()
    if len(reply) < 20:
        raise RuntimeError("OpenAI-compatible endpoint returned an empty reply.")
    return reply


async def _ollama_reply(message: str, fit_context: str) -> str:
    model = os.getenv(OLLAMA_MODEL_ENV, OLLAMA_DEFAULT_MODEL).strip() or OLLAMA_DEFAULT_MODEL
    user_content = message if not fit_context else f"{fit_context}\n\nQuestion: {message}"
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "stream": False,
        "options": {"temperature": 0.6, "num_predict": 320},
        # Keep the model warm between requests but let Ollama evict it when
        # the GPU is needed elsewhere (e.g. a try-on render).
        "keep_alive": "10m",
    }
    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
        response = await client.post(f"{OLLAMA_HOST}/api/chat", json=body)
        response.raise_for_status()
        payload = response.json()
    reply = str(((payload.get("message") or {}).get("content")) or "").strip()
    if len(reply) < 20:
        raise RuntimeError("Ollama returned an empty/too-short reply.")
    return reply


def _body_shape_label(smart_fit: dict) -> str:
    """Rule-based body shape from measurement ratios; '' when data is thin."""
    chest = smart_fit.get("chest")
    waist = smart_fit.get("waist")
    hips = smart_fit.get("hips")
    values = [v for v in (chest, waist, hips) if isinstance(v, (int, float)) and v > 0]
    if len(values) < 3:
        return ""
    if waist <= 0.78 * min(chest, hips):
        return "hourglass"
    if chest - hips >= 6:
        return "inverted triangle (broader top)"
    if hips - chest >= 6:
        return "pear (broader hips)"
    if waist >= 0.92 * min(chest, hips):
        return "rectangle (straight)"
    return "balanced"


def _history_summary(user_id: str) -> str:
    """Recent purchases + how our recommendations worked out, for styling cues."""
    from services.calibration_service import _feedback_docs

    docs = _feedback_docs("user_id", user_id)
    if not docs:
        return ""
    lines: list[str] = []
    for doc in docs[-5:]:
        title = str(doc.get("product_title") or "").strip()
        brand = str(doc.get("brand") or "").strip()
        outcome = str(doc.get("outcome") or "")
        if not title and not brand:
            continue
        item = " ".join(part for part in (brand, title) if part)
        if outcome == "kept":
            lines.append(f"kept {item}")
        elif outcome.startswith("returned"):
            lines.append(f"returned {item} ({outcome.removeprefix('returned_').replace('_', ' ')})")
    return "; ".join(lines[:5])


async def _load_fit_context(user_id: str) -> str:
    """Compact shopper summary for the prompt; empty string on any failure."""

    def _fetch() -> str:
        from firebase_config import get_firestore_client

        snapshot = get_firestore_client().collection("users").document(user_id).get()
        payload = (snapshot.to_dict() or {}) if snapshot.exists else {}
        parts: list[str] = []
        if payload.get("usualSize"):
            parts.append(f"usual size {payload['usualSize']}")
        if payload.get("fitPreference"):
            parts.append(f"prefers a {payload['fitPreference']} fit")
        if payload.get("preferredBrand"):
            parts.append(f"likes {payload['preferredBrand']}")
        smart_fit = payload.get("smartFit")
        if isinstance(smart_fit, dict):
            shape = _body_shape_label(smart_fit)
            if shape:
                parts.append(f"body shape: {shape}")
            measurements = ", ".join(
                f"{key} {value:.0f}cm"
                for key, value in smart_fit.items()
                if isinstance(value, (int, float)) and value > 0
                and key in {"chest", "waist", "hips", "shoulders", "legs", "arms"}
            )
            if measurements:
                parts.append(f"body measurements: {measurements}")
        history = _history_summary(user_id)
        if history:
            parts.append(f"recent purchases: {history}")
        if not parts:
            return ""
        return "Shopper fit profile (context only, do not repeat): " + "; ".join(parts)

    try:
        return await asyncio.to_thread(_fetch)
    except Exception as exc:
        logger.debug("Fit context unavailable for stylist (user=%s): %s", user_id, exc)
        return ""


def _format_reply(raw_text: str) -> str:
    """Normalize any provider's output to <=5 clean '*' bullets."""
    lines = [line.strip() for line in (raw_text or "").replace("\r", "\n").splitlines()]
    bullets: list[str] = []
    for line in lines:
        normalized = " ".join(line.lstrip("-*• ").split())
        if not normalized:
            continue
        bullets.append(f"* {normalized}")
        if len(bullets) == MAX_REPLY_BULLETS:
            break
    return "\n".join(bullets)
