"""Unified Authentication Adapter for ZipRIGHT.

Supports both Firebase Authentication ID tokens and Appwrite JWT/session tokens
transparently based on AUTH_PROVIDER configuration.
"""

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from typing import Optional

from fastapi import HTTPException, status
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class AuthenticatedUser(BaseModel):
    uid: str
    email: Optional[str] = None
    phone: Optional[str] = None
    email_verified: bool = False
    provider: str = "firebase"


class AuthAdapter(ABC):
    @abstractmethod
    def verify_token(self, token: str) -> AuthenticatedUser:
        """Verify an authentication token and return an AuthenticatedUser."""

    @abstractmethod
    def get_user(self, uid: str) -> Optional[dict]:
        """Fetch user profile metadata by UID."""


class FirebaseAuthAdapter(AuthAdapter):
    def verify_token(self, token: str) -> AuthenticatedUser:
        from firebase_admin import auth
        try:
            decoded = auth.verify_id_token(token, clock_skew_seconds=10)
            return AuthenticatedUser(
                uid=decoded["uid"],
                email=decoded.get("email"),
                phone=decoded.get("phone_number"),
                email_verified=bool(decoded.get("email_verified", False)),
                provider="firebase",
            )
        except Exception as exc:
            logger.debug("Firebase auth verification failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired Firebase authentication credentials.",
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc

    def get_user(self, uid: str) -> Optional[dict]:
        from firebase_admin import auth
        try:
            user_record = auth.get_user(uid)
            return {
                "uid": user_record.uid,
                "email": user_record.email,
                "phone": user_record.phone_number,
                "email_verified": user_record.email_verified,
                "disabled": user_record.disabled,
            }
        except Exception:
            return None


class AppwriteAuthAdapter(AuthAdapter):
    def verify_token(self, token: str) -> AuthenticatedUser:
        from appwrite.client import Client
        from appwrite.services.account import Account
        from appwrite_config import appwrite_settings

        from appwrite_config import appwrite_settings, get_effective_appwrite_target

        # Connect to Appwrite using client-scoped JWT
        endpoint, host_hdr = get_effective_appwrite_target()
        client = Client()
        client.set_endpoint(endpoint)
        client.set_project(appwrite_settings.PROJECT_ID)
        if host_hdr:
            client.add_header("Host", host_hdr)
        client.set_jwt(token)
        if appwrite_settings.SELF_SIGNED:
            client.set_self_signed(True)

        try:
            account = Account(client)
            user_data = account.get()
            u_dict = user_data.to_dict() if hasattr(user_data, "to_dict") else (dict(user_data) if isinstance(user_data, dict) else {})
            uid = getattr(user_data, "id", None) or getattr(user_data, "$id", None) or u_dict.get("$id") or u_dict.get("id")
            email = getattr(user_data, "email", None) or u_dict.get("email")
            phone = getattr(user_data, "phone", None) or u_dict.get("phone")
            email_ver = getattr(user_data, "email_verification", None) or u_dict.get("emailVerification", False)
            return AuthenticatedUser(
                uid=str(uid),
                email=email,
                phone=phone,
                email_verified=bool(email_ver),
                provider="appwrite",
            )
        except Exception as exc:
            logger.debug("Appwrite auth verification failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired Appwrite authentication credentials.",
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc

    def get_user(self, uid: str) -> Optional[dict]:
        from appwrite_config import get_appwrite_users
        try:
            users = get_appwrite_users()
            user_data = users.get(user_id=uid)
            u_dict = user_data.to_dict() if hasattr(user_data, "to_dict") else (dict(user_data) if isinstance(user_data, dict) else {})
            user_id = getattr(user_data, "id", None) or getattr(user_data, "$id", None) or u_dict.get("$id") or u_dict.get("id")
            email = getattr(user_data, "email", None) or u_dict.get("email")
            phone = getattr(user_data, "phone", None) or u_dict.get("phone")
            email_ver = getattr(user_data, "email_verification", None) or u_dict.get("emailVerification", False)
            status_val = getattr(user_data, "status", None) if hasattr(user_data, "status") else u_dict.get("status", True)
            return {
                "uid": str(user_id),
                "email": email,
                "phone": phone,
                "email_verified": bool(email_ver),
                "disabled": not bool(status_val),
            }
        except Exception:
            return None


_AUTH_ADAPTER: Optional[AuthAdapter] = None


def get_auth_adapter() -> AuthAdapter:
    global _AUTH_ADAPTER
    if _AUTH_ADAPTER is None:
        provider = os.getenv("AUTH_PROVIDER", "firebase").strip().lower()
        if provider == "appwrite":
            _AUTH_ADAPTER = AppwriteAuthAdapter()
        else:
            _AUTH_ADAPTER = FirebaseAuthAdapter()
    return _AUTH_ADAPTER
