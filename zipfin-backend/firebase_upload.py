import uuid
from urllib.parse import quote

from firebase_config import get_storage_bucket, get_storage_bucket_name


class FirebaseUploadError(RuntimeError):
    """Raised when upload to Firebase Storage fails."""


def upload_to_firebase(
    image_bytes: bytes,
    *,
    folder: str = "tryons",
    content_type: str = "image/png",
    file_extension: str = ".png",
) -> str:
    if not isinstance(image_bytes, (bytes, bytearray)) or not image_bytes:
        raise ValueError("image_bytes must be non-empty bytes.")
    if not folder.strip():
        raise ValueError("folder must be a non-empty string.")

    try:
        bucket = get_storage_bucket()
        filename = f"{folder.strip().strip('/')}/{uuid.uuid4()}{file_extension}"
        blob = bucket.blob(filename)
        download_token = str(uuid.uuid4())

        # Generated files are immutable (UUID names, never rewritten), so let
        # browsers and Google's CDN edge cache them for a year.
        blob.cache_control = "public, max-age=31536000, immutable"
        blob.upload_from_string(image_bytes, content_type=content_type)
        blob.metadata = {
            **(blob.metadata or {}),
            "firebaseStorageDownloadTokens": download_token,
        }
        blob.patch()

        return _build_download_url(blob.name, download_token)
    except (FileNotFoundError, RuntimeError, ValueError):
        raise
    except Exception as exc:
        raise FirebaseUploadError(
            f"Failed to upload image to Firebase Storage: {exc}"
        ) from exc


def _build_download_url(blob_name: str, download_token: str) -> str:
    encoded_blob_name = quote(blob_name, safe="")
    bucket_name = get_storage_bucket_name()
    return (
        f"https://firebasestorage.googleapis.com/v0/b/{bucket_name}/o/"
        f"{encoded_blob_name}?alt=media&token={download_token}"
    )
