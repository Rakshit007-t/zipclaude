"""Real Authenticated Paid AI VTO End-to-End Validation Journey.

Demonstrates and verifies:
1. User with exhausted free tier (usage.tryOns >= 3) and wallet funds (₹20).
2. Entitlement verification before request.
3. Authenticated POST /tryon-job submission.
4. Immediate atomic wallet debit (₹20 -> ₹15, charged_rupees=5, free_tryon=False).
5. Background worker execution (queued -> running -> done).
6. Result delivery via GET /tryon-job/{job_id}.
7. Final wallet & deduction integrity verification.
"""

from __future__ import annotations

import base64
import os
import sys
import time
import uuid
from pathlib import Path

# Add backend to sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient
from main import create_app
from firebase_config import get_firestore_client
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.tryon_queue import get_tryon_queue
from services.tryon_worker import execute_job

def run_paid_vto_e2e_journey():
    print("=================================================================")
    print("STARTING REAL AUTHENTICATED PAID AI VTO END-TO-END JOURNEY")
    print("=================================================================")

    # 1. Setup authenticated test user with exhausted free tier and ₹20 wallet
    uid = f"paid_vto_user_{uuid.uuid4().hex[:8]}"
    email = f"{uid}@example.com"
    initial_balance = 20
    db = get_firestore_client()

    print(f"\n[STAGE 1: USER PROVISIONING & ENTITLEMENT VERIFICATION]")
    db.collection("users").document(uid).set({
        "email": email,
        "walletBalanceRupees": initial_balance,
        "usage": {
            "tryOns": 3,  # Free tier (FREE_TRY_ONS = 3) is completely exhausted!
        },
    })
    print(f"  User ID: {uid}")
    print(f"  Free try-ons used: 3 (Free tier exhausted, limit = 3)")
    print(f"  Initial wallet balance: Rs {initial_balance}")

    # 2. Configure mock authenticated user dependency
    auth_user = AuthenticatedUser(
        uid=uid,
        email=email,
        is_anonymous=False,
    )
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: auth_user

    # 3. Prepare representative sample images (frontal male + collared shirt)
    person_path = backend_dir / "vendor/CatVTON/resource/demo/example/person/men/Simon_1.png"
    garment_path = backend_dir / "vendor/CatVTON/resource/demo/example/condition/upper/22790049_53294275_1000.jpg"

    with open(person_path, "rb") as f:
        person_b64 = "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")
    with open(garment_path, "rb") as f:
        garment_b64 = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("ascii")

    print(f"\n[STAGE 2: PAID VTO REQUEST SUBMISSION]")
    client = TestClient(app)
    t0 = time.time()
    resp = client.post(
        "/tryon-job",
        json={
            "user_id": uid,
            "product_image_url": "https://example.com/products/collared_shirt.jpg",
            "cloth_type": "upper_body",
            "quality": "hd",
            "person_image": person_b64,
            "garment_image": garment_b64,
        },
    )
    submit_latency = time.time() - t0
    print(f"  POST /tryon-job HTTP Status: {resp.status_code}")
    print(f"  Submission Latency: {submit_latency:.3f}s")
    assert resp.status_code == 202, f"Expected 202, got {resp.status_code}: {resp.text}"

    data = resp.json().get("data", {})
    job_id = data.get("job_id")
    print(f"  Assigned Job ID: {job_id}")
    assert job_id, "Missing job_id in response"

    # 4. Verify Immediate Atomic Deduction
    print(f"\n[STAGE 3: VERIFY IMMEDIATE ATOMIC DEDUCTION]")
    user_doc = db.collection("users").document(uid).get().to_dict()
    new_balance = user_doc.get("walletBalanceRupees")
    tryons_count = user_doc.get("usage", {}).get("tryOns")
    print(f"  Wallet balance after submission: Rs {new_balance} (Expected: Rs 15)")
    print(f"  Try-ons count after submission: {tryons_count} (Expected: 4)")
    assert new_balance == 15, f"Expected Rs 15, got {new_balance}"
    assert tryons_count == 4, f"Expected 4 try-ons, got {tryons_count}"

    # Verify Job Metadata in Queue
    queue = get_tryon_queue()
    job = queue.get_job(job_id)
    assert job is not None
    print(f"  Queue state: {job.status}")
    print(f"  Charged Rupees recorded on job: Rs {job.charged_rupees}")
    print(f"  Free Try-on flag: {job.free_tryon}")
    assert job.charged_rupees == 5
    assert job.free_tryon is False

    # 5. Execute Job with Worker (Real AI Inference)
    print(f"\n[STAGE 4: WORKER AI INFERENCE EXECUTION]")
    print("  Executing job via worker (CatVTON diffusion + Real-ESRGAN super-resolution)...")
    inference_start = time.time()
    execute_job(job_id)
    inference_time = time.time() - inference_start
    print(f"  Inference completed in: {inference_time:.2f}s")

    # 6. Check Job Completion and Result URL
    print(f"\n[STAGE 5: RESULT POLLING & VERIFICATION]")
    status_resp = client.get(f"/tryon-job/{job_id}")
    print(f"  GET /tryon-job/{job_id} HTTP Status: {status_resp.status_code}")
    assert status_resp.status_code == 200, f"Expected 200, got {status_resp.status_code}: {status_resp.text}"
    status_data = status_resp.json().get("data", {})
    print(f"  Final Job Status: {status_data.get('status')}")
    print(f"  Progress: {status_data.get('progress')}%")
    print(f"  Engine: {status_data.get('engine')}")
    print(f"  Result URL: {status_data.get('tryon_image')}")
    assert status_data.get("status") == "done", f"Job status is {status_data.get('status')}"
    result_url = status_data.get("tryon_image")
    assert result_url, "Missing tryon_image in status response"

    # 7. Test Image Fetch/Download
    print(f"\n[STAGE 6: RESULT DOWNLOAD VERIFICATION]")
    # If it's a relative URL or local media endpoint, test fetching it
    if result_url.startswith("/"):
        img_resp = client.get(result_url)
        print(f"  Fetch local media HTTP Status: {img_resp.status_code}")
        print(f"  Downloaded byte size: {len(img_resp.content)} bytes")
        assert img_resp.status_code == 200
        assert len(img_resp.content) > 10000, "Image content too small"
    else:
        print(f"  External/Storage result URL generated: {result_url[:60]}...")

    # 8. Verify No Double Deduction and Intact Balance
    print(f"\n[STAGE 7: POST-GENERATION BALANCE INTEGRITY]")
    final_user_doc = db.collection("users").document(uid).get().to_dict()
    final_balance = final_user_doc.get("walletBalanceRupees")
    final_tryons = final_user_doc.get("usage", {}).get("tryOns")
    print(f"  Final wallet balance: Rs {final_balance} (Expected: Rs 15)")
    print(f"  Final try-ons count: {final_tryons} (Expected: 4)")
    assert final_balance == 15, "Wallet balance changed unexpectedly after completion"
    assert final_tryons == 4, "Try-ons count changed unexpectedly after completion"

    print("\n=================================================================")
    print("SUCCESS: REAL AUTHENTICATED PAID AI VTO JOURNEY FULLY VALIDATED!")
    print(f"Total Journey Time: {time.time() - t0:.2f}s")
    print("=================================================================")

if __name__ == "__main__":
    run_paid_vto_e2e_journey()
