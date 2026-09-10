"""Phase 2: Reliability, Distributed State & Background Job Infrastructure Test Suite.

Validates the security invariants and reliability requirements for Phase 2:
- INFRA-01: Rate-limit state is shared across worker instances/processes.
- INFRA-02: Rate-limit expiration works cleanly.
- INFRA-03: Rate-limit state survives simulated worker restart.
- INFRA-04: Login lockout state is shared across workers.
- INFRA-05: Successful login clears appropriate failed-attempt state across workers.
- INFRA-06: Lockout expiration works and unlocks after duration.
- INFRA-07: Try-on jobs persist outside process memory.
- INFRA-08: Job status can be retrieved after worker restart.
- INFRA-09: User A cannot retrieve User B's job (403 Forbidden).
- INFRA-10: Controlled concurrency limits concurrent GPU execution to prevent OOM & Idempotency prevents duplicates.
- INFRA-11: Job failures transition cleanly to failed state with sanitized error.
- INFRA-12: Retry policy does not retry permanently invalid jobs forever.
- INFRA-13: Rate limiting blocks abuse when multiple workers receive requests.
- INFRA-14: Sensitive data is absent from infrastructure logs.
- INFRA-15: The production debug endpoint /api/debug-log is no longer available.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException, status
from fastapi.testclient import TestClient

from core.redis_client import get_redis_client, reset_redis_client_for_testing
from main import app
from services.account_lockout import (
    MAX_FAILED_ATTEMPTS,
    check_account_locked,
    record_failed_attempt,
    reset_failed_attempts,
)
from services.distributed_limiter import DistributedRateLimiter
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.tryon_jobs import get_job, start_tryon_job
from services.tryon_queue import TryOnJob, get_tryon_queue
from services.tryon_worker import execute_job, is_retryable_error, sanitize_error_message

CUSTOMER_A = AuthenticatedUser(uid="cust-alice-p2", email="alice.p2@example.com")
CUSTOMER_B = AuthenticatedUser(uid="cust-bob-p2", email="bob.p2@example.com")


@pytest.fixture(autouse=True)
def clean_redis_and_state():
    """Ensure each test runs with a fresh Redis state."""
    r = get_redis_client()
    r.flushall()
    yield
    r.flushall()


# ── INFRA-01: Rate-limit state is shared across worker instances ──────────────
def test_infra_01_rate_limit_shared_across_workers():
    """Requests hitting Worker A and Worker B share the exact same rate limit."""
    # Worker A and Worker B are two separate limiter instances representing distinct workers
    worker_a_limiter = DistributedRateLimiter(requests_per_minute=5, burst_limit=5)
    worker_b_limiter = DistributedRateLimiter(requests_per_minute=5, burst_limit=5)

    client_ip = "198.51.100.1"

    # Worker A handles 3 requests
    for _ in range(3):
        allowed, _, remaining = worker_a_limiter.is_allowed(client_ip)
        assert allowed is True

    # Worker B handles the 4th and 5th requests
    allowed, _, remaining = worker_b_limiter.is_allowed(client_ip)
    assert allowed is True
    assert remaining == 1

    allowed, _, remaining = worker_b_limiter.is_allowed(client_ip)
    assert allowed is True
    assert remaining == 0

    # 6th request hitting Worker A must be BLOCKED because the limit is shared
    allowed, retry_after, _ = worker_a_limiter.is_allowed(client_ip)
    assert allowed is False
    assert retry_after > 0

    # 7th request hitting Worker B must ALSO be blocked
    allowed, retry_after, _ = worker_b_limiter.is_allowed(client_ip)
    assert allowed is False
    assert retry_after > 0


# ── INFRA-02: Rate-limit expiration works ─────────────────────────────────────
def test_infra_02_rate_limit_expiration():
    """Expired rate limit entries are purged and new requests are allowed."""
    limiter = DistributedRateLimiter(requests_per_minute=2, burst_limit=2)
    client_ip = "198.51.100.2"

    allowed, _, _ = limiter.is_allowed(client_ip)
    assert allowed is True
    allowed, _, _ = limiter.is_allowed(client_ip)
    assert allowed is True

    # Limit reached
    allowed, _, _ = limiter.is_allowed(client_ip)
    assert allowed is False

    # Simulate passage of time (> 60 seconds)
    r = get_redis_client()
    key = f"zipright:ratelimit:{client_ip}"
    # Remove older entries simulating window roll
    r.delete(key)

    allowed, _, remaining = limiter.is_allowed(client_ip)
    assert allowed is True
    assert remaining == 1


# ── INFRA-03: Rate-limit state survives worker restart ────────────────────────
def test_infra_03_rate_limit_survives_worker_restart():
    """When a worker process dies and a new worker is spawned, rate-limit state remains."""
    worker_old = DistributedRateLimiter(requests_per_minute=3, burst_limit=3)
    client_ip = "198.51.100.3"

    # Worker handles requests
    worker_old.is_allowed(client_ip)
    worker_old.is_allowed(client_ip)

    # Worker dies and is garbage collected
    del worker_old

    # New worker instance spawns
    worker_new = DistributedRateLimiter(requests_per_minute=3, burst_limit=3)
    allowed, _, remaining = worker_new.is_allowed(client_ip)
    assert allowed is True
    assert remaining == 0

    # Next request on new worker exceeds limit
    allowed, retry_after, _ = worker_new.is_allowed(client_ip)
    assert allowed is False
    assert retry_after > 0


# ── INFRA-04: Login lockout state is shared across workers ─────────────────────
def test_infra_04_lockout_shared_across_workers():
    """Failed attempts on Worker 1 lock the account on Worker 2."""
    target_email = "victim@example.com"
    ip1 = "203.0.113.10"
    ip2 = "203.0.113.20"

    # Record 4 failed attempts from Worker 1
    for _ in range(MAX_FAILED_ATTEMPTS - 1):
        record_failed_attempt(target_email, ip_address=ip1)
        # Should not be locked yet
        check_account_locked(target_email, ip_address=ip1)

    # 5th failed attempt from Worker 2 triggers lockout
    record_failed_attempt(target_email, ip_address=ip2)

    # Worker 1 checking account lockout must raise HTTP 423 Locked!
    with pytest.raises(HTTPException) as exc_info:
        check_account_locked(target_email, ip_address=ip1)
    assert exc_info.value.status_code == status.HTTP_423_LOCKED

    # Worker 2 checking account lockout must ALSO raise HTTP 423 Locked!
    with pytest.raises(HTTPException) as exc_info:
        check_account_locked(target_email, ip_address=ip2)
    assert exc_info.value.status_code == status.HTTP_423_LOCKED


# ── INFRA-05: Successful login clears lockout state across workers ────────────
def test_infra_05_successful_login_clears_lockout():
    """Successful login on any worker clears failed attempts and unlocks account."""
    target_email = "user.success@example.com"
    record_failed_attempt(target_email)
    record_failed_attempt(target_email)

    r = get_redis_client()
    assert r.exists(f"zipright:lockout:attempts:{target_email}")

    # Successful authentication resets failed attempts
    reset_failed_attempts(target_email)

    # Verify both keys deleted from shared state
    assert not r.exists(f"zipright:lockout:attempts:{target_email}")
    assert not r.exists(f"zipright:lockout:locked:{target_email}")
    # No lockout
    check_account_locked(target_email)


# ── INFRA-06: Lockout expiration works ─────────────────────────────────────────
def test_infra_06_lockout_expiration():
    """Lockout auto-expires after duration and allows subsequent logins."""
    target_email = "expired.lockout@example.com"
    for _ in range(MAX_FAILED_ATTEMPTS):
        record_failed_attempt(target_email)

    # Currently locked
    with pytest.raises(HTTPException):
        check_account_locked(target_email)

    # Simulate expiration by setting unlock timestamp in the past
    r = get_redis_client()
    r.set(f"zipright:lockout:locked:{target_email}", str(time.time() - 10), ex=10)

    # check_account_locked detects expired lockout and unlocks cleanly
    check_account_locked(target_email)


# ── INFRA-07: Try-on jobs persist outside process memory ───────────────────────
def test_infra_07_tryon_jobs_persist_outside_process_memory():
    """Try-on job is durably stored in Redis and enqueued into shared FIFO queue."""
    queue = get_tryon_queue()
    job_id = queue.enqueue_job(
        user_id=CUSTOMER_A.uid,
        product_image_url="https://example.com/dress.jpg",
        cloth_type="upper",
        quality="standard",
    )

    r = get_redis_client()
    job_key = f"zipright:tryon:job:{job_id}"
    assert r.exists(job_key)

    raw_data = r.get(job_key)
    assert raw_data is not None
    job_dict = json.loads(raw_data)
    assert job_dict["job_id"] == job_id
    assert job_dict["user_id"] == CUSTOMER_A.uid
    assert job_dict["status"] == "queued"

    # Verify job ID is in the queue
    queue_items = r.lrange("zipright:tryon:queue", 0, -1)
    assert job_id in queue_items


# ── INFRA-08: Job status retrieved after worker restart ───────────────────────
def test_infra_08_job_status_retrieved_after_worker_restart():
    """Job created on Worker 1 can be retrieved by Worker 2 even after worker restart."""
    job_id = start_tryon_job(
        user_id=CUSTOMER_A.uid,
        product_image_url="https://example.com/shirt.jpg",
        cloth_type="upper",
        quality="standard",
    )

    # Simulate new worker instance reading the job
    retrieved_job = get_job(job_id)
    assert retrieved_job is not None
    assert retrieved_job.job_id == job_id
    assert retrieved_job.user_id == CUSTOMER_A.uid
    assert retrieved_job.status == "queued"


# ── INFRA-09: User A cannot retrieve User B's job ──────────────────────────────
def test_infra_09_user_isolation_on_tryon_job():
    """Customer B querying Customer A's job receives HTTP 403 Forbidden."""
    job_id = start_tryon_job(
        user_id=CUSTOMER_A.uid,
        product_image_url="https://example.com/coat.jpg",
        cloth_type="overall",
        quality="standard",
    )

    # Customer B requests Customer A's job status
    app.dependency_overrides[get_current_user] = lambda: CUSTOMER_B
    try:
        client = TestClient(app)
        resp = client.get(f"/tryon-job/{job_id}")
        assert resp.status_code == status.HTTP_403_FORBIDDEN
        assert "another user" in resp.json()["message"]
    finally:
        app.dependency_overrides.clear()


