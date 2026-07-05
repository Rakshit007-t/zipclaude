"""Local CatVTON inference on the user's GPU (RTX 3050 6GB target).

Loads the CatVTON pipeline (vendored repo in vendor/CatVTON) lazily as a
singleton and serializes generations with a lock — 6GB VRAM cannot run two
diffusions at once. The garment-region mask is built from MediaPipe pose
landmarks because CatVTON's own AutoMasker needs detectron2/DensePose, which
does not build on Windows.
"""

from __future__ import annotations

import io
import logging
import os
import sys
import threading
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

VENDOR_DIR = Path(__file__).resolve().parent.parent / "vendor" / "CatVTON"

BASE_MODEL_REPO = os.getenv("CATVTON_BASE_MODEL", "booksforcharlie/stable-diffusion-inpainting")
ATTN_REPO = os.getenv("CATVTON_ATTN_REPO", "zhengchong/CatVTON")

# width, height, steps — sized for 6GB VRAM
QUALITY_PRESETS = {
    "fast": (384, 512, 25),
    "hd": (576, 768, 30),
    "2k": (768, 1024, 40),
}

_PIPELINE = None
_PIPELINE_LOCK = threading.Lock()
_GENERATION_LOCK = threading.Lock()
_PIPELINE_ERROR: str | None = None

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


class LocalVtonError(RuntimeError):
    """Local CatVTON generation is unavailable or failed."""


class WeightsNotReadyError(LocalVtonError):
    """Weights are still downloading — transient, do not cache as fatal."""


def weights_available() -> bool:
    """True when every model repo is fully cached locally.

    Requests must never trigger multi-GB downloads — weights are fetched by a
    separate pre-download step, and until then the caller should skip straight
    to the cloud provider.
    """
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id=ATTN_REPO,
            allow_patterns=["mix-48k-1024/attention/*"],
            local_files_only=True,
        )
        snapshot_download(
            repo_id=BASE_MODEL_REPO,
            allow_patterns=["scheduler/*", "unet/*", "vae/*", "*.json"],
            ignore_patterns=["*.ckpt"],
            local_files_only=True,
        )
        snapshot_download(
            repo_id="stabilityai/sd-vae-ft-mse",
            allow_patterns=["*.json", "*.safetensors", "*.bin"],
            local_files_only=True,
        )
        return True
    except Exception:
        return False


def _load_pipeline():
    global _PIPELINE, _PIPELINE_ERROR
    if _PIPELINE is not None:
        return _PIPELINE
    with _PIPELINE_LOCK:
        if _PIPELINE is not None:
            return _PIPELINE
        if _PIPELINE_ERROR is not None:
            raise LocalVtonError(_PIPELINE_ERROR)
        try:
            import torch

            if not torch.cuda.is_available():
                raise LocalVtonError("CUDA GPU not available for local CatVTON.")
            if not weights_available():
                raise WeightsNotReadyError(
                    "Model weights not downloaded yet; requests must not "
                    "trigger the download."
                )

            if str(VENDOR_DIR) not in sys.path:
                sys.path.insert(0, str(VENDOR_DIR))
            from huggingface_hub import snapshot_download
            from model.pipeline import CatVTONPipeline  # noqa: E501 (vendored)

            attn_path = snapshot_download(
                repo_id=ATTN_REPO,
                allow_patterns=["mix-48k-1024/attention/*"],
            )
            logger.info("Loading CatVTON pipeline (base=%s)...", BASE_MODEL_REPO)
            pipeline = CatVTONPipeline(
                base_ckpt=BASE_MODEL_REPO,
                attn_ckpt=attn_path,
                attn_ckpt_version="mix",
                weight_dtype=torch.float16,
                device="cuda",
                skip_safety_check=True,
                use_tf32=True,
            )
            # Memory savers for 6GB cards.
            try:
                pipeline.unet.set_attention_slice("auto")
            except Exception:
                pass
            try:
                pipeline.vae.enable_slicing()
                pipeline.vae.enable_tiling()
            except Exception:
                pass
            _PIPELINE = pipeline
            logger.info("CatVTON pipeline ready.")
            return _PIPELINE
        except WeightsNotReadyError:
            raise
        except LocalVtonError as exc:
            _PIPELINE_ERROR = str(exc)
            raise
        except Exception as exc:  # keep the reason; don't retry a broken setup every request
            _PIPELINE_ERROR = f"CatVTON pipeline failed to load: {exc}"
            logger.exception("CatVTON pipeline failed to load.")
            raise LocalVtonError(_PIPELINE_ERROR) from exc


