"""Atomic entitlement checks for paid try-on generation."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException, status
from firebase_admin import firestore

from firebase_config import get_firestore_client
from services.firebase_auth import AuthenticatedUser

FREE_TRY_ONS = 3
TRY_ON_COST_RUPEES = 5


@dataclass(frozen=True)
class TryOnCharge:
    try_ons_used: int
    wallet_balance_rupees: int
    charged_rupees: int


class _TryOnAccessDenied(Exception):
    def __init__(self, *, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def _nonnegative_int(value: object, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return max(0, int(value))
    return default


@firestore.transactional
def _consume_tryon_credit(transaction, user_ref) -> TryOnCharge:
    snapshot = user_ref.get(transaction=transaction)
    data = snapshot.to_dict() or {} if snapshot.exists else {}
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    try_ons_used = _nonnegative_int(usage.get("tryOns"))
    wallet_balance = _nonnegative_int(data.get("walletBalanceRupees"))

    if try_ons_used >= FREE_TRY_ONS and wallet_balance < TRY_ON_COST_RUPEES:
        free_tier_exhausted = wallet_balance == 0
        raise _TryOnAccessDenied(
            code=("free_tier_exhausted" if free_tier_exhausted else "insufficient_wallet_balance"),
            message=(
                "Your 3 free try-ons are used. Insufficient balance, please add funds."
                if free_tier_exhausted
                else "Insufficient balance, please add funds."
            ),
        )

    charged_rupees = TRY_ON_COST_RUPEES if try_ons_used >= FREE_TRY_ONS else 0
    next_usage = try_ons_used + 1
    next_balance = wallet_balance - charged_rupees
    transaction.set(
        user_ref,
        {
            "usage": {"tryOns": next_usage},
            "walletBalanceRupees": next_balance,
            "updatedAt": firestore.SERVER_TIMESTAMP,
            **({"createdAt": firestore.SERVER_TIMESTAMP} if not snapshot.exists else {}),
        },
        merge=True,
    )
    return TryOnCharge(
        try_ons_used=next_usage,
        wallet_balance_rupees=next_balance,
        charged_rupees=charged_rupees,
    )


def consume_tryon_credit_for_uid(uid: str) -> TryOnCharge:
    """Atomically reserve one free try-on or deduct its wallet cost by UID."""
    if not uid or not uid.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Valid user UID required.",
        )
    safe_uid = uid.strip()
    provider = os.getenv("DATABASE_PROVIDER", "firebase").strip().lower()

    if provider == "appwrite":
        from core.redis_client import get_redis_client
        from services.database_adapter import get_database_adapter
        from services.distributed_transaction_manager import get_transaction_manager
        db_adapter = get_database_adapter()
        tx_mgr = get_transaction_manager()
        redis_client = get_redis_client()
        cache_key = f"wallet_cache:{safe_uid}"

        with tx_mgr.acquire_lock(f"user_wallet:{safe_uid}"):
            cached_raw = None
            if redis_client is not None:
                try:
                    cached_raw = redis_client.get(cache_key)
                except Exception:
                    cached_raw = None

            if cached_raw:
                try:
                    cached = json.loads(cached_raw)
                    wallet_balance = _nonnegative_int(cached.get("walletBalanceRupees"))
                    usage = cached.get("usage") or {}
                except Exception:
                    user_data = db_adapter.get_document("users", safe_uid) or {}
                    usage = user_data.get("usage")
                    wallet_balance = _nonnegative_int(user_data.get("walletBalanceRupees"))
            else:
                user_data = db_adapter.get_document("users", safe_uid) or {}
                usage = user_data.get("usage")
                wallet_balance = _nonnegative_int(user_data.get("walletBalanceRupees"))

            if isinstance(usage, str):
                try:
                    usage = json.loads(usage)
                except Exception:
                    usage = {}
            elif not isinstance(usage, dict):
                usage = {}
            try_ons_used = _nonnegative_int(usage.get("tryOns"))

            if try_ons_used >= FREE_TRY_ONS and wallet_balance < TRY_ON_COST_RUPEES:
                free_tier_exhausted = wallet_balance == 0
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail={
                        "message": (
                            "Your 3 free try-ons are used. Insufficient balance, please add funds."
                            if free_tier_exhausted
                            else "Insufficient balance, please add funds."
                        ),
                        "details": {"code": "free_tier_exhausted" if free_tier_exhausted else "insufficient_wallet_balance"},
                    },
                )

            charged_rupees = TRY_ON_COST_RUPEES if try_ons_used >= FREE_TRY_ONS else 0
            next_usage = try_ons_used + 1
            next_balance = wallet_balance - charged_rupees

            db_adapter.set_document(
                "users",
                safe_uid,
                {
                    "usage": {"tryOns": next_usage},
                    "walletBalanceRupees": next_balance,
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                },
                merge=True,
            )
            if redis_client is not None:
                try:
                    redis_client.set(
                        cache_key,
                        json.dumps({"walletBalanceRupees": next_balance, "usage": {"tryOns": next_usage}}),
                        ex=15,
                    )
                except Exception:
                    pass
            return TryOnCharge(
                try_ons_used=next_usage,
                wallet_balance_rupees=next_balance,
                charged_rupees=charged_rupees,
            )

    user_ref = get_firestore_client().collection("users").document(safe_uid)
    try:
        return _consume_tryon_credit(get_firestore_client().transaction(), user_ref)
    except _TryOnAccessDenied as exc:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={"message": exc.message, "details": {"code": exc.code}},
        ) from exc


def consume_tryon_credit(current_user: AuthenticatedUser) -> TryOnCharge:
    """Atomically reserve one free try-on or deduct its wallet cost.

    This must run before queueing or invoking a renderer. Firestore retries the
    transaction on concurrent writes, so two requests cannot consume the same
    free use or wallet funds.
    """
    if current_user.is_anonymous:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "Please sign up to try on.",
                "details": {"code": "anonymous_user_blocked"},
            },
        )

    return consume_tryon_credit_for_uid(current_user.uid)


@firestore.transactional
def _refund_tryon_credit(
    transaction,
    user_ref,
    refund_ref,
    charged_rupees: int,
    free_tryon: bool,
) -> int:
    refund_snap = refund_ref.get(transaction=transaction)
    if refund_snap.exists:
        # Already refunded; idempotently return current balance
        user_snap = user_ref.get(transaction=transaction)
        user_data = user_snap.to_dict() or {} if user_snap.exists else {}
        return _nonnegative_int(user_data.get("walletBalanceRupees"))

    user_snap = user_ref.get(transaction=transaction)
    user_data = user_snap.to_dict() or {} if user_snap.exists else {}
    usage = user_data.get("usage") if isinstance(user_data.get("usage"), dict) else {}
    current_tryons = _nonnegative_int(usage.get("tryOns"))
    current_balance = _nonnegative_int(user_data.get("walletBalanceRupees"))

    new_balance = max(0, current_balance + max(0, charged_rupees))
    new_tryons = max(0, current_tryons - 1) if free_tryon else current_tryons

    transaction.set(
        user_ref,
        {
            "walletBalanceRupees": new_balance,
            "usage": {"tryOns": new_tryons},
            "updatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )
    transaction.set(
        refund_ref,
        {
            "charged_rupees": charged_rupees,
            "free_tryon": free_tryon,
            "refunded_at": firestore.SERVER_TIMESTAMP,
        },
    )
    return new_balance


def refund_tryon_credit(
    user_id: str,
    job_id: str,
    charged_rupees: int = 0,
    free_tryon: bool = False,
) -> int:
    """Atomically and idempotently refund credits or restore free quota after rendering failure."""
    if not user_id or not job_id:
        return 0

    provider = os.getenv("DATABASE_PROVIDER", "firebase").strip().lower()
    if provider == "appwrite":
        from core.redis_client import get_redis_client
        from core.security_logger import log_security_event
        from services.database_adapter import get_database_adapter
        from services.distributed_transaction_manager import get_transaction_manager

        db_adapter = get_database_adapter()
        tx_mgr = get_transaction_manager()
        redis_client = get_redis_client()
        cache_key = f"wallet_cache:{user_id}"

        try:
            with tx_mgr.acquire_lock(f"user_wallet:{user_id}"):
                # Check idempotency sentinel
                existing_refund = db_adapter.get_document("tryon_refunds", job_id)
                cached_raw = None
                if redis_client is not None:
                    try:
                        cached_raw = redis_client.get(cache_key)
                    except Exception:
                        cached_raw = None

                if cached_raw:
                    try:
                        cached = json.loads(cached_raw)
                        current_balance = _nonnegative_int(cached.get("walletBalanceRupees"))
                        usage = cached.get("usage") or {}
                    except Exception:
                        user_data = db_adapter.get_document("users", user_id) or {}
                        usage = user_data.get("usage")
                        current_balance = _nonnegative_int(user_data.get("walletBalanceRupees"))
                else:
                    user_data = db_adapter.get_document("users", user_id) or {}
                    usage = user_data.get("usage")
                    current_balance = _nonnegative_int(user_data.get("walletBalanceRupees"))

                if existing_refund is not None:
                    return current_balance

                if isinstance(usage, str):
                    try:
                        usage = json.loads(usage)
                    except Exception:
                        usage = {}
                elif not isinstance(usage, dict):
                    usage = {}

                current_tryons = _nonnegative_int(usage.get("tryOns"))
                new_balance = max(0, current_balance + max(0, charged_rupees))
                new_tryons = max(0, current_tryons - 1) if free_tryon else current_tryons

                db_adapter.set_document(
                    "users",
                    user_id,
                    {
                        "walletBalanceRupees": new_balance,
                        "usage": {"tryOns": new_tryons},
                        "updatedAt": datetime.now(timezone.utc).isoformat(),
                    },
                    merge=True,
                )
                db_adapter.set_document(
                    "tryon_refunds",
                    job_id,
                    {
                        "charged_rupees": charged_rupees,
                        "free_tryon": free_tryon,
                        "refunded_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                if redis_client is not None:
                    try:
                        redis_client.set(
                            cache_key,
                            json.dumps({"walletBalanceRupees": new_balance, "usage": {"tryOns": new_tryons}}),
                            ex=15,
                        )
                    except Exception:
                        pass
                log_security_event(
                    event_type="TRYON_CREDIT_REFUNDED",
                    severity="INFO",
                    user_id=user_id,
                    details={"job_id": job_id, "charged_rupees": charged_rupees, "free_tryon": free_tryon, "new_balance": new_balance},
                )
                return new_balance
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("Failed to refund tryon credit for user %s job %s: %s", user_id, job_id, exc)
            return 0

    db = get_firestore_client()
    user_ref = db.collection("users").document(user_id)
    refund_ref = db.collection("tryon_refunds").document(job_id)

    try:
        from core.security_logger import log_security_event
        balance = _refund_tryon_credit(
            db.transaction(),
            user_ref,
            refund_ref,
            charged_rupees,
            free_tryon,
        )
        log_security_event(
            event_type="TRYON_CREDIT_REFUNDED",
            severity="INFO",
            user_id=user_id,
            details={"job_id": job_id, "charged_rupees": charged_rupees, "free_tryon": free_tryon, "new_balance": balance},
        )
        return balance
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Failed to refund tryon credit for user %s job %s: %s", user_id, job_id, exc)
        return 0


@firestore.transactional
def _credit_wallet(transaction, user_ref, amount_rupees: int) -> int:
    snapshot = user_ref.get(transaction=transaction)
    data = snapshot.to_dict() or {} if snapshot.exists else {}
    next_balance = _nonnegative_int(data.get("walletBalanceRupees")) + amount_rupees
    transaction.set(
        user_ref,
        {
            "walletBalanceRupees": next_balance,
            "updatedAt": firestore.SERVER_TIMESTAMP,
            **({"createdAt": firestore.SERVER_TIMESTAMP} if not snapshot.exists else {}),
        },
        merge=True,
    )
    return next_balance


def credit_wallet(current_user: AuthenticatedUser, amount_rupees: int) -> int:
    provider = os.getenv("DATABASE_PROVIDER", "firebase").strip().lower()
    if provider == "appwrite":
        from core.redis_client import get_redis_client
        from services.database_adapter import get_database_adapter
        from services.distributed_transaction_manager import get_transaction_manager

        db_adapter = get_database_adapter()
        tx_mgr = get_transaction_manager()
        redis_client = get_redis_client()
        cache_key = f"wallet_cache:{current_user.uid}"

        with tx_mgr.acquire_lock(f"user_wallet:{current_user.uid}"):
            cached_raw = None
            if redis_client is not None:
                try:
                    cached_raw = redis_client.get(cache_key)
                except Exception:
                    cached_raw = None

            if cached_raw:
                try:
                    cached = json.loads(cached_raw)
                    current_balance = _nonnegative_int(cached.get("walletBalanceRupees"))
                    usage = cached.get("usage") or {}
                except Exception:
                    user_data = db_adapter.get_document("users", current_user.uid) or {}
                    current_balance = _nonnegative_int(user_data.get("walletBalanceRupees"))
                    usage = user_data.get("usage") or {}
            else:
                user_data = db_adapter.get_document("users", current_user.uid) or {}
                current_balance = _nonnegative_int(user_data.get("walletBalanceRupees"))
                usage = user_data.get("usage") or {}

            next_balance = current_balance + amount_rupees
            db_adapter.set_document(
                "users",
                current_user.uid,
                {
                    "walletBalanceRupees": next_balance,
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                },
                merge=True,
            )
            if redis_client is not None:
                try:
                    redis_client.set(
                        cache_key,
                        json.dumps({"walletBalanceRupees": next_balance, "usage": usage}),
                        ex=15,
                    )
                except Exception:
                    pass
            return next_balance

    user_ref = get_firestore_client().collection("users").document(current_user.uid)
    return _credit_wallet(get_firestore_client().transaction(), user_ref, amount_rupees)
