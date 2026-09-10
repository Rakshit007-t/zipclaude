"""Server-authoritative Order Service and Payment Lifecycle Manager.

Enforces:
- Zero trust in client-supplied prices, totals, or seller IDs.
- Integer minor unit (paise) money representation.
- Strict order state transitions (PENDING_PAYMENT, PAID, PAYMENT_FAILED, CANCELLED).
- Checkout and Webhook idempotency.
- Customer ownership and seller tenant isolation.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status
from firebase_admin import firestore

from core.redis_client import get_redis_client
from core.security_logger import log_security_event
from firebase_config import get_firestore_client
from services.payment_service import create_razorpay_order
from services.product_repository import get_product_repository

logger = logging.getLogger(__name__)

ORDERS_COLLECTION = "orders"
CHECKOUT_IDEMPOTENCY_TTL_SECONDS = 3600  # 1 hour
WEBHOOK_IDEMPOTENCY_TTL_SECONDS = 86400  # 24 hours
MAX_ORDER_AMOUNT_PAISE = 10_000_000      # ₹100,000 fraud cap


class OrderStatus(str, Enum):
    PENDING_PAYMENT = "PENDING_PAYMENT"
    PAID = "PAID"
    PAYMENT_FAILED = "PAYMENT_FAILED"
    CANCELLED = "CANCELLED"


@dataclass
class OrderLineItem:
    product_id: str
    seller_uid: str
    title: str
    quantity: int
    unit_price_paise: int
    line_total_paise: int


@dataclass
class Order:
    order_id: str
    customer_uid: str
    status: str
    currency: str
    items: list[dict[str, Any]]
    subtotal_paise: int
    shipping_paise: int
    tax_paise: int
    total_paise: int
    seller_uids: list[str]
    payment_provider: str
    payment_order_id: str | None = None
    payment_id: str | None = None
    idempotency_key: str | None = None
    created_at: float = 0.0
    updated_at: float = 0.0
    paid_at: float | None = None
    failed_at: float | None = None


def parse_price_to_paise(raw_price: Any) -> int:
    """Convert raw catalog price (e.g. '49.99', 49.99, '₹1,499') into integer paise."""
    if raw_price is None:
        return 0
    if isinstance(raw_price, (int, float)):
        return int(round(float(raw_price) * 100))
    if isinstance(raw_price, str):
        # Remove currency symbols, commas, and whitespace
        clean = re.sub(r"[^\d.]", "", raw_price.strip())
        if not clean:
            return 0
        try:
            return int(round(float(clean) * 100))
        except ValueError:
            return 0
    return 0


def _order_to_dict(order: Order) -> dict[str, Any]:
    return asdict(order)


def _doc_to_order(doc_id: str, data: dict[str, Any]) -> Order:
    return Order(
        order_id=doc_id,
        customer_uid=data.get("customer_uid", ""),
        status=data.get("status", OrderStatus.PENDING_PAYMENT.value),
        currency=data.get("currency", "INR"),
        items=data.get("items", []),
        subtotal_paise=int(data.get("subtotal_paise", 0)),
        shipping_paise=int(data.get("shipping_paise", 0)),
        tax_paise=int(data.get("tax_paise", 0)),
        total_paise=int(data.get("total_paise", 0)),
        seller_uids=data.get("seller_uids", []),
        payment_provider=data.get("payment_provider", "razorpay"),
        payment_order_id=data.get("payment_order_id"),
        payment_id=data.get("payment_id"),
        idempotency_key=data.get("idempotency_key"),
        created_at=float(data.get("created_at", 0.0)),
        updated_at=float(data.get("updated_at", 0.0)),
        paid_at=float(data["paid_at"]) if data.get("paid_at") else None,
        failed_at=float(data["failed_at"]) if data.get("failed_at") else None,
    )


class OrderService:
    """Server-authoritative order management and payment orchestration."""

    def __init__(self, db: Any = None, product_repo: Any = None) -> None:
        self._custom_db = db
        self._custom_product_repo = product_repo

    @property
    def product_repo(self) -> Any:
        if self._custom_product_repo is not None:
            return self._custom_product_repo
        return get_product_repository()

    def _db(self) -> Any:
        if self._custom_db is not None:
            return self._custom_db
        return get_firestore_client()

    def get_order(self, order_id: str) -> Order | None:
        """Fetch an order by ID from Redis or Firestore."""
        order_id = order_id.strip()
        if not order_id:
            return None

        # 1. Check Redis cache
        try:
            r = get_redis_client()
            cached = r.get(f"zipright:order:{order_id}")
            if cached:
                if isinstance(cached, bytes):
                    cached = cached.decode("utf-8")
                return Order(**json.loads(cached))
        except Exception:
            pass

        # 2. Check Firestore
        snap = self._db().collection(ORDERS_COLLECTION).document(order_id).get()
        if not snap.exists:
            return None
        return _doc_to_order(order_id, snap.to_dict() or {})

    def list_customer_orders(self, customer_uid: str) -> list[Order]:
        """Fetch all orders placed by the customer."""
        customer_uid = customer_uid.strip()
        if not customer_uid:
            return []

        snaps = (
            self._db()
            .collection(ORDERS_COLLECTION)
            .where("customer_uid", "==", customer_uid)
            .get()
        )
        orders = []
        for snap in snaps:
            orders.append(_doc_to_order(snap.id, snap.to_dict() or {}))

        # Sort newest first
        orders.sort(key=lambda x: x.created_at, reverse=True)
        return orders

    def create_checkout_order(
        self,
        *,
        customer_uid: str,
        items_payload: list[dict[str, Any]],
        idempotency_key: str | None = None,
    ) -> Order:
        """Create a server-authoritative checkout order with strict price integrity.

        1. Revalidates every product against seller_products.
        2. Rejects client-supplied prices, totals, or seller assignments.
        3. Computes exact integer paise totals on the server.
        4. Creates a Razorpay order matching the server-determined amount.
        """
        customer_uid = customer_uid.strip()
        if not customer_uid:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")

        if not items_payload:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Cart items cannot be empty.")
        if len(items_payload) > 50:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Cannot checkout more than 50 items at once.")

        now = time.time()
        r = get_redis_client()

        # ── 1. Check Checkout Idempotency ──────────────────────────────────────
        if idempotency_key:
            idem_key = f"zipright:checkout:idempotency:{customer_uid}:{idempotency_key}"
            try:
                cached_order_id = r.get(idem_key)
                if cached_order_id:
                    if isinstance(cached_order_id, bytes):
                        cached_order_id = cached_order_id.decode("utf-8")
                    existing = self.get_order(str(cached_order_id))
                    if existing:
                        logger.info("Checkout idempotency hit for user %s: order %s", customer_uid, existing.order_id)
                        return existing
            except Exception as exc:
                logger.warning("Idempotency check error: %s", exc)

        # ── 2. Authoritative Price & Seller Validation ─────────────────────────
        line_items: list[dict[str, Any]] = []
        seller_uids_set: set[str] = set()
        subtotal_paise = 0

        for item in items_payload:
            product_id = str(item.get("product_id") or "").strip()
            if not product_id:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="product_id is required.")

            try:
                quantity = int(item.get("quantity", 1))
            except (ValueError, TypeError):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid quantity for {product_id}.")

            if quantity < 1 or quantity > 50:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Quantity for product '{product_id}' must be between 1 and 50.",
                )

            # Load strictly from server-authoritative product repository
            product = self.product_repo.get_product(product_id)
            if not product:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Product '{product_id}' was not found in catalog.",
                )

            product_status = str(product.get("status") or "active").lower()
            if product_status not in {"active", "published"}:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Product '{product.get('title', product_id)}' is currently inactive or unavailable.",
                )

            # Resolve server-authoritative fields (NEVER trust client values)
            authoritative_seller = str(product.get("seller_uid") or "").strip()
            authoritative_title = str(product.get("title") or f"Product {product_id}").strip()
            unit_price_paise = parse_price_to_paise(product.get("price"))

            if unit_price_paise <= 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Product '{authoritative_title}' has an invalid price configuration.",
                )

            line_total_paise = unit_price_paise * quantity
            subtotal_paise += line_total_paise
            seller_uids_set.add(authoritative_seller)

            line_items.append({
                "product_id": product_id,
                "seller_uid": authoritative_seller,
                "title": authoritative_title,
                "quantity": quantity,
                "unit_price_paise": unit_price_paise,
                "line_total_paise": line_total_paise,
            })

        # Platform fee / Shipping rules (server-controlled)
        shipping_paise = 0
        tax_paise = 0
        total_paise = subtotal_paise + shipping_paise + tax_paise

        if total_paise <= 0 or total_paise > MAX_ORDER_AMOUNT_PAISE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Total order amount is invalid or exceeds maximum single-order limit.",
            )

        order_id = f"ord_{uuid4().hex}"

        # ── 3. Initiate Real Payment Provider Order ───────────────────────────
        notes = {
            "zipright_order_id": order_id,
            "customer_uid": customer_uid,
            "item_count": str(len(line_items)),
        }
        provider_order = create_razorpay_order(
            amount_paise=total_paise,
            currency="INR",
            receipt=order_id,
            notes=notes,
        )
        payment_order_id = provider_order.get("id")

        order = Order(
            order_id=order_id,
            customer_uid=customer_uid,
            status=OrderStatus.PENDING_PAYMENT.value,
            currency="INR",
            items=line_items,
            subtotal_paise=subtotal_paise,
            shipping_paise=shipping_paise,
            tax_paise=tax_paise,
            total_paise=total_paise,
            seller_uids=sorted(list(seller_uids_set)),
            payment_provider="razorpay",
            payment_order_id=payment_order_id,
            payment_id=None,
            idempotency_key=idempotency_key,
            created_at=now,
            updated_at=now,
        )

        # ── 4. Persist Order to Firestore and Cache in Redis ──────────────────
        order_dict = _order_to_dict(order)
        self._db().collection(ORDERS_COLLECTION).document(order_id).set(order_dict)

        try:
            r.set(f"zipright:order:{order_id}", json.dumps(order_dict), ex=CHECKOUT_IDEMPOTENCY_TTL_SECONDS)
            if idempotency_key:
                r.set(
                    f"zipright:checkout:idempotency:{customer_uid}:{idempotency_key}",
                    order_id,
                    ex=CHECKOUT_IDEMPOTENCY_TTL_SECONDS,
                )
        except Exception as exc:
            logger.warning("Failed to cache order %s in Redis: %s", order_id, exc)

        log_security_event(
            event_type="ORDER_CREATED",
            severity="INFO",
            user_id=customer_uid,
            details={
                "order_id": order_id,
                "total_paise": total_paise,
                "payment_order_id": payment_order_id,
            },
        )
        return order

    def process_payment_webhook(self, event_data: dict[str, Any], ip_address: str = "unknown") -> dict[str, Any]:
        """Idempotently process verified Razorpay webhook events to transition orders to PAID or PAYMENT_FAILED."""
        event_id = str(event_data.get("id") or event_data.get("event_id") or "").strip()
        event_type = str(event_data.get("event") or "").strip()
        payload = event_data.get("payload", {})
        payment_entity = payload.get("payment", {}).get("entity", {})
        order_entity = payload.get("order", {}).get("entity", {})

        # Fallback deduplication identifier if event_id is omitted
        if not event_id:
            pid = payment_entity.get("id")
            oid = payment_entity.get("order_id") or order_entity.get("id")
            if pid and event_type:
                event_id = f"{pid}:{event_type}"
            elif oid and event_type:
                event_id = f"{oid}:{event_type}"

        # ── Webhook Replay Idempotency Check ─────────────────────────────────
        r = get_redis_client()
        if event_id:
            event_key = f"zipright:webhook_event:{event_id}"
            if r.set(event_key, "processed", nx=True, ex=WEBHOOK_IDEMPOTENCY_TTL_SECONDS) is None:
                logger.info("Webhook event %s already processed. Skipping duplicate.", event_id)
                log_security_event(
                    event_type="SECURITY_PAYMENT_WEBHOOK_DUPLICATE",
                    severity="INFO",
                    ip_address=ip_address,
                    details={"event_id": event_id, "event_type": event_type},
                )
                return {"status": "already_processed", "event_id": event_id}

        # Resolve the internal ZipRIGHT order ID
        payment_notes = payment_entity.get("notes") or {}
        order_notes = order_entity.get("notes") or {}
        notes = payment_notes if isinstance(payment_notes, dict) and payment_notes else order_notes
        if not isinstance(notes, dict):
            notes = {}

        zipright_order_id = (
            notes.get("zipright_order_id")
            or order_entity.get("receipt")
            or payment_entity.get("receipt")
        )
        provider_order_id = payment_entity.get("order_id") or order_entity.get("id")
        payment_id = payment_entity.get("id")

        if not zipright_order_id and provider_order_id:
            # Look up order in Firestore by payment_order_id
            query = self._db().collection(ORDERS_COLLECTION).where("payment_order_id", "==", provider_order_id)
            if hasattr(query, "limit"):
                query = query.limit(1)
            snaps = query.get()
            for snap in snaps:
                zipright_order_id = snap.id
                break

        if not zipright_order_id:
            logger.warning("Could not resolve Zipright order ID for payment order %s", provider_order_id)
            return {"status": "order_not_found"}

        order = self.get_order(zipright_order_id)
        if not order:
            return {"status": "order_not_found"}

        now = time.time()
        order_doc_ref = self._db().collection(ORDERS_COLLECTION).document(zipright_order_id)

        # ── Transition Logic ──────────────────────────────────────────────────
        if event_type in {"order.paid", "payment.captured"}:
            if order.status == OrderStatus.PENDING_PAYMENT.value:
                order.status = OrderStatus.PAID.value
                order.payment_id = payment_id
                order.paid_at = now
                order.updated_at = now

                order_doc_ref.set({
                    "status": OrderStatus.PAID.value,
                    "payment_id": payment_id,
                    "paid_at": now,
                    "updated_at": now,
                }, merge=True)

                # Invalidate/update Redis cache
                try:
                    r.set(f"zipright:order:{zipright_order_id}", json.dumps(_order_to_dict(order)), ex=CHECKOUT_IDEMPOTENCY_TTL_SECONDS)
                except Exception:
                    pass

                log_security_event(
                    event_type="SECURITY_PAYMENT_SUCCEEDED",
                    severity="INFO",
                    user_id=order.customer_uid,
                    details={
                        "order_id": zipright_order_id,
                        "payment_id": payment_id,
                        "amount_paise": order.total_paise,
                    },
                )
                logger.info("Order %s transitioned to PAID via verified webhook event %s", zipright_order_id, event_type)
                return {"status": "marked_paid", "order_id": zipright_order_id}

        elif event_type in {"payment.failed"}:
            if order.status == OrderStatus.PENDING_PAYMENT.value:
                order.status = OrderStatus.PAYMENT_FAILED.value
                order.failed_at = now
                order.updated_at = now

                order_doc_ref.set({
                    "status": OrderStatus.PAYMENT_FAILED.value,
                    "failed_at": now,
                    "updated_at": now,
                }, merge=True)

                try:
                    r.set(f"zipright:order:{zipright_order_id}", json.dumps(_order_to_dict(order)), ex=CHECKOUT_IDEMPOTENCY_TTL_SECONDS)
                except Exception:
                    pass

                log_security_event(
                    event_type="SECURITY_PAYMENT_FAILED",
                    severity="WARNING",
                    user_id=order.customer_uid,
                    details={
                        "order_id": zipright_order_id,
                        "reason": payment_entity.get("error_description", "Payment failed at gateway"),
                    },
                )
                return {"status": "marked_failed", "order_id": zipright_order_id}

        return {"status": "no_transition_needed", "current_status": order.status}


_ORDER_SERVICE: OrderService | None = None


def get_order_service() -> OrderService:
    global _ORDER_SERVICE
    if _ORDER_SERVICE is None:
        _ORDER_SERVICE = OrderService()
    return _ORDER_SERVICE
