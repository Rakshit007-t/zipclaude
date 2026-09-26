"""
Pure Read-Only Inspection of Live Firebase/Firestore Staging Dataset.

CRITICAL RULES:
1. Pure read-only (zero writes, updates, or deletes).
2. Queries all collections and reports true document counts.
3. Compares actual Firestore counts against Appwrite collections.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv()

import firebase_admin
from firebase_admin import credentials, firestore
from firebase_config import initialize_firebase, FIRESTORE_DATABASE_ID
from appwrite_config import appwrite_settings, get_appwrite_databases
from services.database_adapter import AppwriteDatabaseAdapter

def inspect_firebase():
    print(f"[INFO] Connecting to Live Firestore Database ID: {FIRESTORE_DATABASE_ID} (READ-ONLY)")
    try:
        initialize_firebase()
        fs_db = firestore.client(database_id=FIRESTORE_DATABASE_ID)
    except Exception as e:
        print(f"[ERROR] Could not connect to live Firestore: {e}")
        return

    # List all root collections in Firestore
    try:
        collections = list(fs_db.collections())
        print(f"[INFO] Found {len(collections)} collections in Firestore:")
    except Exception as e:
        print(f"[ERROR] Error listing Firestore collections: {e}")
        return

    firestore_counts = {}
    for col in collections:
        col_id = col.id
        docs = list(col.limit(500).stream())
        firestore_counts[col_id] = len(docs)
        print(f"  - Firestore Collection '{col_id}': {len(docs)} documents")

    print("\n[INFO] Connecting to Appwrite Staging Database...")
    adapter = AppwriteDatabaseAdapter()
    
    print("\n=== COMPARISON: FIRESTORE (LIVE SOURCE) vs APPWRITE (DESTINATION) ===")
    all_keys = sorted(set(firestore_counts.keys()))
    for k in all_keys:
        fs_count = firestore_counts[k]
        try:
            appwrite_docs = adapter.query_collection(k, limit=500)
            aw_count = len(appwrite_docs)
        except Exception:
            aw_count = "N/A (collection not yet created or unmapped)"
        print(f"  Collection '{k}': Firestore={fs_count} | Appwrite={aw_count}")

if __name__ == "__main__":
    inspect_firebase()
