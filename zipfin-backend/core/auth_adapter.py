"""Unified Auth Adapter for ZipRIGHT.

Provides provider-agnostic token verification supporting Firebase ID tokens,
Supabase JWTs, and developer API keys.
"""

import logging
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.config import settings
from services.firebase_auth import verify_firebase_token, AuthenticatedUser

logger = logging.getLogger(__name__)

auth_scheme = HTTPBearer(auto_error=False)


@dataclass
class UnifiedUser:
    id: str
    email: Optional[str]
    provider: str  # "firebase" | "supabase" | "api_key"
    access_token: str


def verify_token(token: str) -> UnifiedUser:
    """Verify a bearer token against the active auth provider."""
    token_clean = (token or "").strip()
    if not token_clean:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization bearer token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Provider dispatch
    if settings.AUTH_PROVIDER == "supabase" and settings.SUPABASE_JWT_SECRET:
        try:
            import jwt
            decoded = jwt.decode(
                token_clean,
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False},
            )
            sub = str(decoded.get("sub", "")).strip()
            email = decoded.get("email")
            if not sub:
                raise ValueError("Missing sub claim in Supabase token.")
            return UnifiedUser(
                id=sub,
                email=str(email) if email else None,
                provider="supabase",
                access_token=token_clean,
            )
        except Exception as exc:
            logger.warning("Supabase token verification failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Supabase access token.",
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc

    # Default: Firebase Auth
    firebase_user: AuthenticatedUser = verify_firebase_token(token_clean)
    return UnifiedUser(
        id=firebase_user.uid,
        email=firebase_user.email,
        provider="firebase",
        access_token=token_clean,
    )


def get_unified_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
) -> UnifiedUser:
    """FastAPI dependency for requiring an authenticated user across configured providers."""
    if credentials is None or not credentials.credentials.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization bearer token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return verify_token(credentials.credentials.strip())
