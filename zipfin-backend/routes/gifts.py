"""Gift-payment boundary. No gift or reward is created before verified payment."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from core.config import settings
from models.schema import ApiResponse
from services.firebase_auth import AuthenticatedUser, get_current_user

router = APIRouter(prefix="/gifts", tags=["gifts"])


class GiftIntentRequest(BaseModel):
    recipient_uid: str = Field(..., min_length=1, max_length=128)
    product: dict[str, Any]
    note: str = Field("", max_length=120)


@router.post("/intents", response_model=ApiResponse[dict], status_code=status.HTTP_201_CREATED)
async def create_gift_payment_intent(
    payload: GiftIntentRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[dict]:
    """Fail closed until verified payment/webhook support is deployed."""
    configured = settings.PAYMENT_PROVIDER == "razorpay" and settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET
    if not configured:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail={"message": "Gift payments are not configured.", "details": {"code": "payment_provider_not_configured"}})
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail={"message": "Verified gift-payment processing is not deployed.", "details": {"code": "gift_payment_webhook_required"}})
