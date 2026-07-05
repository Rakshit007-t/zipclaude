"""Virtual try-on orchestrator: local CatVTON -> free HF Space -> caller's fallback.

Completely free chain — no paid APIs. Order is controlled by VTON_PROVIDERS
(comma-separated: "local", "cloud"), default "local,cloud".
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


class VtonError(RuntimeError):
    """Every configured try-on provider failed."""


def _providers() -> list[str]:
    raw = os.getenv("VTON_PROVIDERS", "local,cloud")
    ordered = [item.strip().lower() for item in raw.split(",") if item.strip()]
    return [item for item in ordered if item in {"local", "cloud"}] or ["local", "cloud"]


def generate_vton_image(
    *,
    person_image_bytes: bytes,
    garment_image_bytes: bytes,
    cloth_type: str = "auto",
    quality: str = "hd",
    progress_callback=None,
) -> tuple[bytes, str]:
    """Returns (png_bytes, engine_name). Raises VtonError when all providers fail.

    progress_callback, when given, receives (fraction_0_to_1, stage_label).
    """
    errors: list[str] = []

    for provider in _providers():
        if provider == "local":
            try:
                from services.local_catvton_engine import LocalVtonError, generate_local_tryon

                image_bytes = generate_local_tryon(
                    person_image_bytes=person_image_bytes,
                    garment_image_bytes=garment_image_bytes,
                    cloth_type=cloth_type,
                    quality=quality,
                    progress_callback=progress_callback,
                )
                return image_bytes, "catvton"
            except Exception as exc:
                errors.append(f"local: {exc}")
                logger.warning("Local CatVTON failed, trying next provider: %s", exc)
        elif provider == "cloud":
            try:
                from services.cloud_catvton_engine import CloudVtonError, generate_cloud_tryon

                if progress_callback:
                    progress_callback(0.1, "Sending to free cloud renderer")
                image_bytes = generate_cloud_tryon(
                    person_image_bytes=person_image_bytes,
                    garment_image_bytes=garment_image_bytes,
                    cloth_type=cloth_type,
                    quality=quality,
                    progress_callback=progress_callback,
                )
                return image_bytes, "catvton_cloud"
            except Exception as exc:
                errors.append(f"cloud: {exc}")
                logger.warning("Cloud CatVTON failed, trying next provider: %s", exc)

    raise VtonError("; ".join(errors) or "No try-on providers configured.")
