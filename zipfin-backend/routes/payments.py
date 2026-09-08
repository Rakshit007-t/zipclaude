"""Payment intent and cryptographically verified webhook routes."""

from __future__ import annotations

import json
import logging
import os
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from core.api import success_response
from core.config import settings
from core.security_logger import log_security_event
from models.schema import ApiResponse
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.payment_service import (
    SERVER_PRICING_CATALOG,
    get_server_price,
    verify_razorpay_webhook_signature,
)
from services.tryon_access import credit_wallet

router = APIRouter(prefix="/payments", tags=["payments"])
logger = logging.getLogger(__name__)


class CreateOrderRequest(BaseModel):
    package_id: str = Field(..., description="ID of package in authoritative server pricing catalog")


@router.get("/packages", response_model=ApiResponse[list[dict[str, Any]]])
async def list_packages() -> ApiResponse[list[dict[str, Any]]]:
    """Return authoritative server pricing catalog."""
    packages = list(SERVER_PRICING_CATALOG.values())
    return success_response(message="Available pricing packages.", data=packages)


@router.post("/orders", response_model=ApiResponse[dict[str, Any]], status_code=status.HTTP_201_CREATED)
async def create_payment_order(
    payload: CreateOrderRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[dict[str, Any]]:
    """Create a payment order.

    Guarantees the price is resolved strictly server-side, blocking client tampering.
    """
    package = get_server_price(payload.package_id)

    # In production, initiate Razorpay order with server-determined amount
    order_data = {
        "order_id": f"order_{package['id']}_{current_user.uid[:8]}",
        "package_id": package["id"],
        "amount_rupees": package["amount_rupees"],
        "currency": package["currency"],
        "user_id": current_user.uid,
    }

    return success_response(
        message="Payment order initiated with authoritative server-side price.",
        data=order_data,
    )


@router.post("/webhook")
async def razorpay_webhook(request: Request) -> dict[str, str]:
    """Cryptographically verified Razorpay payment webhook endpoint.

    Validates HMAC SHA256 signature in X-Razorpay-Signature header before fulfillment.
    """
    ip_address = request.client.host if request.client else "unknown"
    signature = request.headers.get("X-Razorpay-Signature", "").strip()

    webhook_secret = (
        os.getenv("RAZORPAY_WEBHOOK_SECRET", "").strip()
        or settings.RAZORPAY_KEY_SECRET
    )

    raw_body = await request.body()

    is_valid = verify_razorpay_webhook_signature(
        raw_body=raw_body,
        signature=signature,
        secret=webhook_secret,
        ip_address=ip_address,
    )

    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid payment webhook signature.",
        )

    try:
        event = json.loads(raw_body.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid webhook JSON payload.",
        ) from exc

    event_type = event.get("event")
    logger.info("Verified payment webhook received: %s", event_type)

    log_security_event(
        event_type="SECURITY_PAYMENT_WEBHOOK_VERIFIED",
        severity="INFO",
        ip_address=ip_address,
        details={"event": event_type},
    )

    return {"status": "ok"}
