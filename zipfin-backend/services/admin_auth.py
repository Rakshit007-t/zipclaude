"""Admin authorization, reusing the existing admins/{uid} Firestore precedent.

Mirrors firestore.rules' admin check server-side: a caller is an admin iff an
admins/{uid} document exists (and is not explicitly disabled). Injectable
client so tests never touch Firestore.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import Depends, HTTPException, status

from services.firebase_auth import AuthenticatedUser, get_current_user

logger = logging.getLogger(__name__)

ADMINS_COLLECTION = "admins"


class AdminGate:
    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    @property
    def client(self) -> Any:
        if self._client is None:
            from firebase_config import get_firestore_client

            self._client = get_firestore_client()
        return self._client

    def is_admin(self, uid: str) -> bool:
        if not uid or not uid.strip():
            return False
        try:
            snapshot = self.client.collection(ADMINS_COLLECTION).document(uid.strip()).get()
        except Exception as exc:  # storage/network issue — fail closed
            logger.warning("Admin check failed for uid=%s: %s", uid, exc)
            return False
        if not getattr(snapshot, "exists", False):
            return False
        record = snapshot.to_dict() or {}
        return str(record.get("status", "active")) == "active"


_GATE: AdminGate | None = None


def get_admin_gate() -> AdminGate:
    """FastAPI dependency; override in tests via app.dependency_overrides."""
    global _GATE
    if _GATE is None:
        _GATE = AdminGate()
    return _GATE


async def require_admin(
    current_user: AuthenticatedUser = Depends(get_current_user),
    gate: AdminGate = Depends(get_admin_gate),
) -> AuthenticatedUser:
    if not await asyncio.to_thread(gate.is_admin, current_user.uid):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "Administrator access required.",
                "details": {"code": "not_an_admin"},
            },
        )
    return current_user