def _detect_landmarks(image_bgr: np.ndarray):
    import mediapipe as mp

    pose = mp.solutions.pose.Pose(
        static_image_mode=True,
        model_complexity=1,
        enable_segmentation=False,
        min_detection_confidence=0.5,
    )
    try:
        results = pose.process(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB))
    finally:
        pose.close()
    if not results.pose_landmarks:
        return None
    return results.pose_landmarks.landmark


def _pt(lm, index: int, w: int, h: int) -> tuple[float, float] | None:
    mark = lm[index]
    if (mark.visibility or 1.0) < 0.35:
        return None
    return (float(mark.x) * w, float(mark.y) * h)


def _thick_limb(mask: np.ndarray, points: list[tuple[float, float] | None], thickness: int) -> None:
    chain = [p for p in points if p is not None]
    for start, end in zip(chain, chain[1:]):
        cv2.line(
            mask,
            (int(start[0]), int(start[1])),
            (int(end[0]), int(end[1])),
            255,
            thickness=max(thickness, 8),
        )


def build_garment_mask(person_bgr: np.ndarray, cloth_type: str) -> np.ndarray:
    """Binary mask (uint8, 255 = repaint region) for the garment area."""
    h, w = person_bgr.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    lm = _detect_landmarks(person_bgr)

    if lm is None:
        # No pose: fall back to a generous centered region.
        top, bottom = (0.16, 0.62) if cloth_type in {"upper_body", "auto"} else (0.40, 0.95)
        if cloth_type == "dress":
            top, bottom = 0.16, 0.95
        cv2.rectangle(mask, (int(w * 0.18), int(h * top)), (int(w * 0.82), int(h * bottom)), 255, -1)
        return mask

    ls, rs = _pt(lm, 11, w, h), _pt(lm, 12, w, h)
    lh, rh = _pt(lm, 23, w, h), _pt(lm, 24, w, h)
    if ls is None or rs is None:
        cv2.rectangle(mask, (int(w * 0.18), int(h * 0.16)), (int(w * 0.82), int(h * 0.62)), 255, -1)
        return mask

    shoulder_w = max(abs(rs[0] - ls[0]), 24.0)
    hip_y = (lh[1] + rh[1]) / 2 if lh and rh else min(ls[1], rs[1]) + shoulder_w * 1.6
    hip_w = abs(rh[0] - lh[0]) if lh and rh else shoulder_w * 0.9
    neck_y = min(ls[1], rs[1]) - shoulder_w * 0.35
    pad_x = shoulder_w * 0.45

    left_x = min(ls[0], rs[0]) - pad_x
    right_x = max(ls[0], rs[0]) + pad_x
    hip_left = (min(lh[0], rh[0]) if lh and rh else left_x) - hip_w * 0.35
    hip_right = (max(lh[0], rh[0]) if lh and rh else right_x) + hip_w * 0.35

    limb_thickness = int(shoulder_w * 0.42)

    if cloth_type in {"upper_body", "auto", "dress"}:
        torso_bottom = hip_y + shoulder_w * 0.25
        torso = np.array(
            [
                [left_x, neck_y],
                [right_x, neck_y],
                [hip_right, torso_bottom],
                [hip_left, torso_bottom],
            ],
            dtype=np.int32,
        )
        cv2.fillPoly(mask, [torso], 255)
        # Arms (sleeves live there)
        _thick_limb(mask, [ls, _pt(lm, 13, w, h), _pt(lm, 15, w, h)], limb_thickness)
        _thick_limb(mask, [rs, _pt(lm, 14, w, h), _pt(lm, 16, w, h)], limb_thickness)

    if cloth_type in {"lower_body", "dress"}:
        la, ra = _pt(lm, 27, w, h), _pt(lm, 28, w, h)
        ankle_y = max(
            la[1] if la else 0,
            ra[1] if ra else 0,
            hip_y + shoulder_w * 2.2,
        )
        pelvis = np.array(
            [
                [hip_left, hip_y - shoulder_w * 0.2],
                [hip_right, hip_y - shoulder_w * 0.2],
                [hip_right, ankle_y],
                [hip_left, ankle_y],
            ],
            dtype=np.int32,
        )
        if cloth_type == "lower_body":
            # Legs only: pelvis band + leg limbs, not the full rectangle
            pelvis[2][1] = pelvis[3][1] = int(hip_y + shoulder_w * 0.8)
        cv2.fillPoly(mask, [pelvis], 255)
        _thick_limb(mask, [lh, _pt(lm, 25, w, h), la], limb_thickness)
        _thick_limb(mask, [rh, _pt(lm, 26, w, h), ra], limb_thickness)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))
    mask = cv2.dilate(mask, kernel, iterations=1)
    mask = cv2.GaussianBlur(mask, (31, 31), 0)
    _, mask = cv2.threshold(mask, 32, 255, cv2.THRESH_BINARY)
    return mask


