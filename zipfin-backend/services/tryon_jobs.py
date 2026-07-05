"""Background try-on jobs.

Generation runs in a server-side thread keyed by a job id, so closing or
minimizing the app/browser does not cancel it — the client just polls
GET /tryon-job/{id} whenever it comes back. Progress is a real 0-100
percentage (per-diffusion-step for the local engine).
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from uuid import uuid4

logger = logging.getLogger(__name__)

_JOBS: dict[str, "TryOnJob"] = {}
_JOBS_LOCK = threading.Lock()
_JOB_TTL_SECONDS = 2 * 60 * 60


@dataclass
class TryOnJob:
    job_id: str
    user_id: str
    status: str = "queued"  # queued | running | done | failed
    progress: int = 0
    stage: str = "Queued"
    engine: str | None = None
    result_url: str | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.monotonic)


def _cleanup_expired() -> None:
    now = time.monotonic()
    expired = [
        job_id
        for job_id, job in _JOBS.items()
        if now - job.created_at > _JOB_TTL_SECONDS
    ]
    for job_id in expired:
        _JOBS.pop(job_id, None)


def _update(job: TryOnJob, **changes) -> None:
    with _JOBS_LOCK:
        for key, value in changes.items():
            setattr(job, key, value)


def get_job(job_id: str) -> TryOnJob | None:
    with _JOBS_LOCK:
        _cleanup_expired()
        return _JOBS.get(job_id)


def start_tryon_job(
    *,
    user_id: str,
    product_image_url: str,
    cloth_type: str,
    quality: str,
    person_image: str | None,
    garment_image: str | None,
) -> str:
    job = TryOnJob(job_id=uuid4().hex, user_id=user_id)
    with _JOBS_LOCK:
        _cleanup_expired()
        _JOBS[job.job_id] = job

    thread = threading.Thread(
        target=_run_job,
        kwargs={
            "job": job,
            "product_image_url": product_image_url,
            "cloth_type": cloth_type,
            "quality": quality,
            "person_image": person_image,
            "garment_image": garment_image,
        },
        daemon=True,
        name=f"tryon-job-{job.job_id[:8]}",
    )
    thread.start()
    return job.job_id


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

    def progress(fraction: float, stage: str) -> None:
        _update(job, progress=max(job.progress, min(int(fraction * 100), 99)), stage=stage)

    try:
        _update(job, status="running", progress=1, stage="Preparing images")

        if person_image:
            person_bytes = _decode_person_data_url(person_image)
        else:
            person_bytes = _resolve_user_image_path(job.user_id).read_bytes()

        if garment_image:
            garment_bytes = _decode_person_data_url(garment_image)
        else:
            garment_bytes = _download_product_image_bytes(product_image_url)

        _update(job, progress=4, stage="Starting AI render")
        try:
            image_bytes, engine = generate_vton_image(
                person_image_bytes=person_bytes,
                garment_image_bytes=garment_bytes,
                cloth_type=cloth_type,
                quality=quality,
                progress_callback=progress,
            )
        except VtonError as exc:
            # No overlay fallback here: a flat paste looks broken to users.
            # Fail honestly and let them retry.
            logger.warning("Job %s: all AI engines failed: %s", job.job_id, exc)
            _update(
                job,
                status="failed",
                stage="Failed",
                error="AI renderers are busy right now — tap Try Again in a minute.",
            )
            return

        _update(job, progress=96, stage="Saving result")
        result_url = _store_tryon_image(image_bytes=image_bytes, user_id=job.user_id)
        _update(
            job,
            status="done",
            progress=100,
            stage="Done",
            engine=engine,
            result_url=result_url,
        )
        logger.info("Job %s finished with engine '%s'.", job.job_id, engine)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "Try-on failed."
        _update(job, status="failed", stage="Failed", error=detail)
        logger.warning("Job %s failed: %s", job.job_id, detail)
    except Exception as exc:
        _update(job, status="failed", stage="Failed", error="Try-on failed. Please try again.")
        logger.exception("Job %s crashed: %s", job.job_id, exc)
