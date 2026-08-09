import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status

from core.api import success_response
from models.schema import AccessStatusResponse, ApiResponse, AuthResult, EmailAuthRequest
from services.auth_service import sign_in_with_email, sign_up_with_email
from services.admin_auth import AdminGate, get_admin_gate
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.request_rate_limiter import enforce_rate_limit
from services.seller_repository import SellerRepository, get_seller_repository

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


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
    is_admin, seller_record = await asyncio.gather(
        asyncio.to_thread(admin_gate.is_admin, current_user.uid),
        asyncio.to_thread(seller_repository.get_seller, current_user.uid),
    )
    return success_response(
        message="Account access retrieved.",
        data=AccessStatusResponse(
            is_admin=is_admin,
            is_seller=bool(seller_record and seller_record.get("status") == "active"),
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
async def auth_login(request: Request, payload: EmailAuthRequest) -> ApiResponse[AuthResult]:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        key=f"auth_login:{client_ip}",
        max_requests=10,
        window_seconds=60,
        detail="Too many login attempts. Please try again later.",
    )
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
