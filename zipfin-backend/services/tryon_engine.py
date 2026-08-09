import asyncio
import base64
import logging
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np
import requests
from fastapi import HTTPException, status

from firebase_upload import FirebaseUploadError, upload_to_firebase
from models.schema import TryOnImageResponse
from services.vton_engine import VtonError, generate_vton_image

logger = logging.getLogger(__name__)

UPLOAD_DIR = Path("uploads")
TRYON_RESULTS_DIR = UPLOAD_DIR / "tryons"
POSE_LANDMARK_LEFT_SHOULDER = 11
POSE_LANDMARK_RIGHT_SHOULDER = 12
POSE_VISIBILITY_THRESHOLD = 0.4
PRODUCT_DOWNLOAD_TIMEOUT_SECONDS = 20
OVERLAY_WIDTH_SCALE = 1.3
FALLBACK_OVERLAY_WIDTH_SCALE = 0.5
FALLBACK_OVERLAY_TOP_RATIO = 0.35


async def process_tryon_request(
    user_id: str,
    product_image_url: str,
    cloth_type: str = "auto",
    quality: str = "hd",
    person_image: str | None = None,
    garment_image: str | None = None,
) -> TryOnImageResponse:
    _validate_user_id(user_id)
    if not garment_image:
        _validate_product_image_url(product_image_url)

    if person_image:
        person_bytes = _decode_person_data_url(person_image)
    else:
        source_image_path = _resolve_user_image_path(user_id)
        try:
            person_bytes = source_image_path.read_bytes()
        except OSError as exc:
            logger.exception("Failed to read avatar image for user '%s'.", user_id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to access uploaded avatar.",
            ) from exc

    try:
        if garment_image:
            garment_bytes = _decode_person_data_url(garment_image)
        else:
            garment_bytes = _download_product_image_bytes(product_image_url)
        image_bytes: bytes
        engine: str
        try:
            # CatVTON runs minutes-long on CPU-adjacent hardware; keep the
            # event loop free.
            image_bytes, engine = await asyncio.to_thread(
                generate_vton_image,
                person_image_bytes=person_bytes,
                garment_image_bytes=garment_bytes,
                cloth_type=cloth_type,
                quality=quality,
            )
        except VtonError as exc:
            logger.warning(
                "CatVTON try-on unavailable for user '%s'; using overlay fallback. Reason: %s",
                user_id,
                exc,
            )
            image_bytes = generate_tryon_image_from_bytes(
                person_bytes=person_bytes,
                garment_bytes=garment_bytes,
            )
            engine = "overlay"
    except TryOnDownloadError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    except TryOnGenerationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected try-on image generation failure for user '%s'.", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate try-on image.",
        ) from exc

    try:
        stored_image_url = _store_tryon_image(image_bytes=image_bytes, user_id=user_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except OSError as exc:
        logger.exception("Failed to store generated try-on image locally for user '%s'.", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to store generated try-on image.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected try-on storage failure for user '%s'.", user_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to upload try-on image.",
        ) from exc

    return TryOnImageResponse(tryon_image=stored_image_url, engine=engine)


def _decode_person_data_url(person_image: str) -> bytes:
    value = person_image.strip()
    if not value.startswith("data:image/"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="person_image must be a base64 image data URL.",
        )
    _, _, encoded = value.partition(",")
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="person_image is not valid base64 data.",
        ) from exc
    if not decoded:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="person_image is empty.",
        )
    return decoded


def _store_tryon_image(*, image_bytes: bytes, user_id: str) -> str:
    try:
        return upload_to_firebase(image_bytes)
    except ValueError:
        raise
    except (FirebaseUploadError, FileNotFoundError, RuntimeError) as exc:
        logger.warning(
            "Firebase upload unavailable for user '%s'; falling back to local storage. Reason: %s",
            user_id,
            exc,
        )
        return _store_tryon_image_locally(image_bytes=image_bytes, user_id=user_id)


def _store_tryon_image_locally(*, image_bytes: bytes, user_id: str) -> str:
    TRYON_RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    safe_user_id = "".join(
        character if character.isalnum() or character in {"-", "_"} else "-"
        for character in user_id.strip()
    ).strip("-") or "tryon"
    filename = f"{safe_user_id}-{uuid4()}.png"
    output_path = TRYON_RESULTS_DIR / filename
    output_path.write_bytes(image_bytes)
    return f"/uploads/tryons/{filename}"


def _validate_user_id(user_id: str) -> None:
    if not user_id.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="user_id is required.",
        )


def _validate_product_image_url(product_image_url: str) -> None:
    if not product_image_url.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="product_image_url is required.",
        )


