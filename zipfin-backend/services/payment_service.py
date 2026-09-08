"""Authoritative server-side pricing and cryptographic payment webhook verification.

Guarantees prices cannot be tampered with on client devices, and webhook events
are validated using HMAC SHA256 signatures before provisioning credits.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any
from fastapi import HTTPException, status

from core.config import settings
from core.security_logger import log_security_event

logger = logging.getLogger(__name__)

# Authoritative server-side pricing: clients select a package_id, never pass an arbitrary price
SERVER_PRICING_CATALOG: dict[str, dict[str, Any]] = {
    "wallet_pack_starter": {
        "id": "wallet_pack_starter",
        "title": "Starter Atelier Top-Up",
        "amount_rupees": 299,
        "credits": 300,
        "currency": "INR",
    },
    "wallet_pack_standard": {
        "id": "wallet_pack_standard",
        "title": "Signature Wardrobe Top-Up",
        "amount_rupees": 499,
        "credits": 550,
        "currency": "INR",
    },
    "wallet_pack_couture": {
        "id": "wallet_pack_couture",
        "title": "Couture Atelier Top-Up",
        "amount_rupees": 999,
        "credits": 1200,
        "currency": "INR",
    },
    "sub_vip_monthly": {
        "id": "sub_vip_monthly",
        "title": "VIP Atelier Monthly Membership",
        "amount_rupees": 799,
        "credits": 1000,
        "currency": "INR",
    },
}


def get_server_price(package_id: str) -> dict[str, Any]:
    """Retrieve package price strictly from the authoritative server catalog."""
    if package_id not in SERVER_PRICING_CATALOG:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": f"Invalid package '{package_id}'. Price must be selected from authorized catalog.",
                "details": {"code": "invalid_pricing_package"},
            },
        )
    return SERVER_PRICING_CATALOG[package_id]


def verify_razorpay_webhook_signature(
    raw_body: bytes,
    signature: str,
    secret: str,
    ip_address: str = "unknown",
) -> bool:
    """Cryptographically verify Razorpay HMAC SHA256 webhook signature."""
    if not signature or not secret:
        log_security_event(
            event_type="SECURITY_WEBHOOK_MISSING_SECRET_OR_SIG",
            severity="CRITICAL",
            ip_address=ip_address,
        )
        return False

    expected_signature = hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()

    is_valid = hmac.compare_digest(expected_signature, signature.strip())
    if not is_valid:
        log_security_event(
            event_type="SECURITY_WEBHOOK_SIGNATURE_MISMATCH",
            severity="CRITICAL",
            ip_address=ip_address,
            details={"reason": "HMAC SHA256 signature mismatch on payment webhook"},
        )
    return is_valid
