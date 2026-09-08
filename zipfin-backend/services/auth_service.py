from __future__ import annotations

import json
import os
from pathlib import Path

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from models.schema import AuthResult, AuthSession, AuthUser, EmailAuthRequest
from services.firebase_auth import verify_firebase_token

auth_scheme = HTTPBearer(auto_error=False)

FIREBASE_TIMEOUT_SECONDS = 5.0
FIREBASE_CONFIG_PATH = (
    Path(__file__).resolve().parents[2] / "zipfend" / "firebase-applet-config.json"
)


class CurrentUser(AuthUser):
    access_token: str


def _get_firebase_web_api_key() -> str:
    api_key = os.getenv("FIREBASE_WEB_API_KEY", "").strip()
    if api_key:
        return api_key

    try:
        config_payload = json.loads(FIREBASE_CONFIG_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase web API key is not configured.",
        ) from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Firebase web config is invalid JSON.",
        ) from exc

    api_key = str(config_payload.get("apiKey") or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase web API key is not configured.",
        )
    return api_key


def _firebase_endpoint(path: str) -> str:
    return (
        f"https://identitytoolkit.googleapis.com/v1/{path}"
        f"?key={_get_firebase_web_api_key()}"
    )


def _raise_firebase_error(response: httpx.Response) -> None:
    payload: dict = {}
    try:
        payload = response.json()
    except ValueError:
        payload = {}

    raw_message = str(payload.get("error", {}).get("message") or "").strip()
    error_code = raw_message.split(" : ", 1)[0]

    friendly_messages = {
        "EMAIL_EXISTS": "This email is already registered.",
        "INVALID_LOGIN_CREDENTIALS": "Invalid email or password.",
        "INVALID_PASSWORD": "Invalid email or password.",
        "EMAIL_NOT_FOUND": "Invalid email or password.",
        "USER_DISABLED": "This account has been disabled.",
        "TOO_MANY_ATTEMPTS_TRY_LATER": "Too many attempts. Please try again later.",
        "WEAK_PASSWORD": raw_message.split(" : ", 1)[-1] if " : " in raw_message else "Password must be at least 6 characters.",
        "OPERATION_NOT_ALLOWED": "Email/password authentication is not enabled for this Firebase project.",
    }
    status_mapping = {
        "EMAIL_EXISTS": status.HTTP_409_CONFLICT,
        "INVALID_LOGIN_CREDENTIALS": status.HTTP_401_UNAUTHORIZED,
        "INVALID_PASSWORD": status.HTTP_401_UNAUTHORIZED,
        "EMAIL_NOT_FOUND": status.HTTP_401_UNAUTHORIZED,
        "USER_DISABLED": status.HTTP_403_FORBIDDEN,
        "TOO_MANY_ATTEMPTS_TRY_LATER": status.HTTP_429_TOO_MANY_REQUESTS,
        "WEAK_PASSWORD": status.HTTP_422_UNPROCESSABLE_ENTITY,
        "OPERATION_NOT_ALLOWED": status.HTTP_503_SERVICE_UNAVAILABLE,
    }

    raise HTTPException(
        status_code=status_mapping.get(error_code, response.status_code),
        detail=friendly_messages.get(
            error_code,
            raw_message or "Firebase authentication request failed.",
        ),
    )


def _firebase_request(path: str, payload: dict) -> dict:
    try:
        response = httpx.post(
            _firebase_endpoint(path),
            json=payload,
            timeout=FIREBASE_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to reach Firebase authentication.",
        ) from exc

    if response.is_error:
        _raise_firebase_error(response)

    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Firebase authentication returned an invalid response.",
        ) from exc

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Firebase authentication returned an invalid response.",
        )

    return data


def _build_auth_result(
    payload: dict,
    *,
    needs_email_verification: bool,
) -> AuthResult:
    user_id = str(payload.get("localId") or "").strip()
    email = str(payload.get("email") or "").strip()
    id_token = str(payload.get("idToken") or "").strip()
    refresh_token = str(payload.get("refreshToken") or "").strip()
    expires_raw = payload.get("expiresIn")
    expires_in = int(expires_raw) if str(expires_raw).strip().isdigit() else 3600

    if not user_id or not email:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Firebase did not return a valid user.",
        )

    session = None
    if id_token and refresh_token:
        session = AuthSession(
            access_token=id_token,
            refresh_token=refresh_token,
            expires_in=expires_in,
            token_type="bearer",
        )

    return AuthResult(
        user=AuthUser(id=user_id, email=email),
        session=session,
        needs_email_verification=needs_email_verification,
    )


def _send_email_verification(id_token: str) -> bool:
    if not id_token:
        return False

    try:
        _firebase_request(
            "accounts:sendOobCode",
            {
                "requestType": "VERIFY_EMAIL",
                "idToken": id_token,
            },
        )
    except HTTPException:
        return False

    return True


def sign_up_with_email(payload: EmailAuthRequest) -> AuthResult:
    response_payload = _firebase_request(
        "accounts:signUp",
        {
            "email": payload.email,
            "password": payload.password,
            "returnSecureToken": True,
        },
    )
    needs_email_verification = _send_email_verification(
        str(response_payload.get("idToken") or "")
    )
    return _build_auth_result(
        response_payload,
        needs_email_verification=needs_email_verification,
    )


def sign_in_with_email(payload: EmailAuthRequest) -> AuthResult:
    response_payload = _firebase_request(
        "accounts:signInWithPassword",
        {
            "email": payload.email,
            "password": payload.password,
            "returnSecureToken": True,
        },
    )
    return _build_auth_result(
        response_payload,
        needs_email_verification=False,
    )


def revoke_user_sessions(uid: str) -> None:
    """Revoke all active refresh tokens for a user, immediately invalidating sessions."""
    try:
        from firebase_admin import auth as admin_auth
        admin_auth.revoke_refresh_tokens(uid)
    except Exception as exc:
        pass


def change_user_password(uid: str, new_password: str) -> None:
    """Update user password via Firebase Admin SDK and immediately revoke all prior sessions."""
    from firebase_admin import auth as admin_auth
    admin_auth.update_user(uid, password=new_password)
    admin_auth.revoke_refresh_tokens(uid)


def request_password_reset(email: str) -> None:
    """Request password reset link without leaking whether the account exists."""
    clean_email = email.strip().lower()
    try:
        _firebase_request(
            "accounts:sendOobCode",
            {
                "requestType": "PASSWORD_RESET",
                "email": clean_email,
            },
        )
    except Exception:
        # Absorb errors to prevent user enumeration
        pass


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
    current_user = verify_firebase_token(access_token)
    return CurrentUser(
        id=current_user.uid,
        email=current_user.email or "",
        access_token=access_token,
    )
