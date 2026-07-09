"""Data access for the seller domain (repository pattern).

Single owner of the `sellers/{uid}` Firestore documents. The Firestore
client is injectable so tests run against an in-memory fake, and routes
depend on `get_seller_repository()` so the whole layer can be overridden
via FastAPI dependency_overrides.

All methods are synchronous (the Admin SDK is blocking); async callers wrap
them in asyncio.to_thread, matching the existing routes' convention.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

SELLERS_COLLECTION = "sellers"


def _normalize_record(record: dict[str, Any]) -> dict[str, Any]:
    """Firestore timestamps -> ISO strings so records are JSON/Pydantic safe."""
    normalized: dict[str, Any] = {}
    for key, value in record.items():
        isoformat = getattr(value, "isoformat", None)
        normalized[key] = isoformat() if callable(isoformat) else value
    return normalized


class SellerRepository:
    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    @property
    def client(self) -> Any:
        if self._client is None:
            from firebase_config import get_firestore_client

            self._client = get_firestore_client()
        return self._client

    def _doc(self, uid: str):
        return self.client.collection(SELLERS_COLLECTION).document(uid)

    def get_seller(self, uid: str) -> dict[str, Any] | None:
        """The sellers/{uid} record, or None when the user is not a seller."""
        if not uid or not uid.strip():
            return None
        snapshot = self._doc(uid.strip()).get()
        if not getattr(snapshot, "exists", False):
            return None
        record = snapshot.to_dict() or {}
        record["uid"] = uid.strip()
        return _normalize_record(record)

    def create_seller(self, uid: str, data: dict[str, Any]) -> dict[str, Any]:
        """Create sellers/{uid} in status "pending". Fails if it already exists.

        Activation is a separate, admin-only transition — sellers are never
        auto-activated.
        """
        from firebase_admin import firestore as firebase_firestore
        from google.api_core.exceptions import AlreadyExists

        uid = uid.strip()
        if not uid:
            raise ValueError("uid must be a non-empty string.")

        record = {
            **data,
            "status": "pending",
            "created_at": firebase_firestore.SERVER_TIMESTAMP,
            "updated_at": firebase_firestore.SERVER_TIMESTAMP,
        }
        try:
            # Atomic create: fails when the doc exists, so two concurrent
            # onboard calls can never overwrite an existing profile/status.
            self._doc(uid).create(record)
        except AlreadyExists as exc:
            raise SellerAlreadyExistsError(
                f"Seller profile already exists for uid '{uid}'."
            ) from exc
        created = self.get_seller(uid)
        if created is None:  # pragma: no cover - read-after-write guard
            raise RuntimeError(f"Seller profile write for uid '{uid}' could not be read back.")
        return created

    def update_seller(self, uid: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        """Merge changes into sellers/{uid}; None when the seller is missing.

        `status`, `uid` and `created_at` are managed by dedicated flows and
        silently dropped here so a profile edit can never self-activate.
        """
        from firebase_admin import firestore as firebase_firestore

        uid = uid.strip()
        if self.get_seller(uid) is None:
            return None

        safe_changes = {
            key: value
            for key, value in changes.items()
            if key not in {"status", "uid", "created_at"}
        }
        safe_changes["updated_at"] = firebase_firestore.SERVER_TIMESTAMP
        self._doc(uid).set(safe_changes, merge=True)
        return self.get_seller(uid)

    def set_seller_status(self, uid: str, status: str) -> dict[str, Any] | None:
        """Admin-only lifecycle transition (pending -> active/rejected/...)."""
        from firebase_admin import firestore as firebase_firestore

        from models.seller_schema import SELLER_STATUSES

        if status not in SELLER_STATUSES:
            raise ValueError(f"Invalid seller status '{status}'.")
        uid = uid.strip()
        if self.get_seller(uid) is None:
            return None
        self._doc(uid).set(
            {"status": status, "updated_at": firebase_firestore.SERVER_TIMESTAMP},
            merge=True,
        )
        return self.get_seller(uid)

    def list_sellers(self, status: str | None = None) -> list[dict[str, Any]]:
        """Admin-only query of all sellers, optionally filtered by status."""
        query = self.client.collection(SELLERS_COLLECTION)
        if status:
            query = query.where("status", "==", status)
        snapshots = query.get()
        records = []
        for snap in snapshots:
            record = snap.to_dict() or {}
            record["uid"] = snap.id
            records.append(_normalize_record(record))
        return records



class SellerAlreadyExistsError(RuntimeError):
    """Onboarding was attempted for a uid that already has a seller profile."""


_DEFAULT_REPOSITORY: SellerRepository | None = None


def get_seller_repository() -> SellerRepository:
    """FastAPI dependency; override in tests via app.dependency_overrides."""
    global _DEFAULT_REPOSITORY
    if _DEFAULT_REPOSITORY is None:
        _DEFAULT_REPOSITORY = SellerRepository()
    return _DEFAULT_REPOSITORY
