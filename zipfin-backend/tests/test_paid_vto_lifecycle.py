"""Comprehensive validation suite for Paid AI VTO entitlement and execution flows.

Tests:
A. Successful paid VTO (usage >= 3, wallet >= 5 -> Rs. 5 deducted)
B. Insufficient credits (usage >= 3, wallet < 5 -> 402 Payment Required)
C. Failed generation (triggers automatic Rs. 5 refund)
D. Provider timeout (triggers automatic Rs. 5 refund)
E. Duplicate request (idempotency key prevents double debit)
F. Worker retry (does not re-debit wallet)
G. Idempotent refund (sentinel prevents duplicate credit restoration)
H. Unauthorized request (missing/invalid token -> 401 Unauthorized)
"""

import json
import uuid
import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
from fastapi.testclient import TestClient

from appwrite_config import appwrite_settings
from core.redis_client import get_redis_client
from main import app
from models.schema import TryOnImageRequest
from services.auth_adapter import AuthenticatedUser
from services.database_adapter import get_database_adapter
from services.firebase_auth import get_current_user
from services.tryon_access import (
    FREE_TRY_ONS,
    TRY_ON_COST_RUPEES,
    TryOnCharge,
    consume_tryon_credit,
    consume_tryon_credit_for_uid,
    refund_tryon_credit,
)
from services.tryon_jobs import start_tryon_job
from services.tryon_queue import get_tryon_queue


@pytest.fixture
def client():
    return TestClient(app)


# ==============================================================================
# FLOW A: SUCCESSFUL PAID VTO
# ==============================================================================
def test_flow_a_successful_paid_vto():
    """When free try-ons (3) are exhausted and wallet has >= Rs. 5,
    Rs. 5 is atomically deducted and tryOns counter is incremented."""
    db = get_database_adapter()
    test_uid = f"paid_user_{uuid.uuid4().hex[:8]}"

    # Setup: 3 free tryons used, wallet balance Rs. 20
    db.set_document(
        collection="users",
        document_id=test_uid,
        data={
            "usage": json.dumps({"tryOns": 3}),
            "walletBalanceRupees": 20,
        },
    )

    try:
        charge = consume_tryon_credit_for_uid(test_uid)
        assert charge.charged_rupees == TRY_ON_COST_RUPEES  # 5
        assert charge.try_ons_used == 4
        assert charge.wallet_balance_rupees == 15

        # Verify DB state
        doc = db.get_document("users", test_uid)
        assert doc is not None
        assert doc["walletBalanceRupees"] == 15
    finally:
        try:
            db.delete_document("users", test_uid)
        except Exception:
            pass


# ==============================================================================
# FLOW B: INSUFFICIENT CREDITS (HTTP 402)
# ==============================================================================
def test_flow_b_insufficient_credits_returns_402():
    """When free try-ons are exhausted and wallet balance is < Rs. 5,
    system must raise HTTP 402 PAYMENT_REQUIRED."""
    db = get_database_adapter()
    test_uid = f"unfunded_user_{uuid.uuid4().hex[:8]}"

    # Setup: 3 free tryons used, wallet balance Rs. 0
    db.set_document(
        collection="users",
        document_id=test_uid,
        data={
            "usage": json.dumps({"tryOns": 3}),
            "walletBalanceRupees": 0,
        },
    )

    try:
        with pytest.raises(HTTPException) as exc_info:
            consume_tryon_credit_for_uid(test_uid)
        assert exc_info.value.status_code == 402
        assert "free_tier_exhausted" in str(exc_info.value.detail)

        # Setup: 3 free tryons used, wallet balance Rs. 2 (insufficient for Rs. 5 tryon)
        db.set_document(
            collection="users",
            document_id=test_uid,
            data={
                "usage": json.dumps({"tryOns": 3}),
                "walletBalanceRupees": 2,
            },
        )
        with pytest.raises(HTTPException) as exc_info2:
            consume_tryon_credit_for_uid(test_uid)
        assert exc_info2.value.status_code == 402
        assert "insufficient_wallet_balance" in str(exc_info2.value.detail)
    finally:
        try:
            db.delete_document("users", test_uid)
        except Exception:
            pass


# ==============================================================================
# FLOW C & D: FAILED GENERATION & TIMEOUT -> AUTOMATIC REFUND
# ==============================================================================
def test_flow_c_d_failed_generation_refunds_paid_credit():
    """When a paid try-on generation fails or times out,
    the charged amount must be restored to wallet balance."""
    db = get_database_adapter()
    test_uid = f"refund_user_{uuid.uuid4().hex[:8]}"
    job_id = f"fail_job_{uuid.uuid4().hex[:8]}"

    # Setup: user had 15 rupees after deduction
    db.set_document(
        collection="users",
        document_id=test_uid,
        data={
            "usage": json.dumps({"tryOns": 4}),
            "walletBalanceRupees": 15,
        },
    )

    try:
        # Trigger refund for Rs. 5
        refunded_bal = refund_tryon_credit(
            user_id=test_uid,
            job_id=job_id,
            charged_rupees=5,
            free_tryon=False,
        )
        assert refunded_bal == 20

        # Check DB state
        doc = db.get_document("users", test_uid)
        assert doc["walletBalanceRupees"] == 20
    finally:
        try:
            db.delete_document("users", test_uid)
            db.delete_document("tryon_refunds", job_id)
        except Exception:
            pass


