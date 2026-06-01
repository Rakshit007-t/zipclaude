from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from services.gemini_inference import generate_stylist_reply

router = APIRouter(tags=["stylist"])
logger = logging.getLogger(__name__)


class StylistRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000)


class StylistResponse(BaseModel):
    reply: str


@router.post(
    "/stylist",
    response_model=StylistResponse,
    status_code=status.HTTP_200_OK,
)
async def stylist(payload: StylistRequest) -> StylistResponse:
    try:
        print("STYLIST REQUEST:", payload.message)
        if not payload.message.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty message")

        reply = await generate_stylist_reply(payload.message)
        return StylistResponse(reply=reply)
    except HTTPException:
        raise
    except Exception as exc:
        print("STYLIST ERROR:", str(exc))
        logger.exception("Stylist route failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stylist request failed",
        ) from exc
