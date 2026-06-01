from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

import cv2
from zipright.backend.pipeline._mediapipe_compat import ensure_protobuf_compatibility

ensure_protobuf_compatibility()

import mediapipe as mp
import numpy as np
import numpy.typing as npt

RgbImage = npt.NDArray[np.uint8]
FloatImage = npt.NDArray[np.float32]
MaskImage = npt.NDArray[np.uint8]
Contour = npt.NDArray[np.int32]

_SEGMENTER_CACHE: dict[int, object] = {}
_SEGMENTER_CACHE_LOCK = Lock()
_SEGMENTER_PROCESS_LOCK = Lock()


class PreprocessError(ValueError):
    """Raised when an image cannot be safely prepared for measurement."""

    def __init__(self, message: str, *, code: str = "preprocess_failed") -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class BoundingBox:
    x: int
    y: int
    width: int
    height: int

    @property
    def area(self) -> int:
        return self.width * self.height


@dataclass(frozen=True)
class ResizeMetadata:
    original_width: int
    original_height: int
    resized_width: int
    resized_height: int
    scale: float
    pad_left: int
    pad_right: int
    pad_top: int
    pad_bottom: int


@dataclass(frozen=True)
class SilhouetteMetrics:
    silhouette_area: float
    bounding_box_area: float
    fill_ratio: float
    contour_perimeter: float
    jaggedness: float


@dataclass(frozen=True)
class PreprocessConfig:
    target_size: int = 512
    clahe_clip_limit: float = 2.0
    clahe_tile_grid_size: tuple[int, int] = (8, 8)
    segmentation_model_selection: int = 1
    segmentation_threshold: float = 0.5
    morphology_kernel_size: int = 5
    min_silhouette_fill_ratio: float = 0.35
    white_padding_value: int = 255


@dataclass(frozen=True)
class PreprocessedImage:
    original_rgb: RgbImage
    resized_rgb: RgbImage
    normalized_rgb: FloatImage
    enhanced_rgb: RgbImage
    enhanced_normalized_rgb: FloatImage
    segmentation_mask: FloatImage
    binary_mask: MaskImage
    silhouette_mask: MaskImage
    foreground_rgb: RgbImage
    largest_contour: Contour
    bounding_box: BoundingBox
    resize_metadata: ResizeMetadata
    silhouette_metrics: SilhouetteMetrics

    @property
    def image_height(self) -> int:
        return int(self.resized_rgb.shape[0])

    @property
    def image_width(self) -> int:
        return int(self.resized_rgb.shape[1])


def preprocess_image_path(
    image_path: str | Path,
    *,
    config: PreprocessConfig | None = None,
) -> PreprocessedImage:
    """Load an image from disk and run the full preprocessing pipeline."""

    image_rgb = load_rgb_image(image_path)
    return preprocess_rgb_image(image_rgb, config=config)


def preprocess_base64_image(
    image_base64: str,
    *,
    config: PreprocessConfig | None = None,
) -> PreprocessedImage:
    """Decode a base64 image payload and run the full preprocessing pipeline."""

    image_rgb = decode_base64_image(image_base64)
    return preprocess_rgb_image(image_rgb, config=config)


def preprocess_rgb_image(
    image_rgb: RgbImage,
    *,
    config: PreprocessConfig | None = None,
) -> PreprocessedImage:
    """Prepare an RGB image for downstream pose and measurement work."""

    safe_config = config or PreprocessConfig()
    rgb = ensure_rgb_image(image_rgb)
    resized_rgb, resize_metadata = resize_and_pad_image(rgb, safe_config.target_size, safe_config.white_padding_value)
    normalized_rgb = normalize_rgb_image(resized_rgb)
    enhanced_rgb = apply_clahe_rgb(
        resized_rgb,
        clip_limit=safe_config.clahe_clip_limit,
        tile_grid_size=safe_config.clahe_tile_grid_size,
    )
    enhanced_normalized_rgb = normalize_rgb_image(enhanced_rgb)
    segmentation_mask = segment_foreground(
        enhanced_rgb,
        model_selection=safe_config.segmentation_model_selection,
    )
    binary_mask = threshold_segmentation_mask(segmentation_mask, safe_config.segmentation_threshold)
    closed_mask = morphological_close(binary_mask, safe_config.morphology_kernel_size)
    largest_contour = extract_largest_contour(closed_mask)
    silhouette_mask = fill_contour_mask(closed_mask.shape, largest_contour)
    bounding_box = contour_bounding_box(largest_contour)
    silhouette_metrics = calculate_silhouette_metrics(silhouette_mask, largest_contour, bounding_box)
    validate_silhouette_metrics(silhouette_metrics, safe_config.min_silhouette_fill_ratio)
    foreground_rgb = apply_mask_to_rgb(enhanced_rgb, silhouette_mask)
    return PreprocessedImage(
        original_rgb=rgb,
        resized_rgb=resized_rgb,
        normalized_rgb=normalized_rgb,
        enhanced_rgb=enhanced_rgb,
        enhanced_normalized_rgb=enhanced_normalized_rgb,
        segmentation_mask=segmentation_mask,
        binary_mask=closed_mask,
        silhouette_mask=silhouette_mask,
        foreground_rgb=foreground_rgb,
        largest_contour=largest_contour,
        bounding_box=bounding_box,
        resize_metadata=resize_metadata,
        silhouette_metrics=silhouette_metrics,
    )