def _resolve_user_image_path(user_id: str) -> Path:
    try:
        matches = sorted(
            (path for path in UPLOAD_DIR.glob(f"{user_id}.*") if path.is_file()),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
    except OSError as exc:
        logger.exception("Failed to read avatar files for user '%s'.", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to access uploaded avatar.",
        ) from exc

    if not matches:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No uploaded avatar found for user_id '{user_id}'.",
        )
    return matches[0]


class TryOnGenerationError(ValueError):
    pass


class TryOnDownloadError(RuntimeError):
    pass


def generate_tryon_image(user_image_path: str | Path, product_image_url: str) -> bytes:
    try:
        person_bytes = Path(user_image_path).read_bytes()
    except OSError as exc:
        raise TryOnGenerationError("Unable to read the uploaded avatar image.") from exc
    garment_bytes = _download_product_image_bytes(product_image_url)
    return generate_tryon_image_from_bytes(
        person_bytes=person_bytes,
        garment_bytes=garment_bytes,
    )


def generate_tryon_image_from_bytes(*, person_bytes: bytes, garment_bytes: bytes) -> bytes:
    avatar_array = np.frombuffer(person_bytes, dtype=np.uint8)
    avatar_image = cv2.imdecode(avatar_array, cv2.IMREAD_COLOR)
    if avatar_image is None:
        raise TryOnGenerationError("Unable to read the uploaded avatar image.")

    product_image = _decode_product_image(garment_bytes)
    image_height, image_width = avatar_image.shape[:2]
    shoulder_points = _detect_shoulder_points(avatar_image)

    if shoulder_points is None:
        new_width = max(int(image_width * FALLBACK_OVERLAY_WIDTH_SCALE), 1)
        center_x = image_width // 2
        x_offset = int(center_x - (new_width / 2))
        y_offset = int(image_height * FALLBACK_OVERLAY_TOP_RATIO)
    else:
        left_x, left_y, right_x, right_y = shoulder_points
        shoulder_width = max(abs(right_x - left_x), 1)
        center_x = (left_x + right_x) // 2
        shoulder_y = min(left_y, right_y)
        new_width = max(int(shoulder_width * OVERLAY_WIDTH_SCALE), 1)
        x_offset = int(center_x - (new_width / 2))
        # Better neck & shoulder collar positioning
        y_offset = max(0, int(shoulder_y - (new_width * 0.12)))

    product_overlay = _resize_product_image(product_image, new_width)
    product_overlay = _soften_overlay_edges(product_overlay)
    overlay_height, overlay_width = product_overlay.shape[:2]
    x_offset, y_offset = _clamp_overlay_position(
        x_offset=x_offset,
        y_offset=y_offset,
        overlay_width=overlay_width,
        overlay_height=overlay_height,
        image_width=image_width,
        image_height=image_height,
    )

    composited_image = _overlay_product_image(
        avatar_image,
        product_overlay,
        left_x=x_offset,
        top_y=y_offset,
    )

    try:
        success, buffer = cv2.imencode(".png", composited_image)
    except cv2.error as exc:
        raise TryOnGenerationError("Failed to encode generated try-on image.") from exc

    if not success:
        raise TryOnGenerationError("Failed to encode generated try-on image.")

    image_bytes = buffer.tobytes()
    return image_bytes


