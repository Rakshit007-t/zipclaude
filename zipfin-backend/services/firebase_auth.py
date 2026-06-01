import os
from dataclasses import dataclass

from fastapi import HTTPException, Request, status
from firebase_admin import auth, credentials, initialize_app

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ACCOUNT_PATH = os.path.join(BASE_DIR, "serviceAccountKey.json")
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = SERVICE_ACCOUNT_PATH

if not os.path.exists(SERVICE_ACCOUNT_PATH):
    raise Exception("Firebase service account file missing")

cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)

try:
    initialize_app(cred)
except ValueError:
    pass


@dataclass
class AuthenticatedUser:
    uid: str
    email: str | None


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
        print("AUTH ERROR:", str(exc))
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
    return AuthenticatedUser(uid=uid, email=str(email) if isinstance(email, str) else None)


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
    """Like get_current_user but returns a demo user when no auth header is present.

    This allows demo/phone-login sessions that failed anonymous Firebase auth
    to still use features like Smart Fit Scan.
    """
    authorization = request.headers.get("Authorization", "").strip()
    if not authorization:
        demo_user = AuthenticatedUser(uid="demo-anonymous", email=None)
        request.state.current_user = demo_user
        return demo_user

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        demo_user = AuthenticatedUser(uid="demo-anonymous", email=None)
        request.state.current_user = demo_user
        return demo_user

    current_user = verify_firebase_token(token)
    request.state.current_user = current_user
    return current_user

