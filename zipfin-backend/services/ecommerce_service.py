from __future__ import annotations

import os
import json
import logging
from datetime import datetime, timezone
from cryptography.fernet import Fernet
from firebase_config import get_firestore_client
from models.seller_schema import (
    SellerIntegrationConnectRequest,
    SellerIntegrationResponse,
    SyncHistoryEvent,
)
from services.ecommerce_providers import (
    ShopifyProvider,
    WooCommerceProvider,
    GenericRestProvider,
)
from services.product_repository import SellerProductRepository
from services.url_guard import assert_public_http_url

logger = logging.getLogger(__name__)

# Fernet cipher for seller store credentials (Shopify/Woo access tokens, API
# keys). Initialised lazily so importing this module never requires the key,
# and so tests can vary the environment per-case.
#
# SECURITY: there is NO hardcoded key. Production (ENV=production) MUST supply
# ECOMMERCE_ENCRYPTION_KEY or the service fails closed. Non-production without
# a key uses a process-ephemeral key (credentials do not survive a restart) so
# a real secret can never be silently committed or reused across deployments.
_fernet: Fernet | None = None


def _is_production() -> bool:
    return os.getenv("ENV", "development").strip().lower() == "production"


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is not None:
        return _fernet

    key = os.getenv("ECOMMERCE_ENCRYPTION_KEY", "").strip()
    if not key:
        if _is_production():
            raise RuntimeError(
                "ECOMMERCE_ENCRYPTION_KEY is required in production to encrypt "
                "seller store credentials. Generate one with "
                "`python -c \"from cryptography.fernet import Fernet; "
                "print(Fernet.generate_key().decode())\"` and set it in the "
                "environment."
            )
        key = Fernet.generate_key().decode()
        logger.warning(
            "ECOMMERCE_ENCRYPTION_KEY is not set; using an EPHEMERAL in-memory "
            "key. Store credentials encrypted now will NOT be decryptable after "
            "a restart. Set ECOMMERCE_ENCRYPTION_KEY for any persistent use."
        )

    try:
        _fernet = Fernet(key.encode())
    except Exception as exc:  # malformed key — fail with actionable guidance
        raise RuntimeError(
            "ECOMMERCE_ENCRYPTION_KEY is not a valid Fernet key "
            "(expected 44-character url-safe base64)."
        ) from exc
    return _fernet


def encrypt_credentials(credentials: dict[str, str]) -> str:
    serialized = json.dumps(credentials)
    return _get_fernet().encrypt(serialized.encode()).decode()


def decrypt_credentials(encrypted_str: str) -> dict[str, str]:
    decrypted = _get_fernet().decrypt(encrypted_str.encode()).decode()
    return json.loads(decrypted)


def get_provider(platform: str, store_url: str, credentials: dict[str, str]):
    platform_clean = platform.strip().lower()
    if platform_clean == "shopify":
        return ShopifyProvider(store_url, credentials)
    elif platform_clean == "woocommerce":
        return WooCommerceProvider(store_url, credentials)
    elif platform_clean == "rest":
        return GenericRestProvider(store_url, credentials)
    raise ValueError(f"Unsupported e-commerce integration platform: {platform}")


