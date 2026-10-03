"""Razorpay Standard Web Checkout API endpoints.

Provides:
- POST /api/create-order: Creates a Razorpay order via Razorpay API (minimum 100 paise)
- POST /api/verify-payment: Cryptographically verifies Razorpay payment HMAC-SHA256 signature
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
from typing import Any
from uuid import uuid4
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
import razorpay

from core.config import settings
from core.security_logger import log_security_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["razorpay"])


class CreateStandardOrderRequest(BaseModel):
    amount: int = Field(..., description="Amount in paise (minimum 100 paise = 1 INR)")
    currency: str = Field(default="INR", description="Currency code (e.g. INR)")
    receipt: str | None = Field(default=None, description="Optional receipt identifier")


class CreateStandardOrderResponse(BaseModel):
    order_id: str = Field(..., description="Razorpay order ID")
    amount: int = Field(..., description="Order amount in paise")
    currency: str = Field(..., description="Order currency")
    key_id: str | None = Field(default=None, description="Razorpay Key ID for client checkout modal")


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str = Field(..., description="Razorpay Order ID")
    razorpay_payment_id: str = Field(..., description="Razorpay Payment ID")
    razorpay_signature: str = Field(..., description="Razorpay HMAC SHA256 Signature")


class VerifyPaymentResponse(BaseModel):
    status: str = Field(..., description="Verification status ('success' or 'failure')")
    message: str = Field(..., description="Human-readable message")
    order_id: str = Field(..., description="Verified Order ID")
    payment_id: str = Field(..., description="Verified Payment ID")


def _get_razorpay_credentials() -> tuple[str, str]:
    """Retrieve Razorpay Key ID and Secret securely from environment."""
    key_id = (settings.RAZORPAY_KEY_ID if getattr(settings, "RAZORPAY_KEY_ID", None) is not None else os.getenv("RAZORPAY_KEY_ID", "")).strip()
    key_secret = (settings.RAZORPAY_KEY_SECRET if getattr(settings, "RAZORPAY_KEY_SECRET", None) is not None else os.getenv("RAZORPAY_KEY_SECRET", "")).strip()
    return key_id, key_secret


@router.post("/create-order", response_model=CreateStandardOrderResponse)
async def create_standard_order(payload: CreateStandardOrderRequest) -> dict[str, Any]:
    """Create a standard Razorpay checkout order.
    
    Validates amount >= 100 paise, calls Razorpay Orders API,
    and returns { order_id, amount, currency, key_id }.
    """
    # 1. Validate minimum amount (100 paise = 1 INR)
    if payload.amount is None or payload.amount < 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid amount. Minimum amount is 100 paise (₹1.00).",
        )

    # 2. Get and validate credentials
    key_id, key_secret = _get_razorpay_credentials()
    if not key_id or not key_secret:
        log_security_event(
            event_type="RAZORPAY_CREDENTIALS_MISSING",
            severity="ERROR",
            details={"key_id_present": bool(key_id), "key_secret_present": bool(key_secret)},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Razorpay API credentials are not configured or invalid.",
        )

    # 3. Call Razorpay API: POST https://api.razorpay.com/v1/orders
    receipt = payload.receipt.strip() if payload.receipt and payload.receipt.strip() else f"rcpt_{uuid4().hex[:12]}"
    currency = (payload.currency or "INR").strip().upper()

    try:
        client = razorpay.Client(auth=(key_id, key_secret))
        order_params = {
            "amount": int(payload.amount),
            "currency": currency,
            "receipt": receipt,
        }
        order_data = client.order.create(data=order_params)
        logger.info("Created Razorpay order %s for %d paise", order_data.get("id"), payload.amount)

        return {
            "order_id": order_data["id"],
            "amount": int(order_data["amount"]),
            "currency": order_data["currency"],
            "key_id": key_id,
        }

    except razorpay.errors.BadRequestError as exc:
        err_msg = str(exc)
        logger.error("Razorpay BadRequestError: %s", err_msg)
        if "auth" in err_msg.lower():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Razorpay authentication failed. Invalid API credentials.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Razorpay API error: {err_msg}",
        ) from exc

    except Exception as exc:
        logger.exception("Unexpected error while creating Razorpay order: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create payment order with payment gateway.",
        ) from exc


@router.post("/verify-payment", response_model=VerifyPaymentResponse)
async def verify_standard_payment(payload: VerifyPaymentRequest) -> dict[str, Any]:
    """Verify Razorpay payment signature cryptographically using HMAC-SHA256.
    
    Algorithm: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
    """
    order_id = (payload.razorpay_order_id or "").strip()
    payment_id = (payload.razorpay_payment_id or "").strip()
    signature = (payload.razorpay_signature or "").strip()

    # 1. Validate required fields
    if not order_id or not payment_id or not signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing required fields: razorpay_order_id, razorpay_payment_id, and razorpay_signature are required.",
        )

    # 2. Get secret key
    _, key_secret = _get_razorpay_credentials()
    if not key_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Razorpay key secret is not configured on server.",
        )

    # 3. Compute HMAC-SHA256 signature
    msg = f"{order_id}|{payment_id}".encode("utf-8")
    expected_signature = hmac.new(
        key_secret.encode("utf-8"),
        msg,
        hashlib.sha256,
    ).hexdigest()

    # 4. Constant-time comparison
    if not hmac.compare_digest(expected_signature, signature):
        log_security_event(
            event_type="PAYMENT_SIGNATURE_VERIFICATION_FAILED",
            severity="WARNING",
            details={"order_id": order_id, "payment_id": payment_id},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payment signature verification failed. Signature mismatch.",
        )

    log_security_event(
        event_type="PAYMENT_SIGNATURE_VERIFIED",
        severity="INFO",
        details={"order_id": order_id, "payment_id": payment_id},
    )

    return {
        "status": "success",
        "message": "Payment verified successfully",
        "order_id": order_id,
        "payment_id": payment_id,
    }
