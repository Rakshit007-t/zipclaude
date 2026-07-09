"""Local CatVTON inference on the user's GPU (RTX 3050 6GB target).

Loads the CatVTON pipeline (vendored repo in vendor/CatVTON) lazily as a
singleton and serializes generations with a lock — 6GB VRAM cannot run two
diffusions at once. The garment-region mask is built from MediaPipe pose
landmarks (tasks API) because CatVTON's own AutoMasker needs
detectron2/DensePose, which does not build on Windows.

Quality pipeline (each stage has an env kill-switch, default on):
  - VTON_CLIP_TO_SILHOUETTE: garment mask = pose-derived bands clipped to the
    person's segmentation silhouette, so background is never repainted.
  - VTON_PROTECT_FACE_HANDS: face/hand/foot regions are carved out of the
    mask so diffusion cannot alter them.
  - VTON_REPAINT: the pipeline renders a person-centered window, and only the
    masked garment region is composited back onto the original photo at full
    resolution — identity, background and framing stay pixel-original.
  - VTON_SEED: optional fixed seed to replay a generation exactly.
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
# RLock: the OOM handler retries at "fast" quality by re-entering
# generate_local_tryon while the lock is still held.
_GENERATION_LOCK = threading.RLock()
_PIPELINE_ERROR: str | None = None

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def _flag(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip().lower() not in {"0", "false", "no", "off"}


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
            # Memory savers for 6GB cards. Never call unet.set_attention_slice
            # here: it replaces every attention processor, wiping the
            # SkipAttnProcessor adapter CatVTON installs on cross-attention
            # (the UNet runs with encoder_hidden_states=None and crashes).
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
    # mp.solutions does not load under the installed mediapipe/protobuf
    # combination, which used to crash mask building and silently push every
    # request to the cloud provider. The measurement service maintains a
    # tasks-API fallback with the same landmark interface — reuse it.
    from services.measurement_service import _detect_pose

    try:
        return _detect_pose(image_bgr)
    except Exception as exc:
        logger.warning("Pose detection failed for garment mask: %s", exc)
        return None


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


def _person_silhouette(person_bgr: np.ndarray) -> np.ndarray | None:
    """Person segmentation mask, or None when it is unavailable/implausible."""
    try:
        from services.measurement_service import _extract_silhouette

        silhouette = _extract_silhouette(person_bgr)
        mask = silhouette.get("mask")
        if mask is None or float(silhouette.get("frame_ratio", 0.0)) < 0.05:
            return None
        return np.asarray(mask, dtype=np.uint8)
    except Exception as exc:
        logger.debug("Person segmentation unavailable for garment mask: %s", exc)
        return None


def _clip_to_silhouette(mask: np.ndarray, silhouette: np.ndarray, w: int, h: int) -> np.ndarray | None:
    """Confine the repaint region to the person (plus a thin blending halo).

    Any background inside the mask comes back as regenerated pixels and shows
    up as a visible seam after compositing; clipping keeps the mask boundary
    on the person, where generated garment meets original garment/skin.
    Returns None when the intersection is too small to be trusted.
    """
    halo = max(int(min(w, h) * 0.012), 4)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * halo + 1, 2 * halo + 1))
    clipped = cv2.bitwise_and(mask, cv2.dilate(silhouette, kernel))
    if int((clipped > 0).sum()) < 0.02 * w * h:
        return None
    clipped = cv2.GaussianBlur(clipped, (15, 15), 0)
    _, clipped = cv2.threshold(clipped, 127, 255, cv2.THRESH_BINARY)
    return clipped


def build_garment_mask(
    person_bgr: np.ndarray,
    cloth_type: str,
    silhouette: np.ndarray | None = None,
) -> np.ndarray:
    """Binary mask (uint8, 255 = repaint region) for the garment area.

    Preferred strategy: generous full-frame-width bands at garment height,
    clipped to the person's segmentation silhouette — covers the whole
    garment (even with elbows/hips out of frame) while never repainting
    background. Falls back to pose polygons, then to a centered rectangle.
    """
    h, w = person_bgr.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    lm = _detect_landmarks(person_bgr)
    if silhouette is None and _flag("VTON_CLIP_TO_SILHOUETTE"):
        silhouette = _person_silhouette(person_bgr)

    if lm is None:
        # No pose: fall back to a generous centered region.
        top, bottom = (0.16, 0.62) if cloth_type in {"upper_body", "auto"} else (0.40, 0.95)
        if cloth_type == "dress":
            top, bottom = 0.16, 0.95
        cv2.rectangle(mask, (int(w * 0.18), int(h * top)), (int(w * 0.82), int(h * bottom)), 255, -1)
        if silhouette is not None:
            clipped = _clip_to_silhouette(mask, silhouette, w, h)
            if clipped is not None:
                return clipped
        return mask

    ls, rs = _pt(lm, 11, w, h), _pt(lm, 12, w, h)
    lh, rh = _pt(lm, 23, w, h), _pt(lm, 24, w, h)
    if ls is None or rs is None:
        cv2.rectangle(mask, (int(w * 0.18), int(h * 0.16)), (int(w * 0.82), int(h * 0.62)), 255, -1)
        if silhouette is not None:
            clipped = _clip_to_silhouette(mask, silhouette, w, h)
            if clipped is not None:
                return clipped
        return mask

    shoulder_w = max(abs(rs[0] - ls[0]), 24.0)
    hips_visible = lh is not None and rh is not None
    hip_y = (lh[1] + rh[1]) / 2 if hips_visible else min(ls[1], rs[1]) + shoulder_w * 1.6
    hip_w = abs(rh[0] - lh[0]) if hips_visible else shoulder_w * 0.9
    neck_y = min(ls[1], rs[1]) - shoulder_w * 0.35
    pad_x = shoulder_w * 0.45

    if silhouette is not None:
        # Full-width bands at garment height; the silhouette clip confines
        # them to the person, so generosity costs nothing.
        band = np.zeros((h, w), dtype=np.uint8)
        if cloth_type in {"upper_body", "auto", "dress"}:
            # Hips out of frame => close-up shot: the garment runs to the
            # bottom edge.
            band_bottom = hip_y + shoulder_w * 0.25 if hips_visible else h
            cv2.rectangle(band, (0, int(max(neck_y, 0))), (w, int(min(band_bottom, h))), 255, -1)
        if cloth_type in {"lower_body", "dress"}:
            la, ra = _pt(lm, 27, w, h), _pt(lm, 28, w, h)
            ankle_y = max(la[1] if la else 0, ra[1] if ra else 0, hip_y + shoulder_w * 2.2)
            cv2.rectangle(
                band,
                (0, int(max(hip_y - shoulder_w * 0.2, 0))),
                (w, int(min(ankle_y + shoulder_w * 0.3, h))),
                255,
                -1,
            )
        clipped = _clip_to_silhouette(band, silhouette, w, h)
        if clipped is not None:
            if _flag("VTON_PROTECT_FACE_HANDS"):
                _protect_identity_regions(clipped, lm, w, h, shoulder_w, cloth_type)
            return clipped

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
    if _flag("VTON_PROTECT_FACE_HANDS"):
        _protect_identity_regions(mask, lm, w, h, shoulder_w, cloth_type)
    return mask


def _protect_identity_regions(
    mask: np.ndarray,
    lm,
    w: int,
    h: int,
    shoulder_w: float,
    cloth_type: str,
) -> None:
    """Zero out face, hands and feet so diffusion never repaints them.

    The torso polygon reaches chin height and the arm strokes run to the
    wrists, so after dilation the repaint region eats the jaw and fingers.
    Upstream CatVTON's automasker excludes these regions for the same
    reason; without segmentation we approximate them from pose landmarks.
    """
    nose = _pt(lm, 0, w, h)
    l_eye, r_eye = _pt(lm, 2, w, h), _pt(lm, 5, w, h)
    l_ear, r_ear = _pt(lm, 7, w, h), _pt(lm, 8, w, h)
    mouth_pts = [p for p in (_pt(lm, 9, w, h), _pt(lm, 10, w, h)) if p is not None]
    head_pts = [p for p in (nose, l_eye, r_eye, l_ear, r_ear) if p is not None]

    if head_pts and mouth_pts:
        center_x = sum(p[0] for p in head_pts) / len(head_pts)
        eye_pts = [p for p in (l_eye, r_eye) if p is not None] or head_pts
        eye_y = sum(p[1] for p in eye_pts) / len(eye_pts)
        mouth_y = sum(p[1] for p in mouth_pts) / len(mouth_pts)
        face_h = max(mouth_y - eye_y, shoulder_w * 0.10)
        chin_y = mouth_y + face_h * 0.9  # ends above the neck: collar stays paintable
        if l_ear is not None and r_ear is not None:
            half_w = max(abs(r_ear[0] - l_ear[0]) * 0.62, shoulder_w * 0.16)
        else:
            half_w = shoulder_w * 0.22
        axis_y = face_h * 1.8
        cv2.ellipse(
            mask,
            (int(center_x), int(chin_y - axis_y)),
            (int(half_w), int(axis_y)),
            0, 0, 360, 0, -1,
        )

    for wrist_index, elbow_index, knuckle_indices in ((15, 13, (19, 17, 21)), (16, 14, (20, 18, 22))):
        wrist = _pt(lm, wrist_index, w, h)
        if wrist is None:
            continue
        knuckles = [p for i in knuckle_indices if (p := _pt(lm, i, w, h)) is not None]
        if knuckles:
            knuckle_x = sum(p[0] for p in knuckles) / len(knuckles)
            knuckle_y = sum(p[1] for p in knuckles) / len(knuckles)
            center = ((wrist[0] + 2 * knuckle_x) / 3, (wrist[1] + 2 * knuckle_y) / 3)
        else:
            elbow = _pt(lm, elbow_index, w, h)
            if elbow is not None:
                # Extrapolate past the wrist along the forearm; keeps the
                # cuff area paintable while covering the palm and fingers.
                center = (
                    wrist[0] + (wrist[0] - elbow[0]) * 0.3,
                    wrist[1] + (wrist[1] - elbow[1]) * 0.3,
                )
            else:
                center = wrist
        cv2.circle(mask, (int(center[0]), int(center[1])), int(shoulder_w * 0.22), 0, -1)

    if cloth_type in {"lower_body", "dress"}:
        for heel_index, toe_index in ((29, 31), (30, 32)):
            heel, toe = _pt(lm, heel_index, w, h), _pt(lm, toe_index, w, h)
            foot = [p for p in (heel, toe) if p is not None]
            if not foot:
                continue
            center_x = sum(p[0] for p in foot) / len(foot)
            center_y = sum(p[1] for p in foot) / len(foot)
            cv2.circle(mask, (int(center_x), int(center_y)), int(shoulder_w * 0.18), 0, -1)


def _center_crop_box(src_w: int, src_h: int, target_w: int, target_h: int) -> tuple[int, int, int, int]:
    """(left, top, width, height) of the crop vendored resize_and_crop applies.

    Must stay in sync with vendor/CatVTON/utils.py::resize_and_crop so
    non-composited output can be mapped back onto the original photo.
    """
    if src_w / src_h < target_w / target_h:
        crop_w = src_w
        crop_h = src_w * target_h // target_w
    else:
        crop_h = src_h
        crop_w = src_h * target_w // target_h
    return (src_w - crop_w) // 2, (src_h - crop_h) // 2, crop_w, crop_h


def _render_window(
    mask_array: np.ndarray,
    silhouette: np.ndarray | None,
    src_w: int,
    src_h: int,
    target_w: int,
    target_h: int,
) -> tuple[int, int, int, int]:
    """Aspect-correct window (x0, y0, x1, y1) covering person + garment mask.

    The pipeline renders at a fixed 3:4 aspect; blindly center-cropping wide
    photos cuts the garment off at the crop edges (sleeves stay in the old
    clothes). Rendering a person-centered window instead covers the whole
    garment and spends render pixels on the person rather than background.
    The window may extend beyond the image — callers pad the overhang and
    the composite step discards it.
    """
    import math

    content = mask_array > 0
    if silhouette is not None:
        content = content | (silhouette > 0)
    ys, xs = np.nonzero(content)
    if len(xs) == 0:
        x0, y0, x1, y1 = 0, 0, src_w, src_h
    else:
        margin_x = int((xs.max() - xs.min()) * 0.08) + 8
        margin_y = int((ys.max() - ys.min()) * 0.08) + 8
        x0, x1 = int(xs.min()) - margin_x, int(xs.max()) + margin_x
        y0, y1 = int(ys.min()) - margin_y, int(ys.max()) + margin_y

    gcd = math.gcd(target_w, target_h)
    aspect_w, aspect_h = target_w // gcd, target_h // gcd

    content_w, content_h = max(x1 - x0, 64), max(y1 - y0, 64)
    win_w = max(content_w, -(-content_h * aspect_w // aspect_h))
    win_w = -(-win_w // aspect_w) * aspect_w  # exact aspect => pipeline crop is identity
    win_h = win_w * aspect_h // aspect_w

    center_x, center_y = (x0 + x1) // 2, (y0 + y1) // 2
    win_x = center_x - win_w // 2
    win_y = center_y - win_h // 2
    # Prefer real image content over padding wherever the window fits.
    if win_w <= src_w:
        win_x = min(max(win_x, 0), src_w - win_w)
    else:
        win_x = (src_w - win_w) // 2
    if win_h <= src_h:
        win_y = min(max(win_y, 0), src_h - win_h)
    else:
        win_y = (src_h - win_h) // 2
    return win_x, win_y, win_x + win_w, win_y + win_h


def _crop_window(array: np.ndarray, window: tuple[int, int, int, int], *, fill: int) -> np.ndarray:
    """Extract a window that may overhang the image; pad the overhang.

    Person overhang is padded white — a torso ending into white void reads
    like an ordinary cropped studio photo to the model, whereas replicated
    edges smear into garment-like streaks it then tries to continue.
    """
    x0, y0, x1, y1 = window
    h, w = array.shape[:2]
    core = array[max(0, y0) : min(h, y1), max(0, x0) : min(w, x1)]
    pad_top, pad_left = max(0, -y0), max(0, -x0)
    pad_bottom, pad_right = max(0, y1 - h), max(0, x1 - w)
    if not any((pad_top, pad_bottom, pad_left, pad_right)):
        return core
    value = [fill] * 3 if core.ndim == 3 else fill
    return cv2.copyMakeBorder(
        core, pad_top, pad_bottom, pad_left, pad_right, cv2.BORDER_CONSTANT, value=value
    )


def _composite_result_full_res(person_pil, result_pil, mask_array: np.ndarray, window: tuple[int, int, int, int]):
    """Paste the generated garment region back onto the original photo.

    The pipeline VAE-decodes the whole frame, so face, hands and background
    come back as low-res diffusion reconstructions. Only the masked region
    needs generated pixels; keeping the original everywhere else preserves
    identity, removes global blur/color shift, and keeps the full frame
    instead of a center crop.
    """
    from PIL import Image

    src_w, src_h = person_pil.size
    x0, y0, x1, y1 = window
    result_up = np.asarray(
        result_pil.resize((x1 - x0, y1 - y0), Image.LANCZOS), dtype=np.float32
    )

    # Valid (non-padded) region of the window in source coordinates.
    vx0, vy0 = max(0, x0), max(0, y0)
    vx1, vy1 = min(src_w, x1), min(src_h, y1)

    person_np = np.array(person_pil, dtype=np.float32)
    result_valid = result_up[vy0 - y0 : vy1 - y0, vx0 - x0 : vx1 - x0]

    mask_valid = mask_array[vy0:vy1, vx0:vx1].astype(np.float32) / 255.0
    feather_sigma = max(2.0, (x1 - x0) / 256.0)
    alpha = cv2.GaussianBlur(mask_valid, (0, 0), feather_sigma)[..., None]

    region = person_np[vy0:vy1, vx0:vx1]
    person_np[vy0:vy1, vx0:vx1] = alpha * result_valid + (1.0 - alpha) * region
    return Image.fromarray(np.clip(person_np, 0.0, 255.0).astype(np.uint8))


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
        # the pipeline renders at <=768x1024; 2048 keeps composite output ~2K.
        person_pil.thumbnail((2048, 2048))
        garment_pil.thumbnail((1024, 1024))
    except Exception as exc:
        raise LocalVtonError(f"Invalid input image: {exc}") from exc

    person_bgr = cv2.cvtColor(np.array(person_pil), cv2.COLOR_RGB2BGR)
    silhouette = _person_silhouette(person_bgr) if _flag("VTON_CLIP_TO_SILHOUETTE") else None
    mask_array = build_garment_mask(person_bgr, cloth_type, silhouette=silhouette)

    repaint = _flag("VTON_REPAINT")
    if repaint:
        # Render a person-centered window instead of the pipeline's blind
        # center crop, so wide photos keep their sleeves/edges.
        window = _render_window(
            mask_array, silhouette, person_pil.width, person_pil.height, width, height
        )
        pipeline_person = Image.fromarray(_crop_window(np.array(person_pil), window, fill=255))
        mask_pil = Image.fromarray(_crop_window(mask_array, window, fill=0), mode="L")
    else:
        window = None
        pipeline_person = person_pil
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
            generator_obj = torch.Generator(device="cuda")
            seed_env = os.getenv("VTON_SEED", "").strip()
            if seed_env:
                # Reproducibility escape hatch: replay a generation exactly.
                generator_obj.manual_seed(int(seed_env))
            else:
                generator_obj.seed()
            result = pipeline(
                image=pipeline_person,
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

    result = _superresolve(result, progress_callback)

    if repaint and window is not None:
        if progress_callback:
            progress_callback(0.97, "Blending with your photo")
        result = _composite_result_full_res(person_pil, result, mask_array, window)

    buffer = io.BytesIO()
    result.save(buffer, format="PNG")
    return buffer.getvalue()


def _superresolve(result_pil, progress_callback):
    """2x Real-ESRGAN on the diffusion render (post-VAE, pre-composite).

    Runs after diffusion so its tiles have the GPU to themselves; returns the
    input unchanged whenever the upscaler is unavailable.
    """
    from services import upscaler

    if not upscaler.available():
        return result_pil
    if progress_callback:
        progress_callback(0.94, "Enhancing details")
    from PIL import Image

    upscaled = upscaler.upscale_rgb(np.array(result_pil))
    if upscaled.shape[:2] == (result_pil.height, result_pil.width):
        return result_pil  # upscaler declined; keep original
    return Image.fromarray(upscaled)
