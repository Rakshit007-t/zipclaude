import logging
import os
from dataclasses import dataclass

from fastapi import HTTPException, Request, status
from firebase_admin import auth

from core.config import settings
from firebase_config import initialize_firebase
initialize_firebase()

logger = logging.getLogger(__name__)


@dataclass
class AuthenticatedUser:
    uid: str
    email: str | None
    is_anonymous: bool = False


def verify_firebase_token(token: str) -> AuthenticatedUser:
    token_value = (token or "").strip()
    if not token_value:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization bearer token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        decoded = auth.verify_id_token(token_value)
    except Exception as exc:
        logger.warning("Firebase token verification failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "message": "Invalid Firebase access token.",
                "details": {"code": "invalid_token"},
            },
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    uid = str(decoded["uid"]).strip()
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "message": "Invalid Firebase access token.",
                "details": {"code": "missing_uid"},
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    email = decoded.get("email")
    firebase_claims = decoded.get("firebase")
    sign_in_provider = (
        firebase_claims.get("sign_in_provider")
        if isinstance(firebase_claims, dict)
        else None
    )
    return AuthenticatedUser(
        uid=uid,
        email=str(email) if isinstance(email, str) else None,
        # Firebase anonymous ID tokens identify their provider explicitly. Do
        # not infer this from the absence of an email: phone-only users are valid.
        is_anonymous=sign_in_provider == "anonymous",
    )


def get_current_user(
    request: Request,
) -> AuthenticatedUser:
    authorization = request.headers.get("Authorization", "").strip()
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization bearer token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    current_user = verify_firebase_token(token)
    request.state.current_user = current_user
    return current_user


def get_optional_user(
    request: Request,
) -> AuthenticatedUser:
    """Accept Firebase auth, with an anonymous local identity only in development."""
    authorization = request.headers.get("Authorization", "").strip()
    is_development = settings.ENV.lower() in {"development", "dev", "local", "test", "testing"}
    if not authorization:
        if is_development:
            demo_user = AuthenticatedUser(uid="demo-anonymous", email=None, is_anonymous=True)
            request.state.current_user = demo_user
            return demo_user
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization bearer token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization bearer token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    current_user = verify_firebase_token(token)
    request.state.current_user = current_user
    return current_user

