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
from services.order_service import OrderService, get_order_service
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


class CreateOrderResponse(BaseModel):
    order_id: str
    amount: int
    currency: str
    key_id: str


@router.get("/packages", response_model=ApiResponse[list[dict[str, Any]]])
async def list_packages() -> ApiResponse[list[dict[str, Any]]]:
    """Return authoritative server pricing catalog."""
    packages = list(SERVER_PRICING_CATALOG.values())
    return success_response(message="Available pricing packages.", data=packages)


@router.post("/create-order", response_model=ApiResponse[CreateOrderResponse])
async def create_payment_order(
    payload: CreateOrderRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[CreateOrderResponse]:
    """Create a server-authoritative Razorpay payment order for subscription credits."""
    package = get_server_price(payload.package_id)
    amount_paise = package["amount_paise"]

    order_id = f"order_srv_{os.urandom(8).hex()}"
    key_id = (settings.RAZORPAY_KEY_ID or os.getenv("RAZORPAY_KEY_ID", "rzp_test_mock")).strip()

    logger.info("Created server-authoritative order %s for user %s", order_id, current_user.uid)
    return success_response(
        message="Order created successfully.",
        data=CreateOrderResponse(
            order_id=order_id,
            amount=amount_paise,
            currency=package.get("currency", "INR"),
            key_id=key_id,
        ),
    )


@router.post("/orders", response_model=ApiResponse[dict[str, Any]], status_code=status.HTTP_201_CREATED)
async def create_payment_order_legacy(
    payload: CreateOrderRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[dict[str, Any]]:
    """Create a payment order for subscription credits.

    Guarantees the price is resolved strictly server-side, blocking client tampering.
    """
    package = get_server_price(payload.package_id)

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
async def razorpay_webhook(
    request: Request,
    order_service: OrderService = Depends(get_order_service),
):
    """Cryptographically verified Razorpay payment webhook endpoint."""
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
    event_id = request.headers.get("X-Razorpay-Event-Id") or event.get("id") or event.get("event_id")
    if event_id:
        event["id"] = event_id

    logger.info("Verified payment webhook received: %s (event_id: %s)", event_type, event_id)

    log_security_event(
        event_type="SECURITY_PAYMENT_WEBHOOK_VERIFIED",
        severity="INFO",
        ip_address=ip_address,
        details={"event": event_type, "event_id": event_id},
    )

    result = order_service.process_payment_webhook(event, ip_address=ip_address)

    return {"status": "ok", "result": result.get("status", "processed")}