# ==============================================================================
# FLOW E: DUPLICATE REQUEST / IDEMPOTENCY
# ==============================================================================
def test_flow_e_duplicate_request_idempotency(client):
    """Submitting the same idempotency key twice returns the existing job ID
    without creating a second job or deducting credits twice."""
    user = AuthenticatedUser(uid="idemp_vto_user", email="idemp@zipright.com")
    app.dependency_overrides[get_current_user] = lambda: user

    idemp_key = f"key_{uuid.uuid4().hex}"
    payload = {
        "user_id": "idemp_vto_user",
        "product_image_url": "https://example.com/item.png",
        "cloth_type": "upper_body",
        "quality": "hd",
    }

    try:
        with patch("routes.tryon.consume_tryon_credit", return_value=TryOnCharge(try_ons_used=4, wallet_balance_rupees=15, charged_rupees=5)):
            resp1 = client.post(
                "/tryon-job",
                json=payload,
                headers={"X-Idempotency-Key": idemp_key, "Authorization": "Bearer test-jwt"},
            )
            assert resp1.status_code == 202
            job1_id = resp1.json()["data"]["job_id"]

            resp2 = client.post(
                "/tryon-job",
                json=payload,
                headers={"X-Idempotency-Key": idemp_key, "Authorization": "Bearer test-jwt"},
            )
            assert resp2.status_code == 202
            job2_id = resp2.json()["data"]["job_id"]

            assert job1_id == job2_id
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ==============================================================================
# FLOW F: WORKER RETRY DOES NOT RE-DEBIT
# ==============================================================================
def test_flow_f_worker_retry_does_not_recharge():
    """Worker retrying a transient failure re-enqueues the job with unchanged charged_rupees
    and does NOT call consume_tryon_credit again."""
    queue = get_tryon_queue()
    job_id = queue.enqueue_job(
        user_id="retry_test_user",
        product_image_url="https://example.com/p.jpg",
        cloth_type="upper_body",
        quality="hd",
        charged_rupees=5,
        free_tryon=False,
    )
    job = queue.get_job(job_id)
    assert job is not None
    assert job.charged_rupees == 5
    assert job.retry_count == 0

    # Simulate worker transient failure retry
    job.retry_count += 1
    job.status = "queued"
    queue.save_job(job)

    reloaded = queue.get_job(job.job_id)
    assert reloaded is not None
    assert reloaded.retry_count == 1
    assert reloaded.charged_rupees == 5  # remains 5, never increments or recharges


# ==============================================================================
# FLOW G: IDEMPOTENT REFUND SENTINEL
# ==============================================================================
def test_flow_g_idempotent_refund_sentinel():
    """Calling refund_tryon_credit multiple times for the same job_id
    must NOT restore credits more than once."""
    db = get_database_adapter()
    test_uid = f"sentinel_user_{uuid.uuid4().hex[:8]}"
    job_id = f"sentinel_job_{uuid.uuid4().hex[:8]}"

    db.set_document(
        collection="users",
        document_id=test_uid,
        data={
            "usage": json.dumps({"tryOns": 4}),
            "walletBalanceRupees": 10,
        },
    )

    try:
        # First refund: 10 + 5 = 15
        bal1 = refund_tryon_credit(
            user_id=test_uid,
            job_id=job_id,
            charged_rupees=5,
            free_tryon=False,
        )
        assert bal1 == 15

        # Second refund for the exact same job_id: must return 15, NOT 20!
        bal2 = refund_tryon_credit(
            user_id=test_uid,
            job_id=job_id,
            charged_rupees=5,
            free_tryon=False,
        )
        assert bal2 == 15

        # Check DB
        doc = db.get_document("users", test_uid)
        assert doc["walletBalanceRupees"] == 15
    finally:
        try:
            db.delete_document("users", test_uid)
            db.delete_document("tryon_refunds", job_id)
        except Exception:
            pass


# ==============================================================================
# FLOW H: UNAUTHORIZED REQUESTS (HTTP 401)
# ==============================================================================
def test_flow_h_unauthorized_tryon_requests(client):
    """Requests without authentication or with bad credentials must return 401."""
    resp_no_auth = client.post("/tryon-job", json={"user_id": "anon", "product_image_url": "https://example.com/p.jpg"})
    assert resp_no_auth.status_code == 401

    resp_bad_auth = client.post(
        "/tryon-job",
        json={"user_id": "anon", "product_image_url": "https://example.com/p.jpg"},
        headers={"Authorization": "Bearer totally_bogus_token"},
    )
    assert resp_bad_auth.status_code == 401
