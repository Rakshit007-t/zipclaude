import os
from pathlib import Path
from threading import Lock

import firebase_admin
from firebase_admin import credentials, storage

from core.config import settings

_INIT_LOCK = Lock()
_PROJECT_ROOT = Path(__file__).resolve().parent


def get_storage_bucket_name() -> str:
    bucket_name = settings.FIREBASE_STORAGE_BUCKET
    if not bucket_name:
        raise RuntimeError("FIREBASE_STORAGE_BUCKET is missing from environment variables.")
    return bucket_name


def get_firebase_credentials_path() -> Path:
    if settings.FIREBASE_CREDENTIALS_PATH is None:
        raise FileNotFoundError(
            "FIREBASE_CREDENTIALS_PATH is not configured."
        )

    credentials_path = settings.FIREBASE_CREDENTIALS_PATH
    if not credentials_path.is_absolute():
        credentials_path = _PROJECT_ROOT / credentials_path

    if not credentials_path.is_file():
        raise FileNotFoundError(
            "Firebase credentials file was not found at FIREBASE_CREDENTIALS_PATH."
        )
    return credentials_path


def get_firebase_credentials():
    credentials_dict = settings.get_firebase_credentials_dict()
    if credentials_dict is not None:
        return credentials.Certificate(credentials_dict)

    if settings.FIREBASE_CREDENTIALS_PATH is not None:
        return credentials.Certificate(str(get_firebase_credentials_path()))

    if os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip():
        return credentials.ApplicationDefault()

    raise RuntimeError(
        "Firebase credentials are not configured. Set FIREBASE_CREDENTIALS_JSON, "
        "the FIREBASE_PROJECT_ID/FIREBASE_PRIVATE_KEY/FIREBASE_CLIENT_EMAIL trio, "
        "or FIREBASE_CREDENTIALS_PATH/GOOGLE_APPLICATION_CREDENTIALS."
    )


def initialize_firebase() -> firebase_admin.App:
    try:
        return firebase_admin.get_app()
    except ValueError:
        pass

    with _INIT_LOCK:
        try:
            return firebase_admin.get_app()
        except ValueError:
            pass

        try:
            return firebase_admin.initialize_app(
                get_firebase_credentials(),
                {"storageBucket": get_storage_bucket_name()},
            )
        except (FileNotFoundError, RuntimeError):
            raise
        except Exception as exc:
            raise RuntimeError("Failed to initialize Firebase Admin SDK.") from exc


def get_storage_bucket():
    initialize_firebase()
    try:
        return storage.bucket(name=get_storage_bucket_name())
    except Exception as exc:
        raise RuntimeError("Failed to access Firebase Storage bucket.") from exc