def load_rgb_image(image_path: str | Path) -> RgbImage:
    path = Path(image_path)
    image_bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise PreprocessError(f"Unable to read image from '{path}'.", code="image_read_failed")
    return cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)


def decode_base64_image(image_base64: str) -> RgbImage:
    if not isinstance(image_base64, str) or not image_base64.strip():
        raise PreprocessError("Image payload is empty.", code="empty_payload")

    payload = image_base64.strip()
    if "," in payload:
        _, payload = payload.split(",", 1)

    try:
        image_bytes = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise PreprocessError("Image payload is not valid base64.", code="invalid_base64") from exc

    buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    image_bgr = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise PreprocessError("Decoded image payload is not a supported image.", code="invalid_image")
    return cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)


def ensure_rgb_image(image_rgb: RgbImage) -> RgbImage:
    if not isinstance(image_rgb, np.ndarray):
        raise PreprocessError("Image must be a numpy array.", code="invalid_image_type")
    if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
        raise PreprocessError("Image must be an RGB array with 3 channels.", code="invalid_image_shape")
    if image_rgb.dtype != np.uint8:
        return np.clip(image_rgb, 0, 255).astype(np.uint8)
    return image_rgb


def resize_and_pad_image(
    image_rgb: RgbImage,
    target_size: int = 512,
    pad_value: int = 255,
) -> tuple[RgbImage, ResizeMetadata]:
    """Resize to a square while preserving aspect ratio and padding with white."""

    if target_size <= 0:
        raise PreprocessError("Target size must be positive.", code="invalid_target_size")

    height, width = image_rgb.shape[:2]
    if height == 0 or width == 0:
        raise PreprocessError("Image must have non-zero dimensions.", code="empty_image")

    scale = min(target_size / width, target_size / height)
    resized_width = max(1, int(round(width * scale)))
    resized_height = max(1, int(round(height * scale)))
    interpolation = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR
    resized = cv2.resize(image_rgb, (resized_width, resized_height), interpolation=interpolation)

    canvas = np.full((target_size, target_size, 3), pad_value, dtype=np.uint8)
    pad_left = (target_size - resized_width) // 2
    pad_right = target_size - resized_width - pad_left
    pad_top = (target_size - resized_height) // 2
    pad_bottom = target_size - resized_height - pad_top
    canvas[pad_top : pad_top + resized_height, pad_left : pad_left + resized_width] = resized

    metadata = ResizeMetadata(
        original_width=width,
        original_height=height,
        resized_width=resized_width,
        resized_height=resized_height,
        scale=scale,
        pad_left=pad_left,
        pad_right=pad_right,
        pad_top=pad_top,
        pad_bottom=pad_bottom,
    )
    return canvas, metadata


def normalize_rgb_image(image_rgb: RgbImage) -> FloatImage:
    """Normalize uint8 RGB pixels into float32 [0, 1]."""

    return (image_rgb.astype(np.float32) / 255.0).clip(0.0, 1.0)


def apply_clahe_rgb(
    image_rgb: RgbImage,
    *,
    clip_limit: float = 2.0,
    tile_grid_size: tuple[int, int] = (8, 8),
) -> RgbImage:
    """
    Apply CLAHE on the luminance channel while preserving color balance.

    The user-requested CLAHE step is implemented on the LAB lightness channel,
    which is the most stable way to enhance local contrast without distorting
    the RGB channels independently.
    """

    lab = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=tile_grid_size)
    enhanced_l = clahe.apply(l_channel)
    merged = cv2.merge((enhanced_l, a_channel, b_channel))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2RGB)


