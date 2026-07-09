"""Data access for seller_products/{id} documents (repository pattern).

Injectable Firestore client, mirroring SellerRepository. M2 needs create +
read-back; M3 extends this with list / update / delete / image management.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)

PRODUCTS_COLLECTION = "seller_products"


def _normalize_record(record: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in record.items():
        isoformat = getattr(value, "isoformat", None)
        normalized[key] = isoformat() if callable(isoformat) else value
    return normalized


class SellerProductRepository:
    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    @property
    def client(self) -> Any:
        if self._client is None:
            from firebase_config import get_firestore_client

            self._client = get_firestore_client()
        return self._client

    def _collection(self):
        return self.client.collection(PRODUCTS_COLLECTION)

    def create_product(self, seller_uid: str, data: dict[str, Any]) -> dict[str, Any]:
        from firebase_admin import firestore as firebase_firestore

        seller_uid = seller_uid.strip()
        if not seller_uid:
            raise ValueError("seller_uid must be a non-empty string.")

        product_id = uuid.uuid4().hex
        record = {
            **data,
            "seller_uid": seller_uid,
            "created_at": firebase_firestore.SERVER_TIMESTAMP,
            "updated_at": firebase_firestore.SERVER_TIMESTAMP,
        }
        self._collection().document(product_id).create(record)
        created = self.get_product(product_id)
        if created is None:  # pragma: no cover - read-after-write guard
            raise RuntimeError("Product write could not be read back.")
        return created

    def get_product(self, product_id: str) -> dict[str, Any] | None:
        if not product_id or not product_id.strip():
            return None
        snapshot = self._collection().document(product_id.strip()).get()
        if not getattr(snapshot, "exists", False):
            return None
        record = snapshot.to_dict() or {}
        record["id"] = product_id.strip()
        return _normalize_record(record)

    def list_products(
        self,
        seller_uid: str,
        query: str | None = None,
        category: str | None = None,
        brand: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        snapshots = self._collection().where("seller_uid", "==", seller_uid.strip()).get()
        records = []
        for snap in snapshots:
            rec = snap.to_dict() or {}
            rec["id"] = snap.id
            records.append(_normalize_record(rec))
        
        # Filter by status
        if status:
            if status == "all":
                pass
            else:
                records = [r for r in records if r.get("status") == status]
        else:
            # Exclude archived products by default
            records = [r for r in records if r.get("status") != "archived"]

        # Filter by category
        if category:
            cat_lower = category.strip().lower()
            records = [r for r in records if r.get("category", "").strip().lower() == cat_lower]

        # Filter by brand
        if brand:
            brand_lower = brand.strip().lower()
            records = [r for r in records if r.get("brand", "").strip().lower() == brand_lower]

        # Full text search query
        if query:
            q_lower = query.strip().lower()
            filtered = []
            for r in records:
                title_match = q_lower in r.get("title", "").lower()
                cat_match = q_lower in r.get("category", "").lower()
                brand_match = q_lower in r.get("brand", "").lower()
                tags_match = any(q_lower in t.lower() for t in r.get("tags", []))
                if title_match or cat_match or brand_match or tags_match:
                    filtered.append(r)
            records = filtered

        # Default sorting: updated_at descending
        def sort_key(rec):
            val = rec.get("updated_at")
            return (val is not None, val)
        records.sort(key=sort_key, reverse=True)

        return records

    def update_product(self, product_id: str, seller_uid: str, data: dict[str, Any]) -> dict[str, Any] | None:
        from firebase_admin import firestore as firebase_firestore

        product_id = product_id.strip()
        seller_uid = seller_uid.strip()
        
        product = self.get_product(product_id)
        if not product or product.get("seller_uid") != seller_uid:
            return None

        # Concurrency check
        expected_updated_at = data.pop("expected_updated_at", None)
        if expected_updated_at:
            db_val = product.get("updated_at")
            if db_val != expected_updated_at:
                raise ValueError("concurrency_conflict")

        safe_changes = {
            key: value
            for key, value in data.items()
            if key not in {"id", "seller_uid", "created_at"}
        }
        safe_changes["updated_at"] = firebase_firestore.SERVER_TIMESTAMP
        safe_changes["updated_by"] = seller_uid

        self._collection().document(product_id).set(safe_changes, merge=True)
        return self.get_product(product_id)

    def delete_product(self, product_id: str, seller_uid: str) -> bool:
        product_id = product_id.strip()
        seller_uid = seller_uid.strip()

        product = self.get_product(product_id)
        if not product or product.get("seller_uid") != seller_uid:
            return False

        self._collection().document(product_id).delete()
        return True

    def find_by_external_id(self, seller_uid: str, external_id: str) -> dict[str, Any] | None:
        """Locate a product previously synced from an external platform, scoped
        to the owning seller. Returns None when there is no match."""
        external_id = (external_id or "").strip()
        seller_uid = (seller_uid or "").strip()
        if not external_id or not seller_uid:
            return None
        snaps = (
            self._collection()
            .where("seller_uid", "==", seller_uid)
            .where("external_id", "==", external_id)
            .get()
        )
        for snap in snaps:
            record = snap.to_dict() or {}
            record["id"] = snap.id
            return _normalize_record(record)
        return None

    def upsert_product(self, seller_uid: str, data: dict[str, Any]) -> dict[str, Any]:
        """Create a product, or update the existing one sharing the same
        external_id for this seller — so re-syncing a store updates in place
        instead of duplicating the catalogue. Falls back to create when no
        external_id is supplied (e.g. a source without stable ids)."""
        external_id = str(data.get("external_id") or "").strip()
        if external_id:
            existing = self.find_by_external_id(seller_uid, external_id)
            if existing:
                updated = self.update_product(existing["id"], seller_uid, dict(data))
                if updated is not None:
                    return updated
        return self.create_product(seller_uid, data)


_REPOSITORY: SellerProductRepository | None = None


def get_product_repository() -> SellerProductRepository:
    """FastAPI dependency; override in tests via app.dependency_overrides."""
    global _REPOSITORY
    if _REPOSITORY is None:
        _REPOSITORY = SellerProductRepository()
    return _REPOSITORY
