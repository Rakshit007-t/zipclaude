"""Durable distributed background try-on jobs.

State transitions and job records are persisted in Redis and mirrored to Firestore.
Requests can be handled and polled by any worker instance without loss of state.
Execution is managed through the distributed TryOnJobQueue with GPU concurrency limits.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from services.tryon_queue import TryOnJob, get_tryon_queue
from services.tryon_worker import start_background_worker

logger = logging.getLogger(__name__)


def get_job(job_id: str) -> TryOnJob | None:
    """Retrieve job by ID from distributed state with server ownership."""
    return get_tryon_queue().get_job(job_id)


def start_tryon_job(
    *,
    user_id: str,
    product_image_url: str,
    cloth_type: str,
    quality: str,
    person_image: str | None = None,
    garment_image: str | None = None,
    idempotency_key: str | None = None,
) -> str:
    """Create and enqueue a durable try-on job."""
    # Ensure queue worker is active in development/single-instance mode (disabled during automated test runs)
    import os
    if os.getenv("PYTEST_CURRENT_TEST") is None and os.getenv("DISABLE_TRYON_WORKER", "0") != "1":
        start_background_worker()

    queue = get_tryon_queue()
    return queue.enqueue_job(
        user_id=user_id,
        product_image_url=product_image_url,
        cloth_type=cloth_type,
        quality=quality,
        person_image=person_image,
        garment_image=garment_image,
        idempotency_key=idempotency_key,
    )