def segment_foreground(
    image_rgb: RgbImage,
    *,
    model_selection: int = 1,
) -> FloatImage:
    """Run MediaPipe SelfieSegmentation and return the raw probability mask."""

    segmenter = _get_selfie_segmenter(model_selection)
    with _SEGMENTER_PROCESS_LOCK:
        result = segmenter.process(image_rgb)
    segmentation_mask = getattr(result, "segmentation_mask", None)
    if segmentation_mask is None:
        raise PreprocessError("Foreground segmentation failed.", code="segmentation_failed")
    return segmentation_mask.astype(np.float32)


def threshold_segmentation_mask(mask: FloatImage, threshold: float = 0.5) -> MaskImage:
    return ((mask >= float(threshold)).astype(np.uint8) * 255).astype(np.uint8)


def morphological_close(mask: MaskImage, kernel_size: int = 5) -> MaskImage:
    if kernel_size <= 0:
        raise PreprocessError("Morphology kernel size must be positive.", code="invalid_kernel")
    kernel = np.ones((kernel_size, kernel_size), dtype=np.uint8)
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)


def extract_largest_contour(mask: MaskImage) -> Contour:
    contours_info = cv2.findContours(mask.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = contours_info[0] if len(contours_info) == 2 else contours_info[1]
    if not contours:
        raise PreprocessError(
            "Could not isolate the body silhouette. Retake the photo against a cleaner background.",
            code="no_contour",
        )
    largest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest) <= 0:
        raise PreprocessError("Detected silhouette contour is empty.", code="empty_contour")
    return largest.astype(np.int32)


def fill_contour_mask(mask_shape: tuple[int, int], contour: Contour) -> MaskImage:
    filled = np.zeros(mask_shape, dtype=np.uint8)
    cv2.drawContours(filled, [contour], contourIdx=-1, color=255, thickness=cv2.FILLED)
    return filled


def contour_bounding_box(contour: Contour) -> BoundingBox:
    x, y, width, height = cv2.boundingRect(contour)
    return BoundingBox(x=int(x), y=int(y), width=int(width), height=int(height))


def calculate_silhouette_metrics(
    silhouette_mask: MaskImage,
    contour: Contour,
    bounding_box: BoundingBox,
) -> SilhouetteMetrics:
    silhouette_area = float(cv2.countNonZero(silhouette_mask))
    bounding_box_area = float(max(bounding_box.area, 1))
    fill_ratio = silhouette_area / bounding_box_area
    contour_perimeter = float(cv2.arcLength(contour, closed=True))
    jaggedness = contour_perimeter / max(4.0 * np.sqrt(silhouette_area), 1.0)
    return SilhouetteMetrics(
        silhouette_area=silhouette_area,
        bounding_box_area=bounding_box_area,
        fill_ratio=fill_ratio,
        contour_perimeter=contour_perimeter,
        jaggedness=float(jaggedness),
    )


def validate_silhouette_metrics(metrics: SilhouetteMetrics, minimum_fill_ratio: float = 0.35) -> None:
    if metrics.fill_ratio <= minimum_fill_ratio:
        raise PreprocessError(
            (
                "Body silhouette is too weak for accurate measurement. "
                "Stand fully in frame with clearer contrast from the background."
            ),
            code="low_silhouette_fill_ratio",
        )


def apply_mask_to_rgb(image_rgb: RgbImage, mask: MaskImage) -> RgbImage:
    foreground = image_rgb.copy()
    foreground[mask == 0] = 255
    return foreground


def mask_row_bounds(mask: MaskImage, row_index: int) -> tuple[int, int]:
    """Return left and right non-zero bounds for a given row index."""

    if row_index < 0 or row_index >= mask.shape[0]:
        raise PreprocessError("Requested row is outside the image bounds.", code="row_out_of_bounds")
    xs = np.where(mask[row_index, :] > 0)[0]
    if xs.size == 0:
        raise PreprocessError("No silhouette pixels found at the requested row.", code="empty_mask_row")
    return int(xs.min()), int(xs.max())


def close_segmenters() -> None:
    with _SEGMENTER_CACHE_LOCK:
        for segmenter in _SEGMENTER_CACHE.values():
            close = getattr(segmenter, "close", None)
            if callable(close):
                close()
        _SEGMENTER_CACHE.clear()


def _get_selfie_segmenter(model_selection: int) -> object:
    with _SEGMENTER_CACHE_LOCK:
        segmenter = _SEGMENTER_CACHE.get(model_selection)
        if segmenter is None:
            segmenter = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=model_selection)
            _SEGMENTER_CACHE[model_selection] = segmenter
        return segmenter
