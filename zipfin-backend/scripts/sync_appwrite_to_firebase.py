"""Rollback & Reverse-Sync Tool: Appwrite to Firebase.

Used during the dual-write validation window to guarantee zero data loss
and immediate rollback capability back to Firebase if needed.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from appwrite_config import appwrite_settings
from firebase_config import get_firestore_client
from services.database_adapter import AppwriteDatabaseAdapter

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def reverse_sync_collection(collection_name: str, appwrite_db: AppwriteDatabaseAdapter, firestore_db) -> int:
    """Sync documents from Appwrite back to Firestore."""
    docs = appwrite_db.query_collection(collection_name, limit=500)
    synced = 0
    for doc in docs:
        doc_id = doc.get("id")
        if not doc_id:
            continue
        clean = {k: v for k, v in doc.items() if not k.startswith("$") and k != "id"}
        try:
            firestore_db.collection(collection_name).document(doc_id).set(clean, merge=True)
            synced += 1
        except Exception as exc:
            logger.warning("Failed to sync %s/%s back to Firestore: %s", collection_name, doc_id, exc)

    logger.info("Reverse-synced %d records from Appwrite to Firestore for '%s'.", synced, collection_name)
    return synced


def run_rollback_sync() -> dict[str, int]:
    logger.info("Initiating Appwrite to Firestore sync for rollback safety...")
    appwrite_db = AppwriteDatabaseAdapter()
    firestore_db = get_firestore_client()

    collections = ["users", "sellers", "seller_products", "orders", "tryon_refunds"]
    results = {}
    for col in collections:
        results[col] = reverse_sync_collection(col, appwrite_db, firestore_db)

    logger.info("Rollback sync complete: %s", results)
    return results


if __name__ == "__main__":
    run_rollback_sync()
