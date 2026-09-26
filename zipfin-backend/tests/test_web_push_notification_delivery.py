"""
Production Web Push and In-App Notification Delivery Test Suite.

Tests:
1. VAPID key pair validity (RFC 8292 NIST P-256 standard).
2. ES256 Authorization token generation and signature verification.
3. User-scoped notification creation in Appwrite database.
4. User isolation: User A cannot access User B's notifications.
5. In-app notification read receipt update.
"""
from __future__ import annotations

import base64
import json
import os
import time
import uuid
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from dotenv import load_dotenv

load_dotenv()

from appwrite_config import appwrite_settings, get_appwrite_databases
from services.database_adapter import AppwriteDatabaseAdapter


def test_vapid_key_pair_structure():
    """Verify VAPID public and private keys exist and follow NIST P-256 standard."""
    pub_b64 = os.getenv("VAPID_PUBLIC_KEY", "").strip()
    priv_b64 = os.getenv("VAPID_PRIVATE_KEY", "").strip()
    subject = os.getenv("VAPID_SUBJECT", "").strip()

    assert bool(pub_b64), "VAPID_PUBLIC_KEY is missing"
    assert bool(priv_b64), "VAPID_PRIVATE_KEY is missing"
    assert subject.startswith("mailto:"), "VAPID_SUBJECT must be a mailto: URI"

    # Decode and verify lengths
    # URL-safe base64 unpadded
    pad = lambda s: s + "=" * ((4 - len(s) % 4) % 4)
    pub_bytes = base64.urlsafe_b64decode(pad(pub_b64))
    priv_bytes = base64.urlsafe_b64decode(pad(priv_b64))

    assert len(pub_bytes) == 65, f"Public key must be 65 uncompressed bytes, got {len(pub_bytes)}"
    assert pub_bytes[0] == 0x04, "Public key must start with 0x04 uncompressed prefix"
    assert len(priv_bytes) == 32, f"Private key must be 32 bytes, got {len(priv_bytes)}"


def test_vapid_jwt_signing():
    """Verify that backend can sign a valid ES256 VAPID JWT header for Web Push services."""
    priv_b64 = os.getenv("VAPID_PRIVATE_KEY", "").strip()
    pad = lambda s: s + "=" * ((4 - len(s) % 4) % 4)
    priv_bytes = base64.urlsafe_b64decode(pad(priv_b64))

    priv_int = int.from_bytes(priv_bytes, byteorder="big")
    private_key = ec.derive_private_key(priv_int, ec.SECP256R1())

    # Build standard Web Push JWT
    header = {"typ": "JWT", "alg": "ES256"}
    payload = {
        "aud": "https://fcm.googleapis.com",
        "exp": int(time.time()) + 12 * 3600,
        "sub": os.getenv("VAPID_SUBJECT", "mailto:security@zipright.in"),
    }

    encode = lambda obj: base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")
    signing_input = f"{encode(header)}.{encode(payload)}"

    signature = private_key.sign(signing_input.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    assert len(signature) > 0, "Failed to generate ECDSA signature"

    # Verify signature with public key
    public_key = private_key.public_key()
    public_key.verify(signature, signing_input.encode("utf-8"), ec.ECDSA(hashes.SHA256()))


def test_user_scoped_notification_delivery_and_isolation():
    """Verify backend creates user-scoped notifications in Appwrite and enforces isolation."""
    adapter = AppwriteDatabaseAdapter()
    user_a = f"push_user_a_{uuid.uuid4().hex[:6]}"
    user_b = f"push_user_b_{uuid.uuid4().hex[:6]}"
    notif_id = f"notif_{uuid.uuid4().hex[:8]}"

    # Create notification for User A
    notif_data = {
        "user_id": user_a,
        "type": "ORDER_SHIPPED",
        "title": "Your Order has Shipped!",
        "body": "Tracking code #ZR-998811",
        "read": False,
        "created_at": "2026-09-23T20:00:00Z",
    }
    adapter.set_document("notifications", notif_id, notif_data)

    try:
        # User A query: must find notification
        notifs_a = adapter.query_collection("notifications", filters=[("user_id", "==", user_a)])
        assert any(n.get("id") == notif_id for n in notifs_a)

        # User B query: must NOT find User A's notification
        notifs_b = adapter.query_collection("notifications", filters=[("user_id", "==", user_b)])
        assert not any(n.get("id") == notif_id for n in notifs_b), "Cross-tenant notification leak!"

        # Test marking as read
        adapter.update_document("notifications", notif_id, {"read": True})
        updated = adapter.get_document("notifications", notif_id)
        assert updated.get("read") is True
    finally:
        adapter.delete_document("notifications", notif_id)
