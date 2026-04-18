from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase_auth.errors import AuthApiError, AuthWeakPasswordError
from supabase_auth.types import AuthResponse

from core.supabase import get_supabase_client
from models.schema import AuthResult, AuthSession, AuthUser, EmailAuthRequest

auth_scheme = HTTPBearer(auto_error=False)


class CurrentUser(AuthUser):
    access_token: str


def sign_up_with_email(payload: EmailAuthRequest) -> AuthResult:
    client = get_supabase_client()
    try:
        auth_response = client.auth.sign_up(
            {
                "email": payload.email,
                "password": payload.password,
            }
        )
    except AuthWeakPasswordError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": exc.message,
                "details": {"reasons": exc.reasons},
            },
        ) from exc
    except AuthApiError as exc:
        raise HTTPException(
            status_code=exc.status,
            detail=exc.message,
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to sign up with Supabase.",
        ) from exc

    return _build_auth_result(auth_response)


def sign_in_with_email(payload: EmailAuthRequest) -> AuthResult:
    client = get_supabase_client()
    try:
        auth_response = client.auth.sign_in_with_password(
            {
                "email": payload.email,
                "password": payload.password,
            }
        )
    except AuthApiError as exc:
        raise HTTPException(
            status_code=exc.status,
            detail=exc.message,
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to sign in with Supabase.",
        ) from exc

    return _build_auth_result(auth_response)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(auth_scheme),
) -> CurrentUser:
    if credentials is None or not credentials.credentials.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization bearer token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = credentials.credentials.strip()
    client = get_supabase_client()

    try:
        user_response = client.auth.get_user(access_token)
    except AuthApiError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=exc.message,
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to validate Supabase access token.",
        ) from exc

    if user_response is None or user_response.user is None or not user_response.user.email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Supabase access token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return CurrentUser(
        id=user_response.user.id,
        email=user_response.user.email,
        access_token=access_token,
    )


def _build_auth_result(auth_response: AuthResponse) -> AuthResult:
    if auth_response.user is None or not auth_response.user.email:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Supabase did not return a valid user.",
        )

    session = auth_response.session
    return AuthResult(
        user=AuthUser(
            id=auth_response.user.id,
            email=auth_response.user.email,
        ),
        session=(
            AuthSession(
                access_token=session.access_token,
                refresh_token=session.refresh_token,
                expires_in=session.expires_in,
                token_type=session.token_type,
            )
            if session is not None
            else None
        ),
        needs_email_verification=session is None,
    )
