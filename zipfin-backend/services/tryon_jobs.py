"""Firestore-backed background try-on jobs.

The rendering executor remains local to the worker that accepted the request,
but every job state transition and result is persisted in Firestore. Polling
from another worker therefore returns the same status and response shape.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
import os
import threading
from uuid import uuid4

from firebase_admin import firestore

from firebase_config import get_firestore_client

logger = logging.getLogger(__name__)

_JOB_TTL_SECONDS = 2 * 60 * 60
_JOBS_COLLECTION = "tryon_jobs"
_EXECUTOR: ThreadPoolExecutor | None = None
_EXECUTOR_LOCK = threading.Lock()


def _executor() -> ThreadPoolExecutor:
    global _EXECUTOR
    if _EXECUTOR is None:
        with _EXECUTOR_LOCK:
            if _EXECUTOR is None:
                try:
                    max_workers = max(1, int(os.getenv("TRYON_MAX_WORKERS", "2")))
                except ValueError:
                    max_workers = 2
                _EXECUTOR = ThreadPoolExecutor(
                    max_workers=max_workers, thread_name_prefix="tryon-job"
                )
    return _EXECUTOR


@dataclass
class TryOnJob:
    job_id: str
    user_id: str
    status: str = "queued"
    progress: int = 0
    stage: str = "Queued"
    engine: str | None = None
    result_url: str | None = None
    error: str | None = None


def _job_ref(job_id: str):
    return get_firestore_client().collection(_JOBS_COLLECTION).document(job_id)


def _update(job_id: str, **changes: object) -> None:
    """Persist a state transition so all instances serve the current job."""
    _job_ref(job_id).set(
        {**changes, "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True
    )


def get_job(job_id: str) -> TryOnJob | None:
    snapshot = _job_ref(job_id).get()
    if not snapshot.exists:
        return None
    data = snapshot.to_dict() or {}
    expires_at = data.get("expiresAt")
    if isinstance(expires_at, datetime) and expires_at <= datetime.now(timezone.utc):
        return None
    user_id = data.get("userId")
    if not isinstance(user_id, str) or not user_id:
        logger.warning("Try-on job %s has no valid owner.", job_id)
        return None
    return TryOnJob(
        job_id=job_id,
        user_id=user_id,
        status=str(data.get("status") or "queued"),
        progress=max(0, min(100, int(data.get("progress") or 0))),
        stage=str(data.get("stage") or ""),
        engine=data.get("engine") if isinstance(data.get("engine"), str) else None,
        result_url=data.get("resultUrl") if isinstance(data.get("resultUrl"), str) else None,
        error=data.get("error") if isinstance(data.get("error"), str) else None,
    )


def start_tryon_job(
    *,
    user_id: str,
    product_image_url: str,
    cloth_type: str,
    quality: str,
    person_image: str | None,
    garment_image: str | None,
) -> str:
    job_id = uuid4().hex
    _job_ref(job_id).set(
        {
            "userId": user_id,
            "status": "queued",
            "progress": 0,
            "stage": "Waiting for a free renderer",
            "engine": None,
            "resultUrl": None,
            "error": None,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
            # Configure Firestore TTL on this field for automatic cleanup.
            "expiresAt": datetime.now(timezone.utc) + timedelta(seconds=_JOB_TTL_SECONDS),
        }
    )
    job = TryOnJob(job_id=job_id, user_id=user_id, stage="Waiting for a free renderer")
    _executor().submit(
        _run_job,
        job=job,
        product_image_url=product_image_url,
        cloth_type=cloth_type,
        quality=quality,
        person_image=person_image,
        garment_image=garment_image,
    )
    return job_id


def _run_job(
    *,
    job: TryOnJob,
    product_image_url: str,
    cloth_type: str,
    quality: str,
    person_image: str | None,
    garment_image: str | None,
) -> None:
    from fastapi import HTTPException

    from services.tryon_engine import (
        _decode_person_data_url,
        _download_product_image_bytes,
        _resolve_user_image_path,
        _store_tryon_image,
    )
    from services.vton_engine import VtonError, generate_vton_image

    last_progress = 0

    def progress(fraction: float, stage: str) -> None:
        nonlocal last_progress
        next_progress = max(last_progress, min(int(fraction * 100), 99))
        if next_progress > last_progress or stage:
            last_progress = next_progress
            _update(job.job_id, progress=next_progress, stage=stage)

    try:
        _update(job.job_id, status="running", progress=1, stage="Preparing images")

        if person_image:
            person_bytes = _decode_person_data_url(person_image)
        else:
            person_bytes = _resolve_user_image_path(job.user_id).read_bytes()

        if garment_image:
            garment_bytes = _decode_person_data_url(garment_image)
        else:
            garment_bytes = _download_product_image_bytes(product_image_url)

        _update(job.job_id, progress=4, stage="Starting AI render")
        try:
            image_bytes, engine = generate_vton_image(
                person_image_bytes=person_bytes,
                garment_image_bytes=garment_bytes,
                cloth_type=cloth_type,
                quality=quality,
                progress_callback=progress,
            )
        except VtonError as exc:
            logger.warning("Job %s: AI engines unavailable (%s); using overlay engine.", job.job_id, exc)
            from services.tryon_engine import generate_tryon_image_from_bytes
            image_bytes = generate_tryon_image_from_bytes(
                person_bytes=person_bytes,
                garment_bytes=garment_bytes,
            )
            engine = "overlay"

        _update(job.job_id, progress=96, stage="Saving result")
        result_url = _store_tryon_image(image_bytes=image_bytes, user_id=job.user_id)
        _update(
            job.job_id,
            status="done",
            progress=100,
            stage="Done",
            engine=engine,
            resultUrl=result_url,
        )
        logger.info("Job %s finished with engine '%s'.", job.job_id, engine)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "Try-on failed."
        _update(job.job_id, status="failed", stage="Failed", error=detail)
        logger.warning("Job %s failed: %s", job.job_id, detail)
    except Exception as exc:
        _update(job.job_id, status="failed", stage="Failed", error="Try-on failed. Please try again.")
        logger.exception("Job %s crashed: %s", job.job_id, exc)