# ── INFRA-10: GPU Concurrency Control & Idempotency ───────────────────────────
def test_infra_10_gpu_concurrency_and_idempotency(monkeypatch):
    """Concurrency control limits active GPU jobs and idempotency avoids duplicate work."""
    queue = get_tryon_queue()

    # 1. Test GPU Concurrency Limit
    monkeypatch.setenv("TRYON_MAX_CONCURRENT_JOBS", "2")
    assert queue.try_acquire_gpu_slot() is True
    assert queue.try_acquire_gpu_slot() is True
    # 3rd attempt must be denied to prevent RTX 3050 VRAM OOM
    assert queue.try_acquire_gpu_slot() is False

    # Release one slot, then acquisition succeeds
    queue.release_gpu_slot()
    assert queue.try_acquire_gpu_slot() is True
    queue.release_gpu_slot()
    queue.release_gpu_slot()

    # 2. Test Idempotency
    idempotency_key = "idemp-req-unique-12345"
    job_id_1 = queue.enqueue_job(
        user_id=CUSTOMER_A.uid,
        product_image_url="https://example.com/suit.jpg",
        cloth_type="upper",
        quality="high",
        idempotency_key=idempotency_key,
    )

    # Re-sending with the same idempotency key returns the exact same job ID
    job_id_2 = queue.enqueue_job(
        user_id=CUSTOMER_A.uid,
        product_image_url="https://example.com/suit.jpg",
        cloth_type="upper",
        quality="high",
        idempotency_key=idempotency_key,
    )
    assert job_id_1 == job_id_2


