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


def create_razorpay_order(
    amount_paise: int,
    currency: str = "INR",
    receipt: str | None = None,
    notes: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a real payment provider order using server-determined amount in paise.

    If RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are configured, initiates real
    HTTPS call to Razorpay Orders API.
    If unconfigured (development/test mode), creates a deterministic provider order.
    """
    import os
    from uuid import uuid4

    if amount_paise <= 0:
        raise ValueError("Order amount must be a positive integer in paise.")

    key_id = (settings.RAZORPAY_KEY_ID or os.getenv("RAZORPAY_KEY_ID", "")).strip()
    key_secret = (settings.RAZORPAY_KEY_SECRET or os.getenv("RAZORPAY_KEY_SECRET", "")).strip()

    # Real Razorpay API call when valid production/staging keys are provided
    if key_id and key_secret and not key_id.startswith("your_") and not key_id.startswith("mock_"):
        try:
            import httpx
            auth = (key_id, key_secret)
            payload = {
                "amount": amount_paise,
                "currency": currency,
                "receipt": receipt or f"rcpt_{uuid4().hex[:12]}",
                "notes": notes or {},
            }
            resp = httpx.post("https://api.razorpay.com/v1/orders", json=payload, auth=auth, timeout=10.0)
            if resp.status_code in {200, 201}:
                data = resp.json()
                logger.info("Created real Razorpay order %s for amount %d paise", data.get("id"), amount_paise)
                return {
                    "id": data["id"],
                    "amount": data["amount"],
                    "currency": data["currency"],
                    "receipt": data.get("receipt", receipt),
                    "status": data.get("status", "created"),
                }
            else:
                logger.error("Razorpay order creation failed: %d %s", resp.status_code, resp.text)
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Failed to initiate payment with payment provider.",
                )
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Unexpected error connecting to Razorpay: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Payment gateway is currently unreachable.",
            ) from exc

    # Deterministic test/development provider order
    suffix = receipt.replace("ord_", "") if receipt else uuid4().hex[:14]
    mock_order_id = f"order_rzp_{suffix}"
    logger.info("Generated development payment provider order %s for %d paise", mock_order_id, amount_paise)
    return {
        "id": mock_order_id,
        "amount": amount_paise,
        "currency": currency,
        "receipt": receipt,
        "status": "created",
    }
