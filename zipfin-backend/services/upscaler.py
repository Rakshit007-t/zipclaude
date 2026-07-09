"""Local AI super-resolution (Real-ESRGAN x2) for try-on output.

Loaded once via spandrel (plain torch, no basicsr) and cached as a singleton.
The 64MB weight file is fetched lazily on first use into storage/upscaler/ —
never during import — and every failure mode degrades to returning the input
unchanged, so generation can never break because of the upscaler.

Runs tiled fp16 on CUDA to coexist with CatVTON on 6GB cards; the caller is
expected to invoke it after diffusion has freed its working memory.
Kill-switch: VTON_SUPERRES=0.
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

MODEL_URL = (
    "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth"
)
MODEL_PATH = Path(__file__).resolve().parents[1] / "storage" / "upscaler" / "RealESRGAN_x2plus.pth"
TILE_SIZE = 224
TILE_OVERLAP = 32

_MODEL = None
_MODEL_LOCK = threading.Lock()
_MODEL_FAILED = False


def available() -> bool:
    return os.getenv("VTON_SUPERRES", "1").strip().lower() not in {"0", "false", "no", "off"}


def _load_model():
    global _MODEL, _MODEL_FAILED
    if _MODEL is not None or _MODEL_FAILED:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is not None or _MODEL_FAILED:
            return _MODEL
        try:
            import torch
            from spandrel import ImageModelDescriptor, ModelLoader

            if not MODEL_PATH.exists() or MODEL_PATH.stat().st_size == 0:
                MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
                logger.info("Downloading Real-ESRGAN x2 weights (~64MB, one-time)...")
                from urllib.request import urlretrieve

                tmp_path = MODEL_PATH.with_suffix(".tmp")
                urlretrieve(MODEL_URL, tmp_path)
                tmp_path.replace(MODEL_PATH)

            descriptor = ModelLoader().load_from_file(str(MODEL_PATH))
            if not isinstance(descriptor, ImageModelDescriptor):
                raise RuntimeError("Unexpected model type for Real-ESRGAN weights.")
            model = descriptor.model.eval()
            if torch.cuda.is_available():
                model = model.to("cuda", dtype=torch.float16)
            _MODEL = (model, descriptor.scale)
            logger.info("Real-ESRGAN x2 ready (scale=%s).", descriptor.scale)
        except Exception:
            _MODEL_FAILED = True  # do not retry a broken setup every request
            logger.exception("Real-ESRGAN unavailable; upscaling disabled.")
    return _MODEL


def upscale_rgb(image_rgb: np.ndarray) -> np.ndarray:
    """2x super-resolution of an HxWx3 uint8 RGB array.

    Returns the input unchanged when the model or GPU is unavailable.
    """
    if not available():
        return image_rgb
    loaded = _load_model()
    if loaded is None:
        return image_rgb
    model, scale = loaded

    import torch

    try:
        with _MODEL_LOCK, torch.no_grad():
            device = next(model.parameters()).device
            dtype = next(model.parameters()).dtype
            src = torch.from_numpy(np.ascontiguousarray(image_rgb)).to(device, dtype=dtype)
            src = src.permute(2, 0, 1).unsqueeze(0) / 255.0

            h, w = src.shape[-2:]
            out = torch.zeros(
                (1, 3, h * scale, w * scale), device=device, dtype=torch.float32
            )
            step = TILE_SIZE - TILE_OVERLAP
            for top in range(0, h, step):
                for left in range(0, w, step):
                    bottom = min(top + TILE_SIZE, h)
                    right = min(left + TILE_SIZE, w)
                    tile = src[..., top:bottom, left:right]
                    sr_tile = model(tile).float().clamp(0, 1)
                    # Interior of the tile only (skip the overlap margin that
                    # a previous tile already wrote), except at the edges.
                    inner_top = 0 if top == 0 else TILE_OVERLAP // 2
                    inner_left = 0 if left == 0 else TILE_OVERLAP // 2
                    out[
                        ...,
                        (top + inner_top) * scale : bottom * scale,
                        (left + inner_left) * scale : right * scale,
                    ] = sr_tile[..., inner_top * scale :, inner_left * scale :]
                    if right >= w:
                        break
                if bottom >= h:
                    break

            result = (out.squeeze(0).permute(1, 2, 0) * 255.0).round().byte().cpu().numpy()
        return result
    except Exception:
        logger.exception("Real-ESRGAN inference failed; returning original image.")
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass
        return image_rgb
