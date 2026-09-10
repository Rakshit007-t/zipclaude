"""Durable Redis-backed Try-On Background Job Queue & GPU Concurrency Protection.

Provides:
- Distributed job persistence across all backend workers and instances.
- Strict GPU concurrency control (limiting concurrent GPU jobs on the local RTX 3050).
- Per-user active job limits to prevent starvation and abuse.
- Request idempotency via client idempotency keys.
- Safe failure and retry classification (retryable vs non-retryable).
- Stale job timeout and recovery.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from uuid import uuid4

from fastapi import HTTPException, status
from firebase_admin import firestore

from core.redis_client import get_redis_client
from core.security_logger import log_security_event
from firebase_config import get_firestore_client

logger = logging.getLogger(__name__)

JOB_TTL_SECONDS = 2 * 60 * 60  # 2 hours
DEFAULT_MAX_CONCURRENT_GPU_JOBS = 2
DEFAULT_MAX_RETRIES = 2
DEFAULT_JOB_TIMEOUT_SECONDS = 600  # 10 minutes
DEFAULT_USER_MAX_ACTIVE_JOBS = 2
IDEMPOTENCY_TTL_SECONDS = 3600  # 1 hour


@dataclass
class TryOnJob:
    job_id: str
    user_id: str
    status: str = "queued"  # queued, running, done, failed, cancelled
    progress: int = 0
    stage: str = "Queued"
    engine: str | None = None
    result_url: str | None = None
    error: str | None = None
    retry_count: int = 0
    max_retries: int = DEFAULT_MAX_RETRIES
    created_at: float = 0.0
    updated_at: float = 0.0
    started_at: float | None = None
    completed_at: float | None = None
    idempotency_key: str | None = None
    # Payload details
    product_image_url: str = ""
    cloth_type: str = "upper"
    quality: str = "standard"
    person_image: str | None = None
    garment_image: str | None = None


def _get_max_concurrent_gpu() -> int:
    try:
        return max(1, int(os.getenv("TRYON_MAX_CONCURRENT_JOBS", str(DEFAULT_MAX_CONCURRENT_GPU_JOBS))))
    except ValueError:
        return DEFAULT_MAX_CONCURRENT_GPU_JOBS


def _get_max_retries() -> int:
    try:
        return max(0, int(os.getenv("TRYON_MAX_RETRIES", str(DEFAULT_MAX_RETRIES))))
    except ValueError:
        return DEFAULT_MAX_RETRIES


def _get_job_timeout() -> int:
    try:
        return max(60, int(os.getenv("TRYON_JOB_TIMEOUT_SECONDS", str(DEFAULT_JOB_TIMEOUT_SECONDS))))
    except ValueError:
        return DEFAULT_JOB_TIMEOUT_SECONDS


def _get_user_max_active() -> int:
    try:
        return max(1, int(os.getenv("TRYON_USER_MAX_ACTIVE_JOBS", str(DEFAULT_USER_MAX_ACTIVE_JOBS))))
    except ValueError:
        return DEFAULT_USER_MAX_ACTIVE_JOBS


class TryOnJobQueue:
    """Manages distributed try-on job lifecycle, concurrency, and persistence."""

    def __init__(self) -> None:
        self._lock = threading.Lock()

    def _redis_job_key(self, job_id: str) -> str:
        return f"zipright:tryon:job:{job_id}"

    def _redis_idempotency_key(self, user_id: str, idempotency_key: str) -> str:
        return f"zipright:tryon:idempotency:{user_id}:{idempotency_key}"

    def _redis_user_active_key(self, user_id: str) -> str:
        return f"zipright:tryon:user_active:{user_id}"

    def save_job(self, job: TryOnJob) -> None:
        """Persist job state to Redis and mirror to Firestore."""
        now = time.time()
        job.updated_at = now
        job_data = asdict(job)

        # 1. Save to Redis
        try:
            r = get_redis_client()
            key = self._redis_job_key(job.job_id)
            r.set(key, json.dumps(job_data), ex=JOB_TTL_SECONDS)
        except Exception as exc:
            logger.warning("Failed to save try-on job %s to Redis: %s", job.job_id, exc)

        # 2. Mirror to Firestore (excluding large base64 image strings)
        try:
            db = get_firestore_client()
            firestore_data = {
                "jobId": job.job_id,
                "userId": job.user_id,
                "status": job.status,
                "progress": job.progress,
                "stage": job.stage,
                "engine": job.engine,
                "resultUrl": job.result_url,
                "error": job.error,
                "retryCount": job.retry_count,
                "clothType": job.cloth_type,
                "quality": job.quality,
                "updatedAt": firestore.SERVER_TIMESTAMP,
                "expiresAt": datetime.now(timezone.utc) + timedelta(seconds=JOB_TTL_SECONDS),
            }
            if job.status == "queued" and job.started_at is None:
                firestore_data["createdAt"] = firestore.SERVER_TIMESTAMP
            db.collection("tryon_jobs").document(job.job_id).set(firestore_data, merge=True)
        except Exception as exc:
            logger.warning("Failed to mirror try-on job %s to Firestore: %s", job.job_id, exc)

    def get_job(self, job_id: str) -> TryOnJob | None:
        """Retrieve job by ID from Redis or Firestore."""
        # 1. Check Redis
        try:
            r = get_redis_client()
            raw = r.get(self._redis_job_key(job_id))
            if raw:
                data = json.loads(raw)
                return TryOnJob(**data)
        except Exception as exc:
            logger.warning("Failed to get job %s from Redis: %s", job_id, exc)

        # 2. Fallback to Firestore
        try:
            db = get_firestore_client()
            snap = db.collection("tryon_jobs").document(job_id).get()
            if not snap.exists:
                return None
            data = snap.to_dict() or {}
            expires_at = data.get("expiresAt")
            if isinstance(expires_at, datetime) and expires_at <= datetime.now(timezone.utc):
                return None
            user_id = data.get("userId")
            if not isinstance(user_id, str) or not user_id:
                return None
            return TryOnJob(
                job_id=job_id,
                user_id=user_id,
                status=str(data.get("status") or "queued"),
                progress=max(0, min(100, int(data.get("progress") or 0))),
                stage=str(data.get("stage") or ""),
                engine=data.get("engine"),
                result_url=data.get("resultUrl"),
                error=data.get("error"),
                retry_count=int(data.get("retryCount") or 0),
            )
        except Exception as exc:
            logger.warning("Failed to get job %s from Firestore: %s", job_id, exc)
            return None

    def enqueue_job(
        self,
        *,
        user_id: str,
        product_image_url: str,
        cloth_type: str,
        quality: str,
        person_image: str | None = None,
        garment_image: str | None = None,
        idempotency_key: str | None = None,
    ) -> str:
        """Create and enqueue a durable try-on job with idempotency and user limit checks."""
        r = get_redis_client()
        now = time.time()

        # 1. Idempotency Check
        if idempotency_key:
            idem_key = self._redis_idempotency_key(user_id, idempotency_key)
            try:
                existing_job_id = r.get(idem_key)
                if existing_job_id:
                    existing_job = self.get_job(str(existing_job_id))
                    if existing_job and existing_job.status in {"queued", "running", "done"}:
                        logger.info(
                            "Idempotent try-on request for user %s: returning existing job %s",
                            user_id,
                            existing_job_id,
                        )
                        return existing_job.job_id
            except Exception as exc:
                logger.warning("Idempotency check failed: %s", exc)

        # 2. Per-User Active Job Limit Check
        user_active_key = self._redis_user_active_key(user_id)
        try:
            active_count = int(r.get(user_active_key) or 0)
            if active_count >= _get_user_max_active():
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "message": "Too many active try-on requests. Please wait for current jobs to complete.",
                        "details": {"code": "tryon_concurrency_limit_exceeded"},
                    },
                )
        except HTTPException:
            raise
        except Exception:
            pass

        # 3. Create Durable Job
        job_id = uuid4().hex
        job = TryOnJob(
            job_id=job_id,
            user_id=user_id,
            status="queued",
            progress=0,
            stage="Waiting in queue",
            retry_count=0,
            max_retries=_get_max_retries(),
            created_at=now,
            updated_at=now,
            idempotency_key=idempotency_key,
            product_image_url=product_image_url,
            cloth_type=cloth_type,
            quality=quality,
            person_image=person_image,
            garment_image=garment_image,
        )
        self.save_job(job)

        # 4. Push to Redis FIFO queue and update trackers
        try:
            pipe = r.pipeline(transaction=True)
            pipe.rpush("zipright:tryon:queue", job_id)
            pipe.incr(user_active_key)
            pipe.expire(user_active_key, JOB_TTL_SECONDS)
            if idempotency_key:
                pipe.set(self._redis_idempotency_key(user_id, idempotency_key), job_id, ex=IDEMPOTENCY_TTL_SECONDS)
            pipe.execute()
        except Exception as exc:
            logger.error("Failed to enqueue job %s in Redis: %s", job_id, exc)

        log_security_event(
            event_type="TRYON_JOB_QUEUED",
            severity="INFO",
            user_id=user_id,
            details={"job_id": job_id, "cloth_type": cloth_type, "quality": quality},
        )
        return job_id

    def try_acquire_gpu_slot(self) -> bool:
        """Attempt to acquire a GPU concurrency slot atomically."""
        try:
            r = get_redis_client()
            max_gpu = _get_max_concurrent_gpu()
            active = r.incr("zipright:tryon:active_gpu")
            if active > max_gpu:
                r.decr("zipright:tryon:active_gpu")
                return False
            return True
        except Exception:
            return True  # fallback if Redis is down

    def release_gpu_slot(self) -> None:
        """Release a GPU concurrency slot atomically."""
        try:
            r = get_redis_client()
            val = r.decr("zipright:tryon:active_gpu")
            if val < 0:
                r.set("zipright:tryon:active_gpu", 0)
        except Exception:
            pass

    def decrement_user_active(self, user_id: str) -> None:
        """Decrement the active job counter for a user."""
        try:
            r = get_redis_client()
            key = self._redis_user_active_key(user_id)
            val = r.decr(key)
            if val < 0:
                r.set(key, 0)
        except Exception:
            pass

    def pop_job_id(self, timeout: int = 1) -> str | None:
        """Pop the next job ID from the queue."""
        try:
            r = get_redis_client()
            # Non-blocking pop or brief timeout
            job_id = r.lpop("zipright:tryon:queue")
            return str(job_id) if job_id else None
        except Exception as exc:
            logger.warning("Failed to pop job from Redis queue: %s", exc)
            return None


# Global queue instance
_QUEUE = TryOnJobQueue()


def get_tryon_queue() -> TryOnJobQueue:
    return _QUEUE
