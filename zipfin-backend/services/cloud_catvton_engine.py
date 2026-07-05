"""Free CatVTON via the public Hugging Face Space (no API key, no cost).

Used as a fallback when local GPU generation is unavailable. Public Spaces
have shared queues and can be paused — every failure mode maps to
CloudVtonError so the caller can degrade further.
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
import threading

logger = logging.getLogger(__name__)

SPACE_ID = os.getenv("CATVTON_SPACE_ID", "zhengchong/CatVTON")

CLOTH_TYPE_MAP = {
    "upper_body": "upper",
    "lower_body": "lower",
    "dress": "overall",
    "auto": "upper",
}

_CLIENT = None
_CLIENT_LOCK = threading.Lock()


class CloudVtonError(RuntimeError):
    """The free Hugging Face Space is unavailable or failed."""


def _get_client():
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT
    with _CLIENT_LOCK:
        if _CLIENT is None:
            import httpx
            from gradio_client import Client

            logger.info("Connecting to Hugging Face Space '%s'...", SPACE_ID)
            # Generous write/read timeouts: uploads share bandwidth with model
            # downloads and slow connections.
            timeout = httpx.Timeout(60.0, connect=30.0, read=180.0, write=180.0)
            try:
                _CLIENT = Client(SPACE_ID, httpx_kwargs={"timeout": timeout})
            except TypeError:
                # older gradio_client without httpx_kwargs
                _CLIENT = Client(SPACE_ID)
        return _CLIENT


def generate_cloud_tryon(
    *,
    person_image_bytes: bytes,
    garment_image_bytes: bytes,
    cloth_type: str = "auto",
    quality: str = "hd",
    progress_callback=None,
) -> bytes:
    try:
        from gradio_client import handle_file
        from PIL import Image
    except ImportError as exc:
        raise CloudVtonError("gradio_client is not installed.") from exc

    steps = 40 if quality == "fast" else 50

    with tempfile.TemporaryDirectory() as tmp_dir:
        person_path = os.path.join(tmp_dir, "person.png")
        garment_path = os.path.join(tmp_dir, "garment.png")
        blank_layer_path = os.path.join(tmp_dir, "layer.png")
        try:
            from PIL import ImageOps

            def _shrink(img):
                # The Space renders at 768x1024 — uploading 4000px phone
                # photos just times out slow connections for zero quality.
                img = ImageOps.exif_transpose(img.convert("RGB"))
                img.thumbnail((1024, 1024))
                return img

            person = _shrink(Image.open(io.BytesIO(person_image_bytes)))
            person.save(person_path, format="JPEG", quality=90)
            _shrink(Image.open(io.BytesIO(garment_image_bytes))).save(
                garment_path, format="JPEG", quality=90
            )
            # All-black layer = "no manual mask" -> Space runs its own
            # DensePose auto-masker, which beats our local approximation.
            Image.new("L", person.size, 0).save(blank_layer_path)
        except Exception as exc:
            raise CloudVtonError(f"Invalid input image: {exc}") from exc

        try:
            import time as _time

            client = _get_client()

            def _submit():
                return client.submit(
                    person_image={
                        "background": handle_file(person_path),
                        "layers": [handle_file(blank_layer_path)],
                        "composite": None,
                    },
                    cloth_image=handle_file(garment_path),
                    cloth_type=CLOTH_TYPE_MAP.get(cloth_type, "upper"),
                    num_inference_steps=steps,
                    guidance_scale=2.5,
                    seed=-1,
                    show_type="result only",
                    api_name="/submit_function",
                )

            try:
                job = _submit()
            except Exception as submit_error:
                # One retry: uploads often fail transiently when bandwidth is
                # saturated (e.g. model downloads running in parallel).
                logger.warning("Space submit failed once (%s); retrying.", submit_error)
                _time.sleep(3)
                job = _submit()
            # The Space gives no true percentage; estimate against a typical
            # ~75s render so the bar keeps moving honestly (capped at 90%).
            started = _time.monotonic()
            while not job.done():
                if progress_callback:
                    elapsed = _time.monotonic() - started
                    fraction = 0.15 + min(elapsed / 75.0, 1.0) * 0.75
                    progress_callback(min(fraction, 0.9), "Rendering on free cloud GPU")
                _time.sleep(2)
            result = job.result()
        except Exception as exc:
            raise CloudVtonError(f"Hugging Face Space call failed: {exc}") from exc

        result_path = result if isinstance(result, str) else getattr(result, "path", None)
        if not result_path or not os.path.exists(result_path):
            raise CloudVtonError("Hugging Face Space returned no image.")

        with open(result_path, "rb") as handle:
            image_bytes = handle.read()

    if not image_bytes:
        raise CloudVtonError("Hugging Face Space returned an empty image.")
    logger.info("Cloud CatVTON generated %d bytes via Space '%s'.", len(image_bytes), SPACE_ID)
    return image_bytes
