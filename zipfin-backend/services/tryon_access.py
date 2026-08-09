"""Atomic entitlement checks for paid try-on generation."""

from __future__ import annotations

from dataclasses import dataclass

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

    user_ref = get_firestore_client().collection("users").document(current_user.uid)
    try:
        return _consume_tryon_credit(get_firestore_client().transaction(), user_ref)
    except _TryOnAccessDenied as exc:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={"message": exc.message, "details": {"code": exc.code}},
        ) from exc


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
    user_ref = get_firestore_client().collection("users").document(current_user.uid)
    return _credit_wallet(get_firestore_client().transaction(), user_ref, amount_rupees)
