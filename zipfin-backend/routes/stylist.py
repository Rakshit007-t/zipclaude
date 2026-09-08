from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from services.ai_guardrails import enforce_ai_usage_cap, sanitize_ai_prompt
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.stylist_engine import generate_stylist_reply

router = APIRouter(tags=["stylist"])
logger = logging.getLogger(__name__)


class StylistRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=600)


class StylistResponse(BaseModel):
    reply: str


@router.post(
    "/stylist",
    response_model=StylistResponse,
    status_code=status.HTTP_200_OK,
)
async def stylist(
    request: Request,
    payload: StylistRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> StylistResponse:
    client_ip = request.client.host if request.client else "unknown"

    # Enforce AI rate limiting & daily compute quota
    enforce_ai_usage_cap(user_id=current_user.uid, ip_address=client_ip)

    # Sanitize and neutralize prompt injection
    safe_message = sanitize_ai_prompt(
        prompt=payload.message,
        user_id=current_user.uid,
        ip_address=client_ip,
        max_length=600,
    )

    try:
        reply = await generate_stylist_reply(safe_message, user_id=current_user.uid)
        return StylistResponse(reply=reply)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Stylist route failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stylist request failed",
        ) from exc
