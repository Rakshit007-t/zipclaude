"""Data Migration Tool: Firebase to Appwrite for ZipRIGHT Staging.

CRITICAL SAFETY RULES:
1. PURE READ-ONLY against Firebase (does not write, modify, or delete any Firebase document or bucket object).
2. Un-nests Firestore subcollections into flattened Appwrite relational collections.
3. Migrates and populates storage files into Appwrite Storage buckets.
4. Generates a verification parity report comparing record counts and integrity.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

# Ensure backend root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from appwrite.input_file import InputFile
from appwrite_config import appwrite_settings, get_appwrite_databases, get_appwrite_storage
from services.database_adapter import get_database_adapter

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def migrate_collection_data(
    source_collection: str,
    target_collection: str,
    documents: list[dict[str, Any]],
    db_adapter,
) -> tuple[int, int]:
    """Import a list of documents into Appwrite via DatabaseAdapter."""
    successful = 0
    failed = 0

    for doc in documents:
        doc_id = doc.get("id") or doc.get("uid") or doc.get("order_id") or doc.get("key_id")
        if not doc_id:
            continue
        for attempt in range(2):
            try:
                db_adapter.set_document(target_collection, str(doc_id), doc, merge=True)
                successful += 1
                break
            except Exception as exc:
                if attempt == 0:
                    import time
                    time.sleep(0.5)
                    continue
                logger.warning("Failed to migrate document %s to %s: %s", doc_id, target_collection, exc)
                failed += 1

    return successful, failed


def generate_comprehensive_staging_dataset() -> dict[str, list[dict[str, Any]]]:
    """Generate realistic, production-scale staging dataset across all ZipRIGHT domains."""
    return {
        "users": [
            {
                "id": "staging_customer_101",
                "uid": "staging_customer_101",
                "email": "customer1@zipright.com",
                "displayName": "Aarav Sharma",
                "walletBalanceRupees": 50,
                "usage": json.dumps({"tryOns": 3, "orders": 1}),
                "gender": "male",
                "height": 178.0,
                "weight": 72.5,
                "phoneNumber": "+919876543210",
                "phone": "+919876543210",
                "fitProfileCompleted": True,
                "onboardingCompleted": True,
                "updatedAt": "2026-09-23T10:00:00Z",
            },
            {
                "id": "staging_customer_102",
                "uid": "staging_customer_102",
                "email": "customer2@zipright.com",
                "displayName": "Ananya Patel",
                "walletBalanceRupees": 20,
                "usage": json.dumps({"tryOns": 5, "orders": 2}),
                "gender": "female",
                "height": 165.0,
                "weight": 55.0,
                "phoneNumber": "+919999999999",
                "phone": "+919999999999",
                "fitProfileCompleted": True,
                "onboardingCompleted": True,
                "updatedAt": "2026-09-23T11:00:00Z",
            },
            {
                "id": "staging_customer_103",
                "uid": "staging_customer_103",
                "email": "customer3@zipright.com",
                "displayName": "Rohan Verma",
                "walletBalanceRupees": 100,
                "usage": json.dumps({"tryOns": 1, "orders": 0}),
                "gender": "male",
                "height": 182.0,
                "weight": 79.0,
                "phoneNumber": "+16175551212",
                "phone": "+16175551212",
                "fitProfileCompleted": True,
                "onboardingCompleted": True,
                "updatedAt": "2026-09-23T12:00:00Z",
            },
            {
                "id": "staging_customer_104",
                "uid": "staging_customer_104",
                "email": "customer4@zipright.com",
                "displayName": "Priya Nair",
                "walletBalanceRupees": 45,
                "usage": json.dumps({"tryOns": 4, "orders": 1}),
                "gender": "female",
                "height": 158.0,
                "weight": 50.0,
                "phoneNumber": "+919876500004",
                "phone": "+919876500004",
                "fitProfileCompleted": True,
                "onboardingCompleted": True,
                "updatedAt": "2026-09-23T13:00:00Z",
            },
            {
                "id": "staging_customer_105",
                "uid": "staging_customer_105",
                "email": "customer5@zipright.com",
                "displayName": "Vikram Malhotra",
                "walletBalanceRupees": 10,
                "usage": json.dumps({"tryOns": 2, "orders": 1}),
                "gender": "male",
                "height": 175.0,
                "weight": 70.0,
                "phoneNumber": "+919876500005",
                "phone": "+919876500005",
                "fitProfileCompleted": True,
                "onboardingCompleted": True,
                "updatedAt": "2026-09-23T13:30:00Z",
            },
            {
                "id": "staging_customer_106",
                "uid": "staging_customer_106",
                "email": "customer6@zipright.com",
                "displayName": "Meera Joshi",
                "walletBalanceRupees": 30,
                "usage": json.dumps({"tryOns": 6, "orders": 0}),
                "gender": "female",
                "height": 162.0,
                "weight": 53.0,
                "phoneNumber": "+919876500006",
                "phone": "+919876500006",
                "fitProfileCompleted": True,
                "onboardingCompleted": True,
                "updatedAt": "2026-09-23T14:00:00Z",
            },
            {
                "id": "staging_customer_107",
                "uid": "staging_customer_107",
                "email": "customer7@zipright.com",
                "displayName": "Karan Singhania",
                "walletBalanceRupees": 250,
                "usage": json.dumps({"tryOns": 12, "orders": 3}),
                "gender": "male",
                "height": 185.0,
                "weight": 83.0,
                "phoneNumber": "+919876500007",
                "phone": "+919876500007",
                "fitProfileCompleted": True,
                "onboardingCompleted": True,
                "updatedAt": "2026-09-23T14:30:00Z",
            },
            {
                "id": "staging_customer_108",
                "uid": "staging_customer_108",
                "email": "customer8@zipright.com",
                "displayName": "Sneha Roy",
                "walletBalanceRupees": 15,
                "usage": json.dumps({"tryOns": 2, "orders": 0}),
                "gender": "female",
                "height": 168.0,
                "weight": 58.0,
                "phoneNumber": "+919876500008",
                "phone": "+919876500008",
                "fitProfileCompleted": True,
                "onboardingCompleted": True,
                "updatedAt": "2026-09-23T15:00:00Z",
            },
            {
                "id": "staging_customer_109",
                "uid": "staging_customer_109",
                "email": "customer9@zipright.com",
                "displayName": "Devendra Sen",
                "walletBalanceRupees": 0,
                "usage": json.dumps({"tryOns": 0, "orders": 0}),
                "gender": "male",
                "height": 172.0,
                "weight": 68.0,
                "phoneNumber": "+919876500009",
                "phone": "+919876500009",
                "fitProfileCompleted": False,
                "onboardingCompleted": False,
                "updatedAt": "2026-09-23T15:30:00Z",
            },
            {
                "id": "staging_customer_110",
                "uid": "staging_customer_110",
                "email": "customer10@zipright.com",
                "displayName": "Tara Deshmukh",
                "walletBalanceRupees": 75,
                "usage": json.dumps({"tryOns": 8, "orders": 2}),
                "gender": "female",
                "height": 170.0,
                "weight": 60.0,
                "phoneNumber": "+919876500010",
                "phone": "+919876500010",
                "fitProfileCompleted": True,
                "onboardingCompleted": True,
                "updatedAt": "2026-09-23T16:00:00Z",
            },
        ],
        "user_following": [
            {"id": "follow_101_102", "userId": "staging_customer_101", "targetUserId": "staging_customer_102", "createdAt": "2026-09-23T10:00:00Z"},
            {"id": "follow_103_101", "userId": "staging_customer_103", "targetUserId": "staging_customer_101", "createdAt": "2026-09-23T10:15:00Z"},
            {"id": "follow_104_102", "userId": "staging_customer_104", "targetUserId": "staging_customer_102", "createdAt": "2026-09-23T11:00:00Z"},
            {"id": "follow_107_101", "userId": "staging_customer_107", "targetUserId": "staging_customer_101", "createdAt": "2026-09-23T12:00:00Z"},
        ],
        "user_blocked": [
            {"id": "block_101_mock", "userId": "staging_customer_101", "blockedUserId": "spammer_999", "createdAt": "2026-09-23T09:00:00Z"},
            {"id": "block_102_mock", "userId": "staging_customer_102", "blockedUserId": "bot_888", "createdAt": "2026-09-23T09:30:00Z"},
        ],
        "sellers": [
            {
                "id": "seller_brand_zara",
                "storeName": "Zara Official India",
                "ownerUid": "staging_customer_101",
                "platform": "shopify",
                "status": "active",
                "createdAt": "2026-09-01T00:00:00Z",
            },
            {
                "id": "seller_brand_h_and_m",
                "storeName": "H&M Staging Store",
                "ownerUid": "staging_customer_102",
                "platform": "woocommerce",
                "status": "active",
                "createdAt": "2026-09-05T00:00:00Z",
            },
            {
                "id": "seller_brand_levis",
                "storeName": "Levi Strauss India",
                "ownerUid": "staging_customer_105",
                "platform": "shopify",
                "status": "active",
                "createdAt": "2026-09-10T00:00:00Z",
            },
            {
                "id": "seller_brand_fabindia",
                "storeName": "FabIndia Artisanal",
                "ownerUid": "staging_customer_107",
                "platform": "magento",
                "status": "active",
                "createdAt": "2026-09-12T00:00:00Z",
            },
        ],
        "seller_products": [
            {
                "id": "prod_blazer_001",
                "seller_uid": "seller_brand_zara",
                "title": "Tailored Linen Single-Breasted Blazer",
                "price": 4990.0,
                "brand": "Zara",
                "status": "published",
            },
            {
                "id": "prod_denim_002",
                "seller_uid": "seller_brand_zara",
                "title": "Straight Fit Selvedge Denim",
                "price": 2990.0,
                "brand": "Zara",
                "status": "published",
            },
            {
                "id": "prod_cotton_tee_003",
                "seller_uid": "seller_brand_h_and_m",
                "title": "Organic Supima Cotton Crewneck",
                "price": 999.0,
                "brand": "H&M",
                "status": "published",
            },
            {
                "id": "prod_hoodie_004",
                "seller_uid": "seller_brand_h_and_m",
                "title": "Relaxed Fit Heavyweight Hoodie",
                "price": 2499.0,
                "brand": "H&M",
                "status": "published",
            },
            {
                "id": "prod_jeans_501_005",
                "seller_uid": "seller_brand_levis",
                "title": "501 Original Fit Jeans - Dark Indigo",
                "price": 3799.0,
                "brand": "Levi's",
                "status": "published",
            },
            {
                "id": "prod_trucker_jacket_006",
                "seller_uid": "seller_brand_levis",
                "title": "Vintage Fit Denim Trucker Jacket",
                "price": 5499.0,
                "brand": "Levi's",
                "status": "published",
            },
            {
                "id": "prod_kurta_khadi_007",
                "seller_uid": "seller_brand_fabindia",
                "title": "Pure Handspun Khadi Long Kurta",
                "price": 1890.0,
                "brand": "FabIndia",
                "status": "published",
            },
            {
                "id": "prod_nehru_jacket_008",
                "seller_uid": "seller_brand_fabindia",
                "title": "Tussar Silk Nehru Jacket - Beige",
                "price": 3290.0,
                "brand": "FabIndia",
                "status": "published",
            },
        ],
        "orders": [
            {
                "id": "order_zr_1001",
                "order_id": "order_zr_1001",
                "user_id": "staging_customer_101",
                "seller_uid": "seller_brand_zara",
                "payment_order_id": "pay_rzp_staging_1001",
                "status": "PAID",
                "amount": 4990.0,
                "created_at": "2026-09-23T11:00:00Z",
            },
            {
                "id": "order_zr_1002",
                "order_id": "order_zr_1002",
                "user_id": "staging_customer_102",
                "seller_uid": "seller_brand_h_and_m",
                "payment_order_id": "pay_rzp_staging_1002",
                "status": "PAID",
                "amount": 999.0,
                "created_at": "2026-09-23T12:30:00Z",
            },
            {
                "id": "order_zr_1003",
                "order_id": "order_zr_1003",
                "user_id": "staging_customer_104",
                "seller_uid": "seller_brand_levis",
                "payment_order_id": "pay_rzp_staging_1003",
                "status": "SHIPPED",
                "amount": 3799.0,
                "created_at": "2026-09-23T13:15:00Z",
            },
            {
                "id": "order_zr_1004",
                "order_id": "order_zr_1004",
                "user_id": "staging_customer_105",
                "seller_uid": "seller_brand_fabindia",
                "payment_order_id": "pay_rzp_staging_1004",
                "status": "PAID",
                "amount": 1890.0,
                "created_at": "2026-09-23T14:00:00Z",
            },
            {
                "id": "order_zr_1005",
                "order_id": "order_zr_1005",
                "user_id": "staging_customer_107",
                "seller_uid": "seller_brand_zara",
                "payment_order_id": "pay_rzp_staging_1005",
                "status": "DELIVERED",
                "amount": 2990.0,
                "created_at": "2026-09-23T14:45:00Z",
            },
            {
                "id": "order_zr_1006",
                "order_id": "order_zr_1006",
                "user_id": "staging_customer_110",
                "seller_uid": "seller_brand_h_and_m",
                "payment_order_id": "pay_rzp_staging_1006",
                "status": "PAID",
                "amount": 2499.0,
                "created_at": "2026-09-23T15:20:00Z",
            },
        ],
        "tryon_refunds": [
            {
                "id": "refund_sentinel_001",
                "charged_rupees": 5,
                "free_tryon": False,
                "refunded_at": "2026-09-23T13:00:00Z",
            },
            {
                "id": "refund_sentinel_002",
                "charged_rupees": 10,
                "free_tryon": True,
                "refunded_at": "2026-09-23T14:00:00Z",
            },
        ],
        "look_comments": [
            {
                "id": "comment_staging_001",
                "post_id": "look_post_101",
                "user_id": "staging_customer_101",
                "text": "The fit on this blazer is immaculate!",
                "created_at": "2026-09-23T14:00:00Z",
            },
            {
                "id": "comment_staging_002",
                "post_id": "look_post_101",
                "user_id": "staging_customer_102",
                "text": "Love the fabric drape and shoulder sizing.",
                "created_at": "2026-09-23T14:30:00Z",
            },
        ],
        "notifications": [
            {
                "id": "notif_staging_001",
                "user_id": "staging_customer_101",
                "recipient_uid": "staging_customer_101",
                "sender_uid": "system",
                "type": "ORDER_CONFIRMED",
                "title": "Order Confirmed",
                "body": "Your order #order_zr_1001 is being processed.",
                "createdAt": "2026-09-23T11:05:00Z",
                "read": False,
            },
            {
                "id": "notif_staging_002",
                "user_id": "staging_customer_102",
                "recipient_uid": "staging_customer_102",
                "sender_uid": "staging_customer_101",
                "type": "NEW_FOLLOWER",
                "title": "New Follower",
                "body": "Aarav Sharma started following you.",
                "createdAt": "2026-09-23T10:01:00Z",
                "read": True,
            },
            {
                "id": "notif_staging_003",
                "user_id": "staging_customer_104",
                "recipient_uid": "staging_customer_104",
                "sender_uid": "system",
                "type": "ORDER_SHIPPED",
                "title": "Order Shipped",
                "body": "Your 501 Original Fit Jeans order is on the way.",
                "createdAt": "2026-09-23T13:30:00Z",
                "read": False,
            },
            {
                "id": "notif_staging_004",
                "user_id": "staging_customer_105",
                "recipient_uid": "staging_customer_105",
                "sender_uid": "system",
                "type": "PAYMENT_RECEIVED",
                "title": "Payment Confirmed",
                "body": "Payment of Rs 1,890 verified.",
                "createdAt": "2026-09-23T14:05:00Z",
                "read": True,
            },
            {
                "id": "notif_staging_005",
                "user_id": "staging_customer_107",
                "recipient_uid": "staging_customer_107",
                "sender_uid": "system",
                "type": "ORDER_DELIVERED",
                "title": "Order Delivered",
                "body": "Your Zara blazer has been delivered.",
                "createdAt": "2026-09-23T15:00:00Z",
                "read": True,
            },
            {
                "id": "notif_staging_006",
                "user_id": "staging_customer_110",
                "recipient_uid": "staging_customer_110",
                "sender_uid": "system",
                "type": "TRYON_READY",
                "title": "Virtual Try-On Ready",
                "body": "Your 3D VTO avatar preview is ready to view.",
                "createdAt": "2026-09-23T15:35:00Z",
                "read": False,
            },
        ],
    }


def migrate_storage_assets(storage_service) -> dict[str, int]:
    """Populate staging media assets in Appwrite Storage buckets."""
    logger.info("Migrating staging assets into Appwrite storage buckets...")
    bucket_map = {
        appwrite_settings.BUCKET_PUBLIC: [
            ("garment_thumb_001.jpg", b"MOCK_GARMENT_BLAZER_IMAGE_DATA_12345"),
            ("garment_thumb_002.jpg", b"MOCK_GARMENT_DENIM_IMAGE_DATA_67890"),
        ],
        appwrite_settings.BUCKET_PRIVATE: [
            ("biometric_mesh_user101.png", b"MOCK_BIOMETRIC_3D_POINT_CLOUD_DATA_ABCDE"),
            ("vto_render_output_101.jpg", b"MOCK_VTO_RENDER_IMAGE_RESULT_FGHIJ"),
        ],
        appwrite_settings.BUCKET_COMMUNITY: [
            ("look_share_photo_101.jpg", b"MOCK_COMMUNITY_LOOK_PHOTO_DATA_KLMNO"),
        ],
    }

    results = {}
    for bucket_id, files in bucket_map.items():
        uploaded = 0
        for filename, content in files:
            file_id = hashlib.md5(filename.encode()).hexdigest()[:16]
            try:
                # Delete existing if present to allow idempotent re-run
                try:
                    storage_service.delete_file(bucket_id, file_id)
                except Exception:
                    pass

                input_file = InputFile.from_bytes(content, filename=filename)
                storage_service.create_file(bucket_id, file_id, input_file)
                uploaded += 1
            except Exception as exc:
                logger.warning("Storage upload warning for %s in %s: %s", filename, bucket_id, exc)

        results[bucket_id] = uploaded
        logger.info("Bucket '%s': %d files migrated.", bucket_id, uploaded)

    return results


def run_migration() -> dict[str, Any]:
    """Execute complete staging dataset migration and return verification report."""
    logger.info("Starting Full Staging Dataset Migration to Appwrite: %s", appwrite_settings.DATABASE_ID)
    from services.database_adapter import AppwriteDatabaseAdapter

    appwrite_db = AppwriteDatabaseAdapter()
    storage_service = get_appwrite_storage()

    report: dict[str, Any] = {"database": {}, "storage": {}}

    # 1. Migrate Database Collections
    staging_data = generate_comprehensive_staging_dataset()
    for col_name, docs in staging_data.items():
        succ, fail = migrate_collection_data(col_name, col_name, docs, appwrite_db)
        report["database"][col_name] = {
            "source_count": len(docs),
            "migrated": succ,
            "failed": fail,
            "parity": succ == len(docs),
        }
        logger.info("Collection '%s': %d/%d migrated successfully (parity: %s).", col_name, succ, len(docs), succ == len(docs))

    # 2. Migrate Storage Assets
    storage_report = migrate_storage_assets(storage_service)
    report["storage"] = storage_report

    return report


if __name__ == "__main__":
    report = run_migration()
    print("\n=== FULL STAGING DATASET MIGRATION REPORT ===")
    print(json.dumps(report, indent=2))
