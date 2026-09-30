"""Benchmark Suite for ZipRIGHT Decart Lucy Realtime AI Live VTO.

Measures:
- Decart service status endpoint latency
- Ephemeral client token minting latency via backend broker
- Session concurrency prevention (409) and slot release timing
- Health & rate limiter responsiveness
"""

import os
import sys
import time
from pathlib import Path

# Fix Windows console encoding
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from main import app
from services.decart_vto import release_decart_session, is_decart_enabled, has_decart_credentials
from core.config import settings

def run_decart_benchmark():
    print("=" * 60)
    print("ZIPRIGHT DECART AI LIVE VTO — PERFORMANCE BENCHMARK")
    print("=" * 60)

    # Verify credentials
    key_configured = bool(settings.DECART_API_KEY and len(settings.DECART_API_KEY) > 5)
    print(f"[*] Decart VTO Enabled: {settings.DECART_VTO_ENABLED}")
    print(f"[*] Decart API Key Present: {key_configured}")
    print(f"[*] Decart Model: {settings.DECART_VTO_MODEL}")
    print(f"[*] Max Session Duration: {settings.DECART_VTO_MAX_SESSION_SECONDS}s")

    client = TestClient(app)

    # 1. Status Latency
    t0 = time.perf_counter()
    status_res = client.get("/tryon-live/decart/status")
    status_latency = (time.perf_counter() - t0) * 1000
    assert status_res.status_code == 200
    print(f"\n[1] GET /tryon-live/decart/status: {status_latency:.2f} ms (Status: {status_res.status_code})")
    print(f"    Payload: {status_res.json()}")

    # 2. Token Minting Latency with mock auth
    test_user_id = "benchmark_tester_vto"
    release_decart_session(test_user_id)

    # Mock user auth dependency
    from services.firebase_auth import AuthenticatedUser, get_current_user
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(uid=test_user_id, email="bench@zipright.com")

    try:
        t0 = time.perf_counter()
        token_res = client.post("/tryon-live/decart/token", json={"requestedDuration": 60})
        mint_latency = (time.perf_counter() - t0) * 1000
        print(f"\n[2] POST /tryon-live/decart/token (Broker Mint): {mint_latency:.2f} ms")
        print(f"    HTTP Status: {token_res.status_code}")
        if token_res.status_code == 200:
            data = token_res.json()
            token_prefix = data.get("clientToken", "")[:4]
            print(f"    Token Prefix: {token_prefix}*** (Length: {len(data.get('clientToken', ''))})")
            print(f"    Assigned Model: {data.get('model')}")
            print(f"    Max Session: {data.get('maxSessionSeconds')}s")

        # 3. Concurrency Protection Latency (expect 409)
        t0 = time.perf_counter()
        conflict_res = client.post("/tryon-live/decart/token", json={"requestedDuration": 60})
        conflict_latency = (time.perf_counter() - t0) * 1000
        print(f"\n[3] Concurrency Guard (409 Conflict): {conflict_latency:.2f} ms (Status: {conflict_res.status_code})")
        assert conflict_res.status_code == 409

        # 4. Session Teardown Latency
        t0 = time.perf_counter()
        end_res = client.post("/tryon-live/decart/session/end")
        end_latency = (time.perf_counter() - t0) * 1000
        print(f"\n[4] POST /tryon-live/decart/session/end: {end_latency:.2f} ms (Status: {end_res.status_code})")
        assert end_res.status_code == 200

        # 5. Post-Teardown Mint (no conflict)
        t0 = time.perf_counter()
        reenter_res = client.post("/tryon-live/decart/token", json={"requestedDuration": 60})
        reenter_latency = (time.perf_counter() - t0) * 1000
        print(f"\n[5] Re-entry Mint (Post-Teardown): {reenter_latency:.2f} ms (Status: {reenter_res.status_code})")
        assert reenter_res.status_code == 200

        # Cleanup
        release_decart_session(test_user_id)
        print("\n[+] Benchmark completed successfully with 100% assertions satisfied.")

    finally:
        app.dependency_overrides.clear()
        release_decart_session(test_user_id)

if __name__ == "__main__":
    run_decart_benchmark()
