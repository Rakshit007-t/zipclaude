import logging

from fastapi import APIRouter, HTTPException, status

from core.api import success_response
from models.schema import ApiResponse, AuthResult, EmailAuthRequest
from services.auth_service import sign_in_with_email, sign_up_with_email

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


@router.post(
    "/signup",
    response_model=ApiResponse[AuthResult],
    status_code=status.HTTP_201_CREATED,
)
async def auth_signup(payload: EmailAuthRequest) -> ApiResponse[AuthResult]:
    try:
        result = sign_up_with_email(payload)
        message = (
            "Sign-up successful. Check your email to confirm your account."
            if result.needs_email_verification
            else "Sign-up successful."
        )
        return success_response(message=message, data=result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected auth signup failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to sign up.",
        ) from exc


@router.post(
    "/login",
    response_model=ApiResponse[AuthResult],
    status_code=status.HTTP_200_OK,
)
async def auth_login(payload: EmailAuthRequest) -> ApiResponse[AuthResult]:
    try:
        result = sign_in_with_email(payload)
        return success_response(message="Login successful.", data=result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected auth login failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to log in.",
        ) from exc