def generate_local_tryon(
    *,
    person_image_bytes: bytes,
    garment_image_bytes: bytes,
    cloth_type: str = "auto",
    quality: str = "hd",
    progress_callback=None,
) -> bytes:
    """Run CatVTON locally. Raises LocalVtonError when unavailable/failed.

    progress_callback, when given, receives (fraction_0_to_1, stage_label).
    """
    from PIL import Image, ImageOps

    if not weights_available():
        raise WeightsNotReadyError("Model weights are still downloading.")

    if progress_callback:
        progress_callback(0.02, "Loading AI model")
    pipeline = _load_pipeline()
    width, height, steps = QUALITY_PRESETS.get(quality, QUALITY_PRESETS["hd"])

    try:
        person_pil = ImageOps.exif_transpose(
            Image.open(io.BytesIO(person_image_bytes)).convert("RGB")
        )
        garment_pil = ImageOps.exif_transpose(
            Image.open(io.BytesIO(garment_image_bytes)).convert("RGB")
        )
        # 4000px phone photos slow down masking and VAE encode for nothing —
        # the pipeline renders at <=768x1024 anyway.
        person_pil.thumbnail((1536, 1536))
        garment_pil.thumbnail((1024, 1024))
    except Exception as exc:
        raise LocalVtonError(f"Invalid input image: {exc}") from exc

    person_bgr = cv2.cvtColor(np.array(person_pil), cv2.COLOR_RGB2BGR)
    mask_array = build_garment_mask(person_bgr, cloth_type)
    mask_pil = Image.fromarray(mask_array, mode="L")

    import torch

    def _step_callback(step: int, total: int) -> None:
        if progress_callback:
            fraction = 0.08 + (step / max(total, 1)) * 0.85
            progress_callback(min(fraction, 0.93), f"Rendering on your GPU ({step}/{total})")

    with _GENERATION_LOCK:
        try:
            if progress_callback:
                progress_callback(0.06, "Detecting your pose")
            generator = torch.Generator(device="cuda").seed()
            generator_obj = torch.Generator(device="cuda")
            generator_obj.manual_seed(generator)
            result = pipeline(
                image=person_pil,
                condition_image=garment_pil,
                mask=mask_pil,
                num_inference_steps=steps,
                guidance_scale=2.5,
                height=height,
                width=width,
                generator=generator_obj,
                step_callback=_step_callback,
            )[0]
        except torch.cuda.OutOfMemoryError as exc:
            torch.cuda.empty_cache()
            if quality != "fast":
                logger.warning("CatVTON OOM at quality '%s'; retrying at 'fast'.", quality)
                return generate_local_tryon(
                    person_image_bytes=person_image_bytes,
                    garment_image_bytes=garment_image_bytes,
                    cloth_type=cloth_type,
                    quality="fast",
                    progress_callback=progress_callback,
                )
            raise LocalVtonError("GPU ran out of memory.") from exc
        except Exception as exc:
            raise LocalVtonError(f"CatVTON generation failed: {exc}") from exc
        finally:
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass

    buffer = io.BytesIO()
    result.save(buffer, format="PNG")
    return buffer.getvalue()
