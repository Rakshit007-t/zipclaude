"""Server-authoritative Order and Checkout endpoints."""

from __future__ import annotations

import logging
import os
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from pydantic import BaseModel, Field

from core.api import success_response
from core.config import settings
from models.schema import ApiResponse
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.order_service import Order, OrderService, get_order_service

router = APIRouter(prefix="/orders", tags=["orders"])
logger = logging.getLogger(__name__)


class CheckoutItemRequest(BaseModel):
    product_id: str = Field(..., min_length=1, max_length=128, description="Catalog product ID")
    quantity: int = Field(default=1, ge=1, le=50, description="Quantity to purchase")


class CheckoutRequest(BaseModel):
    items: list[CheckoutItemRequest] = Field(..., min_length=1, max_length=50)


class CheckoutResponse(BaseModel):
    order_id: str
    status: str
    currency: str
    amount_paise: int
    amount_rupees: float
    razorpay_order_id: str | None
    razorpay_key_id: str
    item_count: int


class OrderItemDetail(BaseModel):
    product_id: str
    seller_uid: str
    title: str
    quantity: int
    unit_price_paise: int
    line_total_paise: int


class OrderResponse(BaseModel):
    order_id: str
    customer_uid: str
    status: str
    currency: str
    items: list[dict[str, Any]]
    subtotal_paise: int
    shipping_paise: int
    tax_paise: int
    total_paise: int
    total_rupees: float
    payment_provider: str
    payment_order_id: str | None
    payment_id: str | None
    created_at: float
    paid_at: float | None


def _to_order_response(order: Order, filter_seller_uid: str | None = None) -> OrderResponse:
    items = order.items
    if filter_seller_uid:
        # Tenant isolation: sellers only see their own line items
        items = [i for i in items if i.get("seller_uid") == filter_seller_uid]

    return OrderResponse(
        order_id=order.order_id,
        customer_uid=order.customer_uid,
        status=order.status,
        currency=order.currency,
        items=items,
        subtotal_paise=order.subtotal_paise,
        shipping_paise=order.shipping_paise,
        tax_paise=order.tax_paise,
        total_paise=order.total_paise,
        total_rupees=round(order.total_paise / 100.0, 2),
        payment_provider=order.payment_provider,
        payment_order_id=order.payment_order_id,
        payment_id=order.payment_id,
        created_at=order.created_at,
        paid_at=order.paid_at,
    )


@router.post("/checkout", response_model=ApiResponse[CheckoutResponse], status_code=status.HTTP_201_CREATED)
async def checkout(
    request: Request,
    payload: CheckoutRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    order_service: OrderService = Depends(get_order_service),
    x_idempotency_key: str | None = Header(None, alias="X-Idempotency-Key"),
) -> ApiResponse[CheckoutResponse]:
    """Create a server-authoritative checkout order.

    Prices, totals, and seller associations are determined strictly server-side
    by resolving catalog items from the database.
    """
    idempotency_key = x_idempotency_key.strip() if x_idempotency_key else None
    items_payload = [item.model_dump() for item in payload.items]

    order = order_service.create_checkout_order(
        customer_uid=current_user.uid,
        items_payload=items_payload,
        idempotency_key=idempotency_key,
    )

    public_key_id = (settings.RAZORPAY_KEY_ID or os.getenv("RAZORPAY_KEY_ID", "rzp_test_placeholder")).strip()

    response_data = CheckoutResponse(
        order_id=order.order_id,
        status=order.status,
        currency=order.currency,
        amount_paise=order.total_paise,
        amount_rupees=round(order.total_paise / 100.0, 2),
        razorpay_order_id=order.payment_order_id,
        razorpay_key_id=public_key_id,
        item_count=len(order.items),
    )

    return success_response(
        message="Checkout order created with server-authoritative price.",
        data=response_data,
    )


@router.get("", response_model=ApiResponse[list[OrderResponse]], status_code=status.HTTP_200_OK)
async def list_my_orders(
    current_user: AuthenticatedUser = Depends(get_current_user),
    order_service: OrderService = Depends(get_order_service),
) -> ApiResponse[list[OrderResponse]]:
    """List orders belonging to the authenticated customer."""
    orders = order_service.list_customer_orders(current_user.uid)
    data = [_to_order_response(o) for o in orders]
    return success_response(message="Customer orders retrieved.", data=data)


@router.get("/{order_id}", response_model=ApiResponse[OrderResponse], status_code=status.HTTP_200_OK)
async def get_order_by_id(
    order_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
    order_service: OrderService = Depends(get_order_service),
) -> ApiResponse[OrderResponse]:
    """Retrieve an order by ID. Enforces customer ownership and seller tenant isolation."""
    order = order_service.get_order(order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order '{order_id}' was not found.",
        )

    # 1. Customer owner access
    if order.customer_uid == current_user.uid:
        return success_response(message="Order retrieved.", data=_to_order_response(order))

    # 2. Seller tenant access (sellers can only see their own order items)
    if current_user.uid in order.seller_uids:
        return success_response(
            message="Seller order items retrieved.",
            data=_to_order_response(order, filter_seller_uid=current_user.uid),
        )

    # 3. Unauthorized access denied
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to access this order.",
    )