# ── INFRA-11: Job failures transition to failed state ─────────────────────────
def test_infra_11_job_failure_state_transition():
    """Failing job transitions to failed state with a safe, sanitized error message."""
    queue = get_tryon_queue()
    sample_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    job_id = queue.enqueue_job(
        user_id=CUSTOMER_A.uid,
        product_image_url="https://example.com/bad.jpg",
        cloth_type="upper",
        quality="standard",
        person_image=sample_b64,
        garment_image=sample_b64,
    )

    # Simulate worker executing job that raises non-retryable error
    with patch("services.tryon_worker.generate_vton_image", side_effect=ValueError("no face detected")):
        execute_job(job_id)

    updated_job = queue.get_job(job_id)
    assert updated_job is not None
    assert updated_job.status == "failed"
    assert updated_job.stage == "Failed"
    # Error message must be user-friendly without stack traces or path names
    assert "face" in updated_job.error.lower()
    assert "Traceback" not in (updated_job.error or "")
    assert "C:\\" not in (updated_job.error or "")
    assert "/app/" not in (updated_job.error or "")


# ── INFRA-12: Retry policy does not retry permanently invalid jobs ────────────
def test_infra_12_retry_policy_classification():
    """Retry policy differentiates transient errors from permanent validation failures."""
    # Permanent client error -> NOT retryable
    client_err = HTTPException(status_code=422, detail="Invalid cloth type")
    assert is_retryable_error(client_err) is False

    val_err = ValueError("Invalid format: no face detected in input photo")
    assert is_retryable_error(val_err) is False

    # Transient network/engine timeouts -> retryable
    timeout_err = TimeoutError("Connection to AI inference engine timed out")
    assert is_retryable_error(timeout_err) is True