def _download_product_image_bytes(product_image_url: str) -> bytes:
    try:
        response = requests.get(
            product_image_url,
            timeout=PRODUCT_DOWNLOAD_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise TryOnDownloadError("Failed to download product image.") from exc
    except Exception as exc:
        logger.exception("Unexpected product image download failure for '%s'.", product_image_url)
        raise TryOnDownloadError("Failed to download product image.") from exc

    if not response.content:
        raise TryOnGenerationError("Downloaded product image is empty.")
    return response.content


def _decode_product_image(garment_bytes: bytes) -> np.ndarray:
    image_array = np.frombuffer(garment_bytes, dtype=np.uint8)
    product_image = cv2.imdecode(image_array, cv2.IMREAD_UNCHANGED)
    if product_image is None:
        raise TryOnGenerationError("Downloaded product image is not a valid image.")

    return _normalize_product_image(product_image)


def _detect_shoulder_points(avatar_image: np.ndarray) -> tuple[int, int, int, int] | None:
    image_height, image_width = avatar_image.shape[:2]
    try:
        # mp.solutions is unavailable under the installed mediapipe/protobuf;
        # _detect_pose falls back to the tasks API with the same interface.
        from services.measurement_service import _detect_pose

        landmarks = _detect_pose(avatar_image)
    except Exception:
        return None

    if not landmarks:
        return None
    try:
        left_shoulder = landmarks[POSE_LANDMARK_LEFT_SHOULDER]
        right_shoulder = landmarks[POSE_LANDMARK_RIGHT_SHOULDER]
    except IndexError:
        return None

    if (
        left_shoulder.visibility < POSE_VISIBILITY_THRESHOLD
        or right_shoulder.visibility < POSE_VISIBILITY_THRESHOLD
    ):
        return None

    left_x, left_y = _landmark_to_pixel_coords(left_shoulder, image_width, image_height)
    right_x, right_y = _landmark_to_pixel_coords(
        right_shoulder,
        image_width,
        image_height,
    )

    return left_x, left_y, right_x, right_y


def _landmark_to_pixel_coords(
    landmark: object,
    image_width: int,
    image_height: int,
) -> tuple[int, int]:
    normalized_x = float(getattr(landmark, "x"))
    normalized_y = float(getattr(landmark, "y"))
    pixel_x = int(normalized_x * image_width)
    pixel_y = int(normalized_y * image_height)
    pixel_x = min(max(pixel_x, 0), max(image_width - 1, 0))
    pixel_y = min(max(pixel_y, 0), max(image_height - 1, 0))
    return pixel_x, pixel_y


def _resize_product_image(product_image: np.ndarray, target_width: int) -> np.ndarray:
    image_height, image_width = product_image.shape[:2]
    safe_target_width = max(target_width, 1)
    resized_height = max(int(safe_target_width * (image_height / max(image_width, 1))), 1)
    return cv2.resize(
        product_image,
        (safe_target_width, resized_height),
        interpolation=cv2.INTER_AREA,
    )


def _clamp_overlay_position(
    x_offset: int,
    y_offset: int,
    overlay_width: int,
    overlay_height: int,
    image_width: int,
    image_height: int,
) -> tuple[int, int]:
    clamped_x = min(max(x_offset, 0), max(image_width - overlay_width, 0))
    clamped_y = min(max(y_offset, 0), max(image_height - overlay_height, 0))
    return clamped_x, clamped_y


def _overlay_product_image(
    avatar_image: np.ndarray,
    product_image: np.ndarray,
    left_x: int,
    top_y: int,
) -> np.ndarray:
    output_image = avatar_image.copy()
    avatar_height, avatar_width = output_image.shape[:2]
    product_height, product_width = product_image.shape[:2]

    right_x = left_x + product_width
    bottom_y = top_y + product_height

    crop_left = max(0, -left_x)
    crop_top = max(0, -top_y)
    crop_right = max(0, right_x - avatar_width)
    crop_bottom = max(0, bottom_y - avatar_height)

    clipped_product = product_image[
        crop_top:product_height - crop_bottom,
        crop_left:product_width - crop_right,
    ]
    if clipped_product.size == 0:
        raise TryOnGenerationError("Product image could not be positioned on the avatar.")

    clipped_left_x = max(left_x, 0)
    clipped_top_y = max(top_y, 0)
    clipped_right_x = clipped_left_x + clipped_product.shape[1]
    clipped_bottom_y = clipped_top_y + clipped_product.shape[0]

    roi = output_image[clipped_top_y:clipped_bottom_y, clipped_left_x:clipped_right_x]
    if clipped_product.shape[2] == 4:
        alpha = clipped_product[:, :, 3].astype(np.float32) / 255.0
        for channel in range(3):
            roi[:, :, channel] = (
                alpha * clipped_product[:, :, channel]
                + (1.0 - alpha) * roi[:, :, channel]
            )
    else:
        roi[:, :, :] = cv2.addWeighted(roi, 0.3, clipped_product, 0.7, 0)

    output_image[clipped_top_y:clipped_bottom_y, clipped_left_x:clipped_right_x] = roi

    return output_image


def _soften_overlay_edges(product_image: np.ndarray) -> np.ndarray:
    softened_image = product_image.copy()
    if softened_image.ndim == 3 and softened_image.shape[2] == 4:
        softened_image[:, :, 3] = cv2.GaussianBlur(softened_image[:, :, 3], (3, 3), 0)
        return softened_image

    return cv2.GaussianBlur(softened_image, (3, 3), 0)


def _normalize_product_image(image: np.ndarray) -> np.ndarray:
    if image.ndim == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    if image.ndim == 3 and image.shape[2] == 3:
        return image
    if image.ndim == 3 and image.shape[2] == 4:
        return image

    raise TryOnGenerationError("Unsupported product image format.")