class EcommerceService:
    def __init__(self, db=None) -> None:
        self.db = db or get_firestore_client()

    def _integrations_col(self):
        return self.db.collection("seller_integrations")

    def _history_col(self):
        return self.db.collection("seller_sync_history")

    def connect_store(self, seller_uid: str, req: SellerIntegrationConnectRequest) -> bool:
        # SSRF guard: never fetch a seller-supplied URL that points at an
        # internal / link-local / private host (e.g. cloud metadata).
        assert_public_http_url(req.store_url)

        # Test connection validity
        provider = get_provider(req.platform, req.store_url, req.credentials)
        if not provider.test_connection():
            raise ValueError("Store connection verification failed. Check credentials and URL.")

        # Save connection configuration
        encrypted_creds = encrypt_credentials(req.credentials)
        now_str = datetime.now(timezone.utc).isoformat()
        
        record = {
            "seller_uid": seller_uid,
            "platform": req.platform,
            "store_url": req.store_url,
            "encrypted_credentials": encrypted_creds,
            "connected_at": now_str,
            "last_sync_at": None,
            "last_sync_status": None,
        }
        self._integrations_col().document(seller_uid).set(record)
        return True

    def disconnect_store(self, seller_uid: str) -> bool:
        doc_ref = self._integrations_col().document(seller_uid)
        if not doc_ref.get().exists:
            return False
        doc_ref.delete()
        return True

    def get_integration_status(self, seller_uid: str) -> SellerIntegrationResponse | None:
        doc = self._integrations_col().document(seller_uid).get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        return SellerIntegrationResponse(
            platform=data["platform"],
            store_url=data["store_url"],
            connected_at=data["connected_at"],
            last_sync_at=data.get("last_sync_at"),
            last_sync_status=data.get("last_sync_status"),
        )

    def get_sync_history(self, seller_uid: str) -> list[SyncHistoryEvent]:
        snaps = self._history_col().where("seller_uid", "==", seller_uid).get()
        events = []
        for snap in snaps:
            data = snap.to_dict() or {}
            events.append(
                SyncHistoryEvent(
                    event_id=snap.id,
                    platform=data["platform"],
                    started_at=data["started_at"],
                    completed_at=data.get("completed_at"),
                    status=data["status"],
                    products_synced_count=data.get("products_synced_count", 0),
                    error_message=data.get("error_message"),
                )
            )
        # Sort chronologically descending
        events.sort(key=lambda x: x.started_at, reverse=True)
        return events

    def trigger_sync(self, seller_uid: str, repository: SellerProductRepository) -> int:
        integration_doc = self._integrations_col().document(seller_uid).get()
        if not integration_doc.exists:
            raise ValueError("No connected e-commerce store configuration found.")

        data = integration_doc.to_dict() or {}
        platform = data["platform"]
        store_url = data["store_url"]
        encrypted_creds = data["encrypted_credentials"]

        # Re-validate at sync time too: defends stored/legacy integrations and
        # DNS-rebinding where a host now resolves to a private address.
        assert_public_http_url(store_url)

        credentials = decrypt_credentials(encrypted_creds)
        provider = get_provider(platform, store_url, credentials)

        started_at = datetime.now(timezone.utc).isoformat()
        history_ref = self._history_col().document()
        history_id = history_ref.id

        history_record = {
            "seller_uid": seller_uid,
            "platform": platform,
            "started_at": started_at,
            "completed_at": None,
            "status": "running",
            "products_synced_count": 0,
            "error_message": None,
        }
        history_ref.set(history_record)

        try:
            raw_products = provider.fetch_products()
            synced_count = 0
            
            for raw_p in raw_products:
                normalized = provider.normalize_product(raw_p)
                normalized["status"] = "active"
                # Stable per-platform identity so re-syncing updates products in
                # place instead of duplicating the catalogue on every sync.
                raw_id = str(raw_p.get("id") or "").strip()
                normalized["external_id"] = f"{platform}:{raw_id}" if raw_id else ""
                repository.upsert_product(seller_uid, normalized)
                synced_count += 1

            completed_at = datetime.now(timezone.utc).isoformat()
            
            # Update history log
            history_record.update({
                "completed_at": completed_at,
                "status": "success",
                "products_synced_count": synced_count,
            })
            history_ref.set(history_record)

            # Update integration state
            self._integrations_col().document(seller_uid).set({
                "last_sync_at": completed_at,
                "last_sync_status": "success",
            }, merge=True)

            return synced_count

        except Exception as exc:
            logger.exception("E-commerce synchronization failed: %s", exc)
            completed_at = datetime.now(timezone.utc).isoformat()
            
            history_record.update({
                "completed_at": completed_at,
                "status": "failed",
                "error_message": str(exc),
            })
            history_ref.set(history_record)

            self._integrations_col().document(seller_uid).set({
                "last_sync_at": completed_at,
                "last_sync_status": "failed",
            }, merge=True)

            raise
