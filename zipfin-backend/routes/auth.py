import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status

from pydantic import BaseModel, Field

from core.api import success_response
from models.schema import AccessStatusResponse, ApiResponse, AuthResult, EmailAuthRequest
from services.auth_service import (
    change_user_password,
    request_password_reset,
    sign_in_with_email,
    sign_up_with_email,
)
from services.account_lockout import (
    check_account_locked,
    record_failed_attempt,
    reset_failed_attempts,
)
from services.bot_protection import check_bot_user_agent, validate_honeypot
from services.admin_auth import AdminGate, get_admin_gate
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.request_rate_limiter import enforce_rate_limit
from services.seller_repository import SellerRepository, get_seller_repository
from core.authorization import resolve_authorization_context

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


class PasswordResetRequest(BaseModel):
    email: str = Field(..., max_length=254)
    honeypot: str | None = Field(default=None, description="Hidden bot trap field, must be empty")


class PasswordChangeRequest(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=128)


@router.get(
    "/access",
    response_model=ApiResponse[AccessStatusResponse],
    status_code=status.HTTP_200_OK,
)
async def auth_access(
    request: Request,
    current_user: AuthenticatedUser = Depends(get_current_user),
    admin_gate: AdminGate = Depends(get_admin_gate),
    seller_repository: SellerRepository = Depends(get_seller_repository),
) -> ApiResponse[AccessStatusResponse]:
    """Return server-authoritative route-access roles for the signed-in user."""
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"auth_access:{current_user.uid}:{client_ip}",
        max_requests=60,
        window_seconds=60,
        detail="Too many access checks. Please try again later.",
    )
    context = await resolve_authorization_context(
        current_user=current_user,
        admin_gate=admin_gate,
        seller_repository=seller_repository,
    )
    return success_response(
        message="Account access retrieved.",
        data=AccessStatusResponse(
            is_admin=context.is_admin,
            is_seller=context.is_seller,
            role=context.primary_role.value,
            roles=[r.value for r in sorted(context.roles, key=lambda x: x.value)],
            permissions=[p.value for p in sorted(context.permissions, key=lambda x: x.value)],
        ),
    )


@router.post(
    "/signup",
    response_model=ApiResponse[AuthResult],
    status_code=status.HTTP_201_CREATED,
)
async def auth_signup(request: Request, payload: EmailAuthRequest) -> ApiResponse[AuthResult]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"auth_signup:{client_ip}",
        max_requests=10,
        window_seconds=60,
        detail="Too many sign-up attempts. Please try again later.",
    )
    validate_honeypot(payload.honeypot, ip_address=client_ip, endpoint="/auth/signup")
    try:
        result = sign_up_with_email(payload)
        message = "Sign-up successful. Check your email to confirm your account." if result.needs_email_verification else "Sign-up successful."
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
async def auth_login(request: Request, payload: EmailAuthRequest) -> ApiResponse[AuthResult]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"auth_login:{client_ip}",
        max_requests=10,
        window_seconds=60,
        detail="Too many login attempts. Please try again later.",
    )
    validate_honeypot(payload.honeypot, ip_address=client_ip, endpoint="/auth/login")
    # Check account lockout before attempting authentication
    check_account_locked(payload.email, ip_address=client_ip)

    try:
        result = sign_in_with_email(payload)
        reset_failed_attempts(payload.email)
        return success_response(message="Login successful.", data=result)
    except HTTPException:
        record_failed_attempt(payload.email, ip_address=client_ip)
        raise
    except Exception as exc:
        record_failed_attempt(payload.email, ip_address=client_ip)
        logger.exception("Unexpected auth login failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to log in.",
        ) from exc


@router.post(
    "/password-reset",
    response_model=ApiResponse[dict[str, str]],
    status_code=status.HTTP_200_OK,
)
async def auth_password_reset(request: Request, payload: PasswordResetRequest) -> ApiResponse[dict[str, str]]:
    client_ip = request.client.host if request.client else "unknown"
    # Strict rate limit: max 3 requests per 15 minutes per IP/email
    enforce_rate_limit(
        key=f"auth_pwd_reset:{client_ip}:{payload.email.strip().lower()}",
        max_requests=3,
        window_seconds=900,
        detail="Too many password reset requests. Please try again in 15 minutes.",
    )
    validate_honeypot(payload.honeypot, ip_address=client_ip, endpoint="/auth/password-reset")
    request_password_reset(payload.email)
    # Generic response prevents user enumeration
    return success_response(
        message="If an account exists for this email, password reset instructions have been sent.",
        data={"status": "sent"},
    )


@router.post(
    "/password-change",
    response_model=ApiResponse[dict[str, str]],
    status_code=status.HTTP_200_OK,
)
async def auth_password_change(
    payload: PasswordChangeRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[dict[str, str]]:
    if (
        len(payload.new_password) < 8
        or not any(c.isalpha() for c in payload.new_password)
        or not any(c.isdigit() for c in payload.new_password)
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters long and contain both letters and numbers.",
        )
    change_user_password(current_user.uid, payload.new_password)
    return success_response(
        message="Password changed successfully. All previous sessions have been reset.",
        data={"status": "password_updated"},
    )
