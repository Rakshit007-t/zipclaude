"""Unified Database Adapter for ZipRIGHT.

Enables transparent switching between Cloud Firestore and Appwrite Databases
via DATABASE_PROVIDER env configuration ('firebase' or 'appwrite').
"""

from __future__ import annotations

import json
import logging
import os
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)


class DatabaseAdapter(ABC):
    """Abstract interface for database document persistence and querying."""

    @abstractmethod
    def get_document(self, collection: str, document_id: str) -> Optional[dict[str, Any]]:
        """Retrieve a document by ID."""

    @abstractmethod
    def set_document(
        self,
        collection: str,
        document_id: str,
        data: dict[str, Any],
        merge: bool = False,
        permissions: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """Create or replace/merge a document."""

    @abstractmethod
    def update_document(
        self,
        collection: str,
        document_id: str,
        data: dict[str, Any],
        permissions: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """Update specific fields in an existing document."""

    @abstractmethod
    def delete_document(self, collection: str, document_id: str) -> bool:
        """Delete a document."""

    @abstractmethod
    def query_collection(
        self,
        collection: str,
        filters: Optional[list[tuple[str, str, Any]]] = None,
        order_by: Optional[str] = None,
        order_desc: bool = False,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Query documents matching filter tuples of (field, op, value)."""


class FirestoreDatabaseAdapter(DatabaseAdapter):
    """Firestore implementation."""

    def __init__(self) -> None:
        from firebase_config import get_firestore_client
        self.db = get_firestore_client()

    def _doc_ref(self, collection: str, document_id: str):
        # Support hierarchical path notation if passed
        if "/" in collection:
            parts = collection.split("/")
            ref = self.db.document(f"{collection}/{document_id}")
            return ref
        return self.db.collection(collection).document(document_id)

    def get_document(self, collection: str, document_id: str) -> Optional[dict[str, Any]]:
        if not document_id or not str(document_id).strip():
            return None
        doc = self._doc_ref(collection, document_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        data["id"] = doc.id
        return data

    def set_document(
        self,
        collection: str,
        document_id: str,
        data: dict[str, Any],
        merge: bool = False,
        permissions: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        if not document_id or not str(document_id).strip():
            raise ValueError("document_id cannot be empty")
        if not isinstance(data, dict):
            raise ValueError(f"Document data must be a dictionary, got {type(data).__name__}")
        if not data:
            raise ValueError("Document data cannot be empty")
        clean = {k: v for k, v in data.items() if k not in ("id", "$permissions", "permissions")}
        if not clean:
            raise ValueError("Document data cannot be empty or contain only metadata fields")
        self._doc_ref(collection, document_id).set(clean, merge=merge)
        res = dict(clean)
        res["id"] = document_id
        return res

    def update_document(
        self,
        collection: str,
        document_id: str,
        data: dict[str, Any],
        permissions: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        if not document_id or not str(document_id).strip():
            raise ValueError("document_id cannot be empty")
        if not isinstance(data, dict):
            raise ValueError(f"Document data must be a dictionary, got {type(data).__name__}")
        if not data:
            raise ValueError("Document data cannot be empty for update")
        clean = {k: v for k, v in data.items() if k not in ("id", "$permissions", "permissions")}
        if not clean:
            raise ValueError("Document data cannot be empty or contain only metadata fields")
        self._doc_ref(collection, document_id).update(clean)
        return self.get_document(collection, document_id) or {"id": document_id, **clean}

    def delete_document(self, collection: str, document_id: str) -> bool:
        if not document_id or not str(document_id).strip():
            return False
        self._doc_ref(collection, document_id).delete()
        return True

    def query_collection(
        self,
        collection: str,
        filters: Optional[list[tuple[str, str, Any]]] = None,
        order_by: Optional[str] = None,
        order_desc: bool = False,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        from firebase_admin import firestore
        query = self.db.collection(collection)

        if filters:
            for field, op, val in filters:
                query = query.where(filter=firestore.FieldFilter(field, op, val))

        if order_by:
            direction = firestore.Query.DESCENDING if order_desc else firestore.Query.ASCENDING
            query = query.order_by(order_by, direction=direction)

        if limit:
            query = query.limit(limit)

        results = []
        for snap in query.get():
            d = snap.to_dict() or {}
            d["id"] = snap.id
            results.append(d)
        return results


class AppwriteDatabaseAdapter(DatabaseAdapter):
    """Appwrite Databases implementation with schema normalization for subcollections."""

    # Map Firestore subcollection patterns to flat Appwrite collection names
    COLLECTION_MAPPINGS = {
        "users_following": "user_following",
        "users_followers": "user_followers",
        "users_blocked": "user_blocked",
        "users_muted": "user_blocked",
        "users_friends": "user_friends",
        "users_friend_inbox": "user_friend_inbox",
        "users_lookLikes": "user_likes",
        "users_closet": "user_closet",
        "posts_comments": "look_comments",
        "posts_likes": "user_likes",
        "looks_comments": "look_comments",
        "conversations_messages": "chat_messages",
        "_health_probe": "health_probe",
    }

    SYNONYM_MAP: dict[str, list[str]] = {
        "customer_uid": ["user_id", "userId"],
        "user_id": ["userId", "customer_uid"],
        "userId": ["user_id", "customer_uid"],
        "uid": ["owner_uid", "ownerUid", "user_id", "userId"],
        "ownerUid": ["owner_uid", "uid"],
        "owner_uid": ["ownerUid", "uid"],
        "store_name": ["storeName"],
        "storeName": ["store_name"],
        "text": ["comment"],
        "comment": ["text"],
        "seller_uid": ["sellerUid"],
        "sellerUid": ["seller_uid"],
        "order_id": ["orderId"],
        "orderId": ["order_id"],
        "phone": ["phoneNumber"],
        "phoneNumber": ["phone"],
        "target_id": ["targetUserId"],
        "targetUserId": ["target_id"],
        "follower_id": ["followerId"],
        "followerId": ["follower_id"],
        "blocked_user_id": ["blockedUserId"],
        "blockedUserId": ["blocked_user_id"],
        "look_id": ["lookId", "post_id"],
        "lookId": ["look_id", "post_id"],
        "post_id": ["lookId", "look_id"],
        "postId": ["post_id", "lookId"],
        "recipient_id": ["user_id", "userId"],
        "is_read": ["read"],
        "read": ["is_read"],
    }

    def __init__(self) -> None:
        from appwrite_config import appwrite_settings, get_appwrite_databases
        self.databases = get_appwrite_databases()
        self.database_id = appwrite_settings.DATABASE_ID
        self._schema_cache: dict[str, dict[str, str]] = {}

    def _resolve_collection(self, collection: str) -> str:
        # Standardize collection names (hyphens, slashes) to valid Appwrite collection IDs
        sanitized = collection.replace("/", "_").replace("-", "_")
        return self.COLLECTION_MAPPINGS.get(sanitized, sanitized)

    def _get_collection_schema(self, col: str) -> dict[str, str]:
        """Fetch and cache collection attribute specifications."""
        if col not in self._schema_cache:
            try:
                resp = self.databases.list_attributes(self.database_id, col)
                attrs = getattr(resp, "attributes", None) or (resp.get("attributes", []) if isinstance(resp, dict) else [])
                schema_map = {}
                for a in attrs:
                    k = a.get("key") if isinstance(a, dict) else getattr(a, "key", "")
                    t = a.get("type", "string") if isinstance(a, dict) else getattr(a, "type", "string")
                    if k:
                        schema_map[k] = t
                self._schema_cache[col] = schema_map
            except Exception as exc:
                logger.warning("Could not cache attributes for %s: %s", col, exc)
                self._schema_cache[col] = {}
        return self._schema_cache[col]

    def _clean_for_appwrite(self, data: dict[str, Any], collection: str | None = None) -> dict[str, Any]:
        """Convert Firestore specific types (timestamps, dicts) to Appwrite types matching collection schema."""
        clean = {}
        col_id = self._resolve_collection(collection) if collection else None
        schema = self._get_collection_schema(col_id) if col_id else {}

        for raw_k, v in data.items():
            if raw_k in ("id", "$id", "$createdAt", "$updatedAt", "$permissions", "$databaseId", "$collectionId", "permissions"):
                continue

            k = raw_k
            if schema:
                if k not in schema:
                    syns = self.SYNONYM_MAP.get(k, [])
                    found = False
                    for syn in syns:
                        if syn in schema and syn not in data:
                            k = syn
                            found = True
                            break
                    if not found:
                        # Drop undeclared attributes to prevent Appwrite schema validation errors
                        continue

            attr_type = schema.get(k) if schema else None

            if attr_type == "string":
                if isinstance(v, (dict, list)):
                    clean[k] = json.dumps(v)
                elif isinstance(v, datetime) or hasattr(v, "isoformat"):
                    clean[k] = v.isoformat()
                elif v is None:
                    clean[k] = None
                else:
                    clean[k] = str(v)
            elif attr_type in ("integer", "int"):
                try:
                    clean[k] = int(round(float(v))) if v is not None else 0
                except (ValueError, TypeError):
                    clean[k] = 0
            elif attr_type in ("float", "double"):
                try:
                    clean[k] = float(v) if v is not None else 0.0
                except (ValueError, TypeError):
                    clean[k] = 0.0
            elif attr_type == "boolean":
                clean[k] = bool(v) if v is not None else False
            else:
                # Fallback generic handling
                if isinstance(v, datetime) or hasattr(v, "isoformat"):
                    clean[k] = v.isoformat()
                elif isinstance(v, (dict, list)):
                    clean[k] = json.dumps(v)
                elif isinstance(v, (str, int, float, bool)) or v is None:
                    clean[k] = v
                else:
                    clean[k] = str(v)

        return clean

    def _parse_json_fields(self, data: dict[str, Any]) -> dict[str, Any]:
        """Automatically deserialize JSON strings for known complex fields."""
        json_fields = {"usage", "measurements", "participants", "scan_data", "credentials", "images", "tags", "items", "sizes", "notes", "shipping_address", "seller_uids", "profile", "payload"}
        for k in json_fields:
            if k in data and isinstance(data[k], str):
                val = data[k].strip()
                if (val.startswith("{") and val.endswith("}")) or (val.startswith("[") and val.endswith("]")):
                    try:
                        data[k] = json.loads(val)
                    except Exception:
                        pass
        return data

    def _document_to_dict(self, doc: Any, fallback_id: str = "") -> dict[str, Any]:
        if isinstance(doc, dict):
            d = dict(doc)
            d["id"] = d.get("$id", fallback_id)
            d = self._parse_json_fields(d)
        else:
            data = {}
            if hasattr(doc, "data") and isinstance(doc.data, dict):
                data.update(doc.data)
            elif hasattr(doc, "to_dict"):
                data.update(doc.to_dict())

            doc_id = getattr(doc, "id", None) or getattr(doc, "$id", None) or fallback_id
            data["id"] = doc_id
            d = self._parse_json_fields(data)

        # Bidirectional synonym aliasing for seamless schema/caller compatibility
        for canonical, synonyms in self.SYNONYM_MAP.items():
            if canonical in d and d[canonical] is not None:
                for syn in synonyms:
                    if syn not in d:
                        d[syn] = d[canonical]
            else:
                for syn in synonyms:
                    if syn in d and d[syn] is not None and canonical not in d:
                        d[canonical] = d[syn]
                        break

        # Orders amount <-> paise bridge
        if "amount" in d and d["amount"] is not None and "total_paise" not in d:
            try:
                d["total_paise"] = int(round(float(d["amount"]) * 100))
                d["subtotal_paise"] = d.get("subtotal_paise", d["total_paise"])
            except (ValueError, TypeError):
                pass
        if "seller_uid" in d and d["seller_uid"] and "seller_uids" not in d:
            d["seller_uids"] = [d["seller_uid"]]

        # Relationship edges uid bridge (followers / following)
        col_id = d.get("$collectionId", "")
        if col_id == "user_followers" or "followerId" in d or "follower_id" in d:
            d["uid"] = d.get("followerId") or d.get("follower_id") or d.get("uid")
        elif col_id == "user_following" or "targetUserId" in d or "target_id" in d:
            d["uid"] = d.get("targetUserId") or d.get("target_id") or d.get("uid")

        return d

    def _parse_subcollection_path(self, collection: str, document_id: str = "") -> tuple[str, str, dict[str, Any]]:
        """Parses Firestore hierarchical subcollection paths like 'users/{uid}/following' or 'posts/{post_id}/comments'."""
        parts = [p for p in collection.strip("/").split("/") if p]
        if len(parts) >= 3:
            parent_col, parent_id, sub_col = parts[0], parts[1], parts[-1]
            sub_key = f"{parent_col}_{sub_col}"
            target_col = self.COLLECTION_MAPPINGS.get(sub_key, f"{parent_col}_{sub_col}")

            default_fields: dict[str, Any] = {}
            eff_doc_id = document_id

            if parent_col == "users":
                default_fields["user_id"] = parent_id
                default_fields["userId"] = parent_id
                if sub_col == "following":
                    default_fields["target_id"] = document_id
                    default_fields["targetUserId"] = document_id
                elif sub_col == "followers":
                    default_fields["follower_id"] = document_id
                    default_fields["followerId"] = document_id
                eff_doc_id = f"{parent_id}_{document_id}" if document_id else ""
            elif parent_col == "posts" and sub_col == "comments":
                default_fields["post_id"] = parent_id
                default_fields["lookId"] = parent_id
            elif parent_col == "looks" and sub_col == "comments":
                default_fields["post_id"] = parent_id
                default_fields["lookId"] = parent_id
            elif parent_col == "conversations" and sub_col == "messages":
                default_fields["conversationId"] = parent_id

            return target_col, eff_doc_id, default_fields

        sanitized = collection.replace("/", "_").replace("-", "_")
        target_col = self.COLLECTION_MAPPINGS.get(sanitized, sanitized)
        return target_col, document_id, {}

    def _resolve_permissions(
        self,
        collection: str,
        document_id: str,
        data: dict[str, Any],
        explicit_permissions: Optional[list[str]] = None,
    ) -> Optional[list[str]]:
        """Determine document-level permissions preserving ownership and explicit rules."""
        if explicit_permissions is not None:
            return [str(p) for p in explicit_permissions]

        raw_perms = data.get("$permissions") or data.get("permissions")
        if isinstance(raw_perms, list) and raw_perms:
            return [str(p) for p in raw_perms]

        owner_id = (
            data.get("user_id")
            or data.get("userId")
            or data.get("customer_uid")
            or data.get("owner_uid")
            or data.get("ownerUid")
            or data.get("uid")
        )
        if not owner_id and collection in ("users", "publicProfiles"):
            owner_id = document_id

        if owner_id and isinstance(owner_id, str) and str(owner_id).strip():
            from appwrite.permission import Permission
            from appwrite.role import Role

            uid_clean = str(owner_id).strip()
            perms = [
                Permission.read(Role.user(uid_clean)),
                Permission.update(Role.user(uid_clean)),
                Permission.delete(Role.user(uid_clean)),
            ]
            if collection in ("looks", "publicProfiles", "seller_products", "look_comments"):
                perms.append(Permission.read(Role.any()))
            return perms

        return None

    def get_document(self, collection: str, document_id: str) -> Optional[dict[str, Any]]:
        from appwrite.exception import AppwriteException
        if not document_id or not str(document_id).strip():
            return None
        col, eff_id, _ = self._parse_subcollection_path(collection, document_id)
        try:
            doc = self.databases.get_document(
                database_id=self.database_id,
                collection_id=col,
                document_id=eff_id,
            )
            return self._document_to_dict(doc, document_id)
        except AppwriteException as exc:
            if exc.code == 404 or "not found" in str(exc).lower():
                if eff_id != document_id:
                    try:
                        doc = self.databases.get_document(
                            database_id=self.database_id,
                            collection_id=col,
                            document_id=document_id,
                        )
                        return self._document_to_dict(doc, document_id)
                    except AppwriteException:
                        pass
                return None
            logger.warning("Appwrite get_document error on %s/%s: %s", col, eff_id, exc)
            return None

    def set_document(
        self,
        collection: str,
        document_id: str,
        data: dict[str, Any],
        merge: bool = False,
        permissions: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        from appwrite.exception import AppwriteException

        if not document_id or not str(document_id).strip():
            raise ValueError("document_id cannot be empty")
        if not isinstance(data, dict):
            raise ValueError(f"Document data must be a dictionary, got {type(data).__name__}")
        if not data:
            raise ValueError("Document data cannot be empty")

        user_keys = [k for k in data.keys() if k not in ("id", "$id", "$createdAt", "$updatedAt", "$permissions", "$databaseId", "$collectionId", "permissions")]
        if not user_keys:
            raise ValueError(
                f"Document data for collection '{collection}' has no valid schema fields to write."
            )

        col, eff_id, default_fields = self._parse_subcollection_path(collection, document_id)
        if col == "sellers" and "ownerUid" not in default_fields and "ownerUid" not in data and "owner_uid" not in data:
            default_fields["ownerUid"] = eff_id
        elif col == "orders":
            if "order_id" not in default_fields and "order_id" not in data and "orderId" not in data:
                default_fields["order_id"] = eff_id
            if "seller_uid" not in data and "seller_uids" in data and isinstance(data["seller_uids"], list) and data["seller_uids"]:
                default_fields["seller_uid"] = data["seller_uids"][0]
            if "amount" not in data:
                if "total_paise" in data and data["total_paise"] is not None:
                    default_fields["amount"] = round(float(data["total_paise"]) / 100.0, 2)
                elif "amount_rupees" in data and data["amount_rupees"] is not None:
                    default_fields["amount"] = float(data["amount_rupees"])
                elif "amount_paise" in data and data["amount_paise"] is not None:
                    default_fields["amount"] = round(float(data["amount_paise"]) / 100.0, 2)

        merged_data = {**default_fields, **data}
        clean = self._clean_for_appwrite(merged_data, col)

        doc_permissions = self._resolve_permissions(col, eff_id, merged_data, permissions)

        try:
            existing = self.get_document(collection, document_id)
            if existing is not None:
                if not clean and merge:
                    return existing
                payload = {**self._clean_for_appwrite(existing, col), **clean} if merge else clean
                doc = self.databases.update_document(
                    database_id=self.database_id,
                    collection_id=col,
                    document_id=eff_id,
                    data=payload,
                    permissions=doc_permissions,
                )
            else:
                if not clean:
                    raise ValueError(
                        f"Document data for collection '{collection}' has no valid schema fields to write."
                    )
                try:
                    doc = self.databases.create_document(
                        database_id=self.database_id,
                        collection_id=col,
                        document_id=eff_id,
                        data=clean,
                        permissions=doc_permissions,
                    )
                except AppwriteException as create_exc:
                    if create_exc.code == 409 or "already exists" in str(create_exc).lower():
                        existing_fallback = self.get_document(collection, document_id)
                        payload = (
                            {**self._clean_for_appwrite(existing_fallback or {}, col), **clean}
                            if merge
                            else clean
                        )
                        doc = self.databases.update_document(
                            database_id=self.database_id,
                            collection_id=col,
                            document_id=eff_id,
                            data=payload,
                            permissions=doc_permissions,
                        )
                    else:
                        raise
            return self._document_to_dict(doc, document_id)
        except AppwriteException as exc:
            logger.error("Appwrite set_document failed on %s/%s: %s", col, eff_id, exc)
            raise RuntimeError(f"Appwrite set_document failed: {exc}") from exc

    def update_document(
        self,
        collection: str,
        document_id: str,
        data: dict[str, Any],
        permissions: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        from appwrite.exception import AppwriteException

        if not document_id or not str(document_id).strip():
            raise ValueError("document_id cannot be empty")
        if not isinstance(data, dict):
            raise ValueError(f"Document data must be a dictionary, got {type(data).__name__}")
        if not data:
            raise ValueError("Document data cannot be empty for update")

        col, eff_id, _ = self._parse_subcollection_path(collection, document_id)
        clean = self._clean_for_appwrite(data, col)

        doc_permissions = self._resolve_permissions(col, eff_id, data, permissions)

        if not clean and doc_permissions is None:
            raise ValueError(
                f"Document update for '{collection}/{document_id}' has no fields or permissions to update."
            )

        try:
            doc = self.databases.update_document(
                database_id=self.database_id,
                collection_id=col,
                document_id=eff_id,
                data=clean if clean else None,
                permissions=doc_permissions,
            )
            return self._document_to_dict(doc, document_id)
        except AppwriteException as exc:
            logger.error("Appwrite update_document failed on %s/%s: %s", col, eff_id, exc)
            raise RuntimeError(f"Appwrite update_document failed: {exc}") from exc

    def delete_document(self, collection: str, document_id: str) -> bool:
        from appwrite.exception import AppwriteException
        if not document_id or not str(document_id).strip():
            return False
        col, eff_id, _ = self._parse_subcollection_path(collection, document_id)
        try:
            self.databases.delete_document(
                database_id=self.database_id,
                collection_id=col,
                document_id=eff_id,
            )
            return True
        except AppwriteException as exc:
            if exc.code == 404 or "not found" in str(exc).lower():
                if eff_id != document_id:
                    try:
                        self.databases.delete_document(
                            database_id=self.database_id,
                            collection_id=col,
                            document_id=document_id,
                        )
                        return True
                    except AppwriteException:
                        pass
                return True
            logger.error("Appwrite delete_document failed on %s/%s: %s", col, eff_id, exc)
            return False

    def query_collection(
        self,
        collection: str,
        filters: Optional[list[tuple[str, str, Any]]] = None,
        order_by: Optional[str] = None,
        order_desc: bool = False,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        from appwrite.exception import AppwriteException
        from appwrite.query import Query

        col, _, default_fields = self._parse_subcollection_path(collection)
        schema = self._get_collection_schema(col)
        queries = []

        # Inject scope filter for subcollections (e.g. user_id or post_id)
        for scope_k in ("user_id", "userId", "post_id", "postId", "lookId", "conversationId"):
            if scope_k in default_fields:
                target_field = scope_k
                if schema and target_field not in schema:
                    syns = self.SYNONYM_MAP.get(target_field, [])
                    for s in syns:
                        if s in schema:
                            target_field = s
                            break
                if not schema or target_field in schema:
                    queries.append(Query.equal(target_field, default_fields[scope_k]))
                    break

        if filters:
            for field, op, val in filters:
                target_field = field
                if schema and target_field not in schema:
                    syns = self.SYNONYM_MAP.get(target_field, [])
                    for s in syns:
                        if s in schema:
                            target_field = s
                            break
                if op in ("==", "="):
                    queries.append(Query.equal(target_field, val))
                elif op == "!=":
                    queries.append(Query.not_equal(target_field, val))
                elif op == ">":
                    queries.append(Query.greater_than(target_field, val))
                elif op == ">=":
                    queries.append(Query.greater_than_equal(target_field, val))
                elif op == "<":
                    queries.append(Query.less_than(target_field, val))
                elif op == "<=":
                    queries.append(Query.less_than_equal(target_field, val))
                elif op == "in":
                    queries.append(Query.contains(target_field, val) if isinstance(val, list) else Query.equal(target_field, val))
                elif op == "array_contains":
                    queries.append(Query.contains(target_field, val))

        if order_by:
            target_order = order_by
            if schema and target_order not in schema:
                syns = self.SYNONYM_MAP.get(target_order, [])
                for s in syns:
                    if s in schema:
                        target_order = s
                        break
            queries.append(Query.order_desc(target_order) if order_desc else Query.order_asc(target_order))

        if limit:
            queries.append(Query.limit(limit))

        try:
            res = self.databases.list_documents(
                database_id=self.database_id,
                collection_id=col,
                queries=queries,
            )
            raw_docs = getattr(res, "documents", []) if not isinstance(res, dict) else res.get("documents", [])
            return [self._document_to_dict(doc) for doc in raw_docs]
        except AppwriteException as exc:
            logger.error("Appwrite query_collection failed on %s: %s", col, exc)
            return []


_DATABASE_ADAPTER: Optional[DatabaseAdapter] = None


def get_database_adapter() -> DatabaseAdapter:
    """Return active DatabaseAdapter based on DATABASE_PROVIDER environment variable."""
    global _DATABASE_ADAPTER
    if _DATABASE_ADAPTER is None:
        provider = os.getenv("DATABASE_PROVIDER", "firebase").strip().lower()
        if provider == "appwrite":
            _DATABASE_ADAPTER = AppwriteDatabaseAdapter()
        else:
            _DATABASE_ADAPTER = FirestoreDatabaseAdapter()
    return _DATABASE_ADAPTER
