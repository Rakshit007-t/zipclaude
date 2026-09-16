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
CHECKOUT_LOCK_TTL_SECONDS = 30         # 30 seconds atomic lock lease
CHECKOUT_POLL_TIMEOUT_SECONDS = 2.0    # Concurrency backoff timeout
CHECKOUT_POLL_INTERVAL_SECONDS = 0.2
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

    def list_seller_orders(
        self,
        seller_uid: str,
        limit: int = 20,
        offset: int = 0,
    ) -> list[Order]:
        """Fetch orders containing items sold by this seller, newest first.

        Uses Firestore array_contains on seller_uids index.
        Pagination is bounded between 1 and 100 items.
        """
        seller_uid = seller_uid.strip()
        if not seller_uid:
            return []

        limit = max(1, min(limit, 100))
        offset = max(0, offset)

        snaps = (
            self._db()
            .collection(ORDERS_COLLECTION)
            .where("seller_uids", "array_contains", seller_uid)
            .get()
        )
        orders: list[Order] = []
        for snap in snaps:
            orders.append(_doc_to_order(snap.id, snap.to_dict() or {}))

        # Sort newest first
        orders.sort(key=lambda x: x.created_at, reverse=True)
        return orders[offset : offset + limit]

    def create_checkout_order(
        self,
        *,
        customer_uid: str,
        items_payload: list[dict[str, Any]],
        idempotency_key: str | None = None,
    ) -> Order:
        """Create a server-authoritative checkout order with strict price integrity and atomic distributed idempotency.

        1. Atomic distributed lock using Redis SET key value NX EX <ttl>.
        2. Revalidates every product against seller_products.
        3. Rejects client-supplied prices, totals, or seller assignments.
        4. Computes exact integer paise totals on the server.
        5. Creates a Razorpay order matching the server-determined amount.
        6. Replays existing order if duplicate request or fails closed if Redis is down in production.
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

        # ── 1. Atomic Distributed Idempotency Lock ─────────────────────────────
        idem_key = None
        lock_acquired = False
        if idempotency_key:
            idem_key = f"zipright:checkout:idempotency:{customer_uid}:{idempotency_key}"
            try:
                # Atomic distributed lock: SET key value NX EX <ttl>
                lock_acquired = bool(r.set(idem_key, "IN_PROGRESS", nx=True, ex=CHECKOUT_LOCK_TTL_SECONDS))
            except Exception as exc:
                logger.error("Redis error acquiring idempotency lock for %s: %s", idem_key, exc)
                # Production failure behavior: fail-closed if Redis is down to guarantee strong idempotency
                from core.config import settings
                if settings.ENV in ("production", "staging") or os.getenv("STRICT_REDIS_IDEMPOTENCY", "false").lower() == "true":
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Idempotency service temporarily unavailable. Please retry shortly.",
                    )
                # Local development/testing fallback when not in strict mode
                lock_acquired = True

            if not lock_acquired:
                # Key already exists: another request is in progress or completed.
                # Poll up to CHECKOUT_POLL_TIMEOUT_SECONDS for the concurrent winner to finish.
                val = None
                poll_end = time.time() + CHECKOUT_POLL_TIMEOUT_SECONDS
                while time.time() < poll_end:
                    try:
                        raw = r.get(idem_key)
                        val = raw.decode("utf-8") if isinstance(raw, bytes) else raw
                    except Exception:
                        val = None

                    if val and val != "IN_PROGRESS":
                        break
                    time.sleep(CHECKOUT_POLL_INTERVAL_SECONDS)

                if val and val != "IN_PROGRESS":
                    existing = self.get_order(str(val))
                    if existing and existing.customer_uid == customer_uid:
                        logger.info("Checkout idempotency replayed for user %s: order %s", customer_uid, existing.order_id)
                        return existing

                # Still IN_PROGRESS or winner failed to produce order
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A checkout request with this idempotency key is already in progress. Please retry shortly.",
                )

        try:
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
                if idempotency_key and idem_key:
                    # Update idempotency key from "IN_PROGRESS" to the confirmed order_id with 1-hour TTL
                    r.set(idem_key, order_id, ex=CHECKOUT_IDEMPOTENCY_TTL_SECONDS)
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
        except Exception:
            # If order creation failed, release the in-progress lock so client can retry
            if idempotency_key and idem_key:
                try:
                    raw = r.get(idem_key)
                    val = raw.decode("utf-8") if isinstance(raw, bytes) else raw
                    if val == "IN_PROGRESS":
                        r.delete(idem_key)
                except Exception:
                    pass
            raise

    def create_package_order(
        self,
        *,
        customer_uid: str,
        package_id: str,
    ) -> Order:
        """Create a server-authoritative payment order for subscription credits or top-up packages."""
        from services.payment_service import get_server_price

        customer_uid = customer_uid.strip()
        if not customer_uid:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")

        package = get_server_price(package_id)
        amount_paise = int(package.get("amount_paise") or (package["amount_rupees"] * 100))
        currency = package.get("currency", "INR")

        now = time.time()
        order_id = f"ord_pkg_{uuid4().hex}"

        notes = {
            "zipright_order_id": order_id,
            "customer_uid": customer_uid,
            "package_id": package["id"],
        }
        provider_order = create_razorpay_order(
            amount_paise=amount_paise,
            currency=currency,
            receipt=order_id,
            notes=notes,
        )
        payment_order_id = provider_order.get("id")

        order = Order(
            order_id=order_id,
            customer_uid=customer_uid,
            status=OrderStatus.PENDING_PAYMENT.value,
            currency=currency,
            items=[{
                "product_id": package["id"],
                "seller_uid": "platform",
                "title": package["title"],
                "quantity": 1,
                "unit_price_paise": amount_paise,
                "line_total_paise": amount_paise,
                "credits": package.get("credits", 0),
            }],
            subtotal_paise=amount_paise,
            shipping_paise=0,
            tax_paise=0,
            total_paise=amount_paise,
            seller_uids=["platform"],
            payment_provider="razorpay",
            payment_order_id=payment_order_id,
            payment_id=None,
            created_at=now,
            updated_at=now,
        )

        order_dict = _order_to_dict(order)
        self._db().collection(ORDERS_COLLECTION).document(order_id).set(order_dict)

        try:
            r = get_redis_client()
            r.set(f"zipright:order:{order_id}", json.dumps(order_dict), ex=CHECKOUT_IDEMPOTENCY_TTL_SECONDS)
        except Exception as exc:
            logger.warning("Failed to cache package order %s in Redis: %s", order_id, exc)

        log_security_event(
            event_type="ORDER_CREATED",
            severity="INFO",
            user_id=customer_uid,
            details={
                "order_id": order_id,
                "total_paise": amount_paise,
                "payment_order_id": payment_order_id,
                "package_id": package["id"],
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

        # ── Step 3: Provider Order ID Verification ───────────────────────────
        # Webhook provider order ID must strictly match stored order.payment_order_id
        if not provider_order_id or not order.payment_order_id or str(provider_order_id).strip() != str(order.payment_order_id).strip():
            logger.warning(
                "Provider order ID mismatch for order %s: webhook=%s vs stored=%s",
                zipright_order_id,
                provider_order_id,
                order.payment_order_id,
            )
            log_security_event(
                event_type="SECURITY_PAYMENT_PROVIDER_ORDER_MISMATCH",
                severity="CRITICAL",
                ip_address=ip_address,
                details={
                    "order_id": zipright_order_id,
                    "webhook_provider_order_id": str(provider_order_id),
                    "stored_payment_order_id": str(order.payment_order_id),
                },
            )
            return {"status": "provider_order_mismatch", "order_id": zipright_order_id}

        now = time.time()
        order_doc_ref = self._db().collection(ORDERS_COLLECTION).document(zipright_order_id)

        # ── Transition Logic ──────────────────────────────────────────────────
        if event_type in {"order.paid", "payment.captured"}:
            # 1. State check (Step 8: Payment State Machine)
            if order.status != OrderStatus.PENDING_PAYMENT.value:
                logger.info("Order %s not in payable state (current: %s)", zipright_order_id, order.status)
                return {"status": "no_transition_needed", "current_status": order.status}

            # 2. Payment amount verification (Step 2)
            raw_amount = payment_entity.get("amount") if payment_entity.get("amount") is not None else order_entity.get("amount")
            if raw_amount is None:
                logger.error("Missing payment amount in webhook payload for order %s", zipright_order_id)
                log_security_event(
                    event_type="SECURITY_PAYMENT_AMOUNT_MISMATCH",
                    severity="CRITICAL",
                    ip_address=ip_address,
                    details={"order_id": zipright_order_id, "reason": "missing_amount"},
                )
                return {"status": "amount_mismatch", "order_id": zipright_order_id}

            try:
                webhook_amount_paise = int(raw_amount)
            except (ValueError, TypeError):
                logger.error("Invalid payment amount format in webhook for order %s: %s", zipright_order_id, raw_amount)
                log_security_event(
                    event_type="SECURITY_PAYMENT_AMOUNT_MISMATCH",
                    severity="CRITICAL",
                    ip_address=ip_address,
                    details={"order_id": zipright_order_id, "reason": "invalid_amount_type"},
                )
                return {"status": "amount_mismatch", "order_id": zipright_order_id}

            if webhook_amount_paise != order.total_paise:
                logger.error(
                    "Payment amount mismatch for order %s: webhook=%d paise vs expected=%d paise",
                    zipright_order_id,
                    webhook_amount_paise,
                    order.total_paise,
                )
                log_security_event(
                    event_type="SECURITY_PAYMENT_AMOUNT_MISMATCH",
                    severity="CRITICAL",
                    ip_address=ip_address,
                    details={
                        "order_id": zipright_order_id,
                        "webhook_amount_paise": webhook_amount_paise,
                        "expected_total_paise": order.total_paise,
                    },
                )
                return {"status": "amount_mismatch", "order_id": zipright_order_id}

            # 3. Currency verification (Step 2)
            raw_currency = payment_entity.get("currency") or order_entity.get("currency")
            if not raw_currency or str(raw_currency).strip().upper() != order.currency.strip().upper():
                logger.error(
                    "Payment currency mismatch for order %s: webhook=%s vs expected=%s",
                    zipright_order_id,
                    raw_currency,
                    order.currency,
                )
                log_security_event(
                    event_type="SECURITY_PAYMENT_CURRENCY_MISMATCH",
                    severity="CRITICAL",
                    ip_address=ip_address,
                    details={
                        "order_id": zipright_order_id,
                        "webhook_currency": str(raw_currency),
                        "expected_currency": order.currency,
                    },
                )
                return {"status": "currency_mismatch", "order_id": zipright_order_id}

            # All checks succeeded: transition to PAID
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