# ── INFRA-13: Rate limiting blocks abuse across multiple workers ───────────────
def test_infra_13_multi_worker_rate_limiting(monkeypatch):
    """Enforce rate limit across workers for critical routes like /auth/login."""
    monkeypatch.setenv("ENFORCE_TESTCLIENT_RATELIMIT", "1")
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    client = TestClient(app)

    # Route /auth/login has max_requests=10 per minute
    ip_header = {"X-Forwarded-For": "198.51.100.99"}

    with patch("routes.auth.sign_in_with_email", side_effect=HTTPException(status_code=401, detail="Invalid credentials")):
        # Send 10 login attempts with distinct emails to test route rate limit without triggering single-account lockout
        for i in range(10):
            resp = client.post(
                "/auth/login",
                json={"email": f"abuse_{i}@example.com", "password": "BadPassword123!"},
                headers=ip_header,
            )
            assert resp.status_code in {status.HTTP_401_UNAUTHORIZED, status.HTTP_429_TOO_MANY_REQUESTS}

        # 11th request from the same IP must trigger HTTP 429 Too Many Requests
        resp = client.post(
            "/auth/login",
            json={"email": "abuse_11@example.com", "password": "BadPassword123!"},
            headers=ip_header,
        )
        assert resp.status_code == status.HTTP_429_TOO_MANY_REQUESTS
        assert "Too many" in resp.json()["message"]


# ── INFRA-14: Sensitive data absent from infrastructure logs ──────────────────
def test_infra_14_sensitive_data_absent_from_logs(caplog):
    """Ensure passwords, secret tokens, and raw photo bytes are absent from logs."""
    caplog.set_level(logging.INFO)
    queue = get_tryon_queue()

    # Enqueue a job with a mock sensitive product url
    job_id = queue.enqueue_job(
        user_id="user-sensitive-test",
        product_image_url="https://example.com/item?token=supersecret123",
        cloth_type="upper",
        quality="standard",
    )

    # Check captured logs
    for record in caplog.records:
        msg = record.getMessage()
        assert "supersecret123" not in msg
        assert "password" not in msg.lower() or "reset" in msg.lower()
        assert "base64" not in msg


# ── INFRA-15: Production debug endpoint is no longer available ────────────────
def test_infra_15_debug_endpoint_removed():
    """Verify POST /api/debug-log has been completely removed and returns 404."""
    # 1. Verify server.ts no longer contains /api/debug-log
    server_ts_path = Path(__file__).resolve().parent.parent.parent / "zipfend" / "server.ts"
    if server_ts_path.exists():
        server_ts_content = server_ts_path.read_text(encoding="utf-8")
        assert "/api/debug-log" not in server_ts_content
        assert "debug-6c1938.log" not in server_ts_content

    # 2. Verify FastAPI backend returns 404 for /api/debug-log
    client = TestClient(app)
    resp = client.post("/api/debug-log", json={"debug": "test"})
    assert resp.status_code == status.HTTP_404_NOT_FOUND
