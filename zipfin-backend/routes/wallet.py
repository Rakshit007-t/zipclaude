"""Temporary, operator-authorized wallet credits."""

from __future__ import annotations

from hmac import compare_digest

from fastapi import APIRouter, Depends, HTTPException, Request, status

from core.api import success_response
from core.config import settings
from models.schema import ApiResponse, WalletTopUpRequest, WalletTopUpResponse
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.tryon_access import credit_wallet

router = APIRouter(prefix="/wallet", tags=["wallet"])


@router.post(
    "/topup",
    response_model=ApiResponse[WalletTopUpResponse],
    status_code=status.HTTP_200_OK,
)
async def manual_wallet_topup(
    request: Request,
    payload: WalletTopUpRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[WalletTopUpResponse]:
    """Credit a user after an operator has manually confirmed a payment.

    TEMPORARY: this endpoint deliberately has no payment-gateway integration.
    It is protected by a server-only operator secret and must be replaced with
    verified payment webhooks before any public top-up UI is added.
    """
    configured_secret = settings.WALLET_TOPUP_SECRET
    provided_secret = request.headers.get("X-Wallet-Topup-Secret", "")
    if not configured_secret or not compare_digest(provided_secret, configured_secret):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "Wallet top-up is restricted to authorized operators.",
                "details": {"code": "wallet_topup_not_authorized"},
            },
        )

    balance = credit_wallet(current_user, payload.amount_rupees)
    return success_response(
        message="Wallet credited successfully.",
        data=WalletTopUpResponse(wallet_balance_rupees=balance),
    )
