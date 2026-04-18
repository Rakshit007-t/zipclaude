import logging
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status

from models.schema import AvatarCreateResponse

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from insightface.app import FaceAnalysis

UPLOAD_DIR = Path("uploads")
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
FACE_MODEL_NAME = "buffalo_l"
FACE_DETECTION_SIZE = (640, 640)
FALLBACK_EMBEDDING_WIDTH = 16
FALLBACK_EMBEDDING_HEIGHT = 8


class FaceDetectionError(ValueError):
    pass


@lru_cache(maxsize=1)
def _get_face_analyzer() -> "FaceAnalysis | None":
    try:
        from insightface.app import FaceAnalysis
    except ImportError:
        logger.warning(
            "InsightFace is unavailable in this environment; using fallback avatar embeddings."
        )
        return None

    analyzer = FaceAnalysis(
        name=FACE_MODEL_NAME,
        providers=["CPUExecutionProvider"],
    )
    analyzer.prepare(ctx_id=-1, det_size=FACE_DETECTION_SIZE)
    return analyzer


def extract_face_embedding(image_path: str | Path) -> list[float]:
    import cv2

    image_file = Path(image_path)
    if not image_file.is_file():
        raise FileNotFoundError(f"Image not found: {image_file}")

    image = cv2.imread(str(image_file))
    if image is None:
        raise ValueError(f"Unable to read image: {image_file}")

    analyzer = _get_face_analyzer()
    if analyzer is not None:
        try:
            faces = analyzer.get(image)
        except Exception:
            logger.exception(
                "InsightFace embedding extraction failed for '%s'; using fallback embedding.",
                image_file,
            )
        else:
            if faces:
                primary_face = max(faces, key=lambda face: float(face.det_score or 0.0))
                if primary_face.embedding is not None:
                    return primary_face.embedding.tolist()
                logger.warning(
                    "InsightFace returned a face without an embedding for '%s'; using fallback embedding.",
                    image_file,
                )
            else:
                logger.warning(
                    "No face detected by InsightFace for '%s'; using fallback embedding.",
                    image_file,
                )

    return _extract_fallback_embedding(image, image_file)


def _extract_fallback_embedding(image, image_file: Path) -> list[float]:
    import cv2
    import numpy as np

    face_region = _detect_face_region(image)
    if face_region is None:
        logger.warning(
            "No face detected for '%s'; generating an image-based fallback embedding.",
            image_file,
        )
        region = image
    else:
        x, y, width, height = face_region
        region = image[y:y + height, x:x + width]

    if region.size == 0:
        raise FaceDetectionError(f"Unable to extract a usable avatar region from image: {image_file}")

    grayscale_region = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    thumbnail = cv2.resize(
        grayscale_region,
        (FALLBACK_EMBEDDING_WIDTH, FALLBACK_EMBEDDING_HEIGHT),
        interpolation=cv2.INTER_AREA,
    )
    normalized = thumbnail.astype(np.float32) / 255.0
    return normalized.flatten().tolist()


def _detect_face_region(image) -> tuple[int, int, int, int] | None:
    import cv2

    cascade_path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
    classifier = cv2.CascadeClassifier(str(cascade_path))
    if classifier.empty():
        logger.warning("OpenCV Haar cascade could not be loaded from '%s'.", cascade_path)
        return None

    grayscale_image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    faces = classifier.detectMultiScale(
        grayscale_image,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(48, 48),
    )
    if len(faces) == 0:
        return None

    x, y, width, height = max(faces, key=lambda face: int(face[2] * face[3]))
    return int(x), int(y), int(width), int(height)


async def process_avatar_upload(file: UploadFile) -> AvatarCreateResponse:
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A file name is required.",
        )

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only JPEG, PNG, and WEBP images are supported.",
        )

    try:
        content = await file.read()
    except Exception as exc:
        logger.exception("Failed to read uploaded avatar file '%s'.", file.filename)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to read uploaded file.",
        ) from exc

    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Uploaded file exceeds the 10 MB limit.",
        )

    try:
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.exception("Failed to create upload directory '%s'.", UPLOAD_DIR)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to prepare avatar storage.",
        ) from exc

    extension = Path(file.filename).suffix or ".bin"
    user_id = str(uuid4())
    filename = f"{user_id}{extension}"
    file_path = UPLOAD_DIR / filename
    try:
        file_path.write_bytes(content)
    except OSError as exc:
        logger.exception("Failed to persist uploaded avatar '%s'.", file_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to store uploaded file.",
        ) from exc

    public_path = f"/uploads/{filename}"
    try:
        embedding = extract_face_embedding(file_path)
    except (FaceDetectionError, FileNotFoundError, ValueError) as exc:
        file_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        file_path.unlink(missing_ok=True)
        logger.exception("Unexpected avatar processing failure for '%s'.", file_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process uploaded avatar.",
        ) from exc

    return AvatarCreateResponse(
        user_id=user_id,
        public_path=public_path,
        embedding=embedding,
    )
