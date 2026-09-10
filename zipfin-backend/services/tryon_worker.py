"""Background Worker Processor for Virtual Try-On Jobs.

Executes queue jobs with:
- GPU concurrency enforcement.
- Safe failure handling and retry logic.
- Progress reporting to distributed state.
- Data sanitization (no credentials, stack traces, or internal paths in output).
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
from typing import Callable

from core.security_logger import log_security_event
from services.tryon_queue import TryOnJob, get_tryon_queue
from services.tryon_engine import (
    _decode_person_data_url,
    _download_product_image_bytes,
    _resolve_user_image_path,
    _store_tryon_image,
)
from services.vton_engine import VtonError, generate_vton_image

logger = logging.getLogger(__name__)

_WORKER_THREAD: threading.Thread | None = None
_STOP_EVENT = threading.Event()


def is_retryable_error(exc: Exception) -> bool:
    """Determine whether an error is transient and safe to retry."""
    from fastapi import HTTPException
    if isinstance(exc, HTTPException):
        # 4xx client errors (bad image, face missing, etc.) must NEVER be retried
        return False

    error_str = str(exc).lower()
    # Permanent validation errors
    if any(term in error_str for term in ["validation", "invalid format", "no face detected", "not found"]):
        return False

    # Transient network/engine timeouts and connection errors are retryable
    if any(term in error_str for term in ["timeout", "connection", "rate limit", "busy", "503", "502"]):
        return True

    return False


def sanitize_error_message(exc: Exception) -> str:
    """Sanitize internal errors to prevent leaking paths, credentials, or model internals."""
    from fastapi import HTTPException
    if isinstance(exc, HTTPException):
        if isinstance(exc.detail, str):
            return exc.detail
        elif isinstance(exc.detail, dict) and "message" in exc.detail:
            return str(exc.detail["message"])
        return "Try-on request validation failed."

    error_str = str(exc).lower()
    if "no face" in error_str:
        return "Could not detect a clear face in the photo. Please use a well-lit photo looking straight at the camera."
    if "download" in error_str or "product image" in error_str:
        return "Failed to load product garment image. Please check the product link and try again."

    return "Virtual Try-On rendering failed. Please try again with a different photo or garment."


def execute_job(job_id: str) -> None:
    """Execute a single try-on job with GPU concurrency limits and retry policy."""
    queue = get_tryon_queue()
    job = queue.get_job(job_id)
    if not job:
        logger.warning("Worker received non-existent job ID %s", job_id)
        return

    # Check if job was cancelled or already done
    if job.status in {"done", "cancelled"}:
        return

    # Acquire GPU slot
    if not queue.try_acquire_gpu_slot():
        # GPU is fully saturated: delay and re-enqueue to prevent OOM
        logger.info("GPU concurrency limit reached. Re-queueing job %s.", job.job_id)
        time.sleep(1.0)
        from core.redis_client import get_redis_client
        get_redis_client().rpush("zipright:tryon:queue", job.job_id)
        return

    def progress_callback(fraction: float, stage: str) -> None:
        next_progress = max(job.progress, min(int(fraction * 100), 99))
        if next_progress > job.progress or stage != job.stage:
            job.progress = next_progress
            job.stage = stage
            queue.save_job(job)

    try:
        job.status = "running"
        job.started_at = time.time()
        job.progress = 2
        job.stage = "Preparing images"
        queue.save_job(job)

        log_security_event(
            event_type="TRYON_JOB_STARTED",
            severity="INFO",
            user_id=job.user_id,
            details={"job_id": job.job_id, "attempt": job.retry_count + 1},
        )

        # 1. Load person image
        if job.person_image:
            person_bytes = _decode_person_data_url(job.person_image)
        else:
            person_bytes = _resolve_user_image_path(job.user_id).read_bytes()

        # 2. Load garment image
        if job.garment_image:
            garment_bytes = _decode_person_data_url(job.garment_image)
        else:
            garment_bytes = _download_product_image_bytes(job.product_image_url)

        job.progress = 5
        job.stage = "Starting AI render"
        queue.save_job(job)

        # 3. Generate VTON
        image_bytes, engine = generate_vton_image(
            person_image_bytes=person_bytes,
            garment_image_bytes=garment_bytes,
            cloth_type=job.cloth_type,
            quality=job.quality,
            progress_callback=progress_callback,
        )

        # 4. Save and complete
        job.progress = 96
        job.stage = "Saving result"
        queue.save_job(job)

        result_url = _store_tryon_image(image_bytes=image_bytes, user_id=job.user_id)
        job.status = "done"
        job.progress = 100
        job.stage = "Done"
        job.engine = engine
        job.result_url = result_url
        job.completed_at = time.time()
        queue.save_job(job)

        log_security_event(
            event_type="TRYON_JOB_COMPLETED",
            severity="INFO",
            user_id=job.user_id,
            details={"job_id": job.job_id, "engine": engine},
        )

    except Exception as exc:
        logger.exception("Try-on job %s failed on attempt %d: %s", job.job_id, job.retry_count + 1, exc)
        can_retry = is_retryable_error(exc) and (job.retry_count < job.max_retries)

        if can_retry:
            job.retry_count += 1
            job.status = "queued"
            job.stage = f"Retrying (attempt {job.retry_count + 1} of {job.max_retries + 1})"
            queue.save_job(job)
            from core.redis_client import get_redis_client
            get_redis_client().rpush("zipright:tryon:queue", job.job_id)

            log_security_event(
                event_type="TRYON_JOB_RETRY",
                severity="WARNING",
                user_id=job.user_id,
                details={"job_id": job.job_id, "retry_count": job.retry_count},
            )
        else:
            job.status = "failed"
            job.stage = "Failed"
            job.error = sanitize_error_message(exc)
            job.completed_at = time.time()
            queue.save_job(job)

            log_security_event(
                event_type="TRYON_JOB_FAILED",
                severity="WARNING",
                user_id=job.user_id,
                details={"job_id": job.job_id, "error": job.error},
            )
    finally:
        queue.release_gpu_slot()
        if job.status in {"done", "failed"}:
            queue.decrement_user_active(job.user_id)


def worker_loop(stop_event: threading.Event) -> None:
    """Continuous queue polling loop for background workers."""
    queue = get_tryon_queue()
    logger.info("Try-on background worker started polling queue.")
    while not stop_event.is_set():
        try:
            job_id = queue.pop_job_id(timeout=1)
            if job_id:
                execute_job(job_id)
            else:
                time.sleep(0.5)
        except Exception as exc:
            logger.error("Error in try-on worker loop: %s", exc)
            time.sleep(1.0)


def start_background_worker() -> None:
    """Start the in-process queue worker thread for local dev / single instance."""
    global _WORKER_THREAD
    if _WORKER_THREAD is None or not _WORKER_THREAD.is_alive():
        _STOP_EVENT.clear()
        _WORKER_THREAD = threading.Thread(
            target=worker_loop,
            args=(_STOP_EVENT,),
            name="tryon-queue-worker",
            daemon=True,
        )
        _WORKER_THREAD.start()
        logger.info("Started in-process try-on queue worker thread.")


def stop_background_worker() -> None:
    """Signal background worker to stop gracefully."""
    _STOP_EVENT.set()
    if _WORKER_THREAD and _WORKER_THREAD.is_alive():
        _WORKER_THREAD.join(timeout=2.0)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger.info("Starting standalone Try-On Worker CLI...")
    stop_event = threading.Event()
    try:
        worker_loop(stop_event)
    except KeyboardInterrupt:
        logger.info("Shutting down worker...")
        stop_event.set()
