"""Align Appwrite Schema with Full ZipRIGHT Ecosystem.

1. Makes all attributes optional (required=False) to mirror Firestore flexibility.
2. Declares all missing attributes across every ZipRIGHT domain model.
"""
from __future__ import annotations

import logging
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from appwrite.exception import AppwriteException
from appwrite.services.databases import Databases
from appwrite_config import appwrite_settings, get_appwrite_databases

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

COMPREHENSIVE_SCHEMAS: dict[str, list[dict[str, Any]]] = {
    "users": [
        {"key": "email", "type": "string", "size": 255},
        {"key": "displayName", "type": "string", "size": 255},
        {"key": "username", "type": "string", "size": 255},
        {"key": "photoURL", "type": "string", "size": 1024},
        {"key": "walletBalanceRupees", "type": "integer", "default": 0},
        {"key": "usage", "type": "string", "size": 4096},
        {"key": "gender", "type": "string", "size": 32},
        {"key": "height", "type": "float"},
        {"key": "weight", "type": "float"},
        {"key": "chest_cm", "type": "float"},
        {"key": "waist_cm", "type": "float"},
        {"key": "hips_cm", "type": "float"},
        {"key": "inseam_cm", "type": "float"},
        {"key": "shoulder_cm", "type": "float"},
        {"key": "neck_cm", "type": "float"},
        {"key": "bicep_cm", "type": "float"},
        {"key": "thigh_cm", "type": "float"},
        {"key": "fit_preference", "type": "string", "size": 64},
        {"key": "is_anonymous", "type": "boolean", "default": False},
        {"key": "is_suspended", "type": "boolean", "default": False},
        {"key": "created_at", "type": "string", "size": 64},
        {"key": "updated_at", "type": "string", "size": 64},
        {"key": "updatedAt", "type": "string", "size": 64},
    ],
    "sellers": [
        {"key": "store_name", "type": "string", "size": 255},
        {"key": "storeName", "type": "string", "size": 255},
        {"key": "business_email", "type": "string", "size": 255},
        {"key": "business_name", "type": "string", "size": 255},
        {"key": "owner_uid", "type": "string", "size": 64},
        {"key": "ownerUid", "type": "string", "size": 64},
        {"key": "uid", "type": "string", "size": 64},
        {"key": "phone", "type": "string", "size": 32},
        {"key": "platform", "type": "string", "size": 64},
        {"key": "status", "type": "string", "size": 32},
        {"key": "brand_description", "type": "string", "size": 2048},
        {"key": "address", "type": "string", "size": 1024},
        {"key": "commission_rate", "type": "float"},
        {"key": "profile", "type": "string", "size": 4096},
        {"key": "created_at", "type": "string", "size": 64},
        {"key": "createdAt", "type": "string", "size": 64},
        {"key": "updated_at", "type": "string", "size": 64},
        {"key": "updatedAt", "type": "string", "size": 64},
    ],
    "seller_products": [
        {"key": "seller_uid", "type": "string", "size": 64},
        {"key": "title", "type": "string", "size": 255},
        {"key": "price", "type": "float"},
        {"key": "price_paise", "type": "integer"},
        {"key": "brand", "type": "string", "size": 128},
        {"key": "category", "type": "string", "size": 64},
        {"key": "status", "type": "string", "size": 32},
        {"key": "images", "type": "string", "size": 4096},
        {"key": "sizes", "type": "string", "size": 2048},
        {"key": "description", "type": "string", "size": 4096},
        {"key": "external_id", "type": "string", "size": 128},
        {"key": "created_at", "type": "string", "size": 64},
        {"key": "updated_at", "type": "string", "size": 64},
    ],
    "orders": [
        {"key": "order_id", "type": "string", "size": 64},
        {"key": "customer_uid", "type": "string", "size": 64},
        {"key": "user_id", "type": "string", "size": 64},
        {"key": "status", "type": "string", "size": 64},
        {"key": "currency", "type": "string", "size": 16},
        {"key": "items", "type": "string", "size": 8192},
        {"key": "subtotal_paise", "type": "integer"},
        {"key": "shipping_paise", "type": "integer"},
        {"key": "tax_paise", "type": "integer"},
        {"key": "total_paise", "type": "integer"},
        {"key": "amount", "type": "float"},
        {"key": "seller_uids", "type": "string", "size": 2048},
        {"key": "seller_uid", "type": "string", "size": 64},
        {"key": "payment_provider", "type": "string", "size": 64},
        {"key": "payment_order_id", "type": "string", "size": 128},
        {"key": "payment_id", "type": "string", "size": 128},
        {"key": "idempotency_key", "type": "string", "size": 128},
        {"key": "shipping_address", "type": "string", "size": 2048},
        {"key": "notes", "type": "string", "size": 2048},
        {"key": "created_at", "type": "float"},
        {"key": "updated_at", "type": "float"},
        {"key": "paid_at", "type": "float"},
        {"key": "failed_at", "type": "float"},
    ],
    "posts": [
        {"key": "id", "type": "string", "size": 64},
        {"key": "user_id", "type": "string", "size": 64},
        {"key": "user_display_name", "type": "string", "size": 255},
        {"key": "user_username", "type": "string", "size": 255},
        {"key": "user_photo_url", "type": "string", "size": 1024},
        {"key": "type", "type": "string", "size": 64},
        {"key": "caption", "type": "string", "size": 2048},
        {"key": "media_url", "type": "string", "size": 1024},
        {"key": "thumbnail_url", "type": "string", "size": 1024},
        {"key": "tags", "type": "string", "size": 2048},
        {"key": "linked_product_ids", "type": "string", "size": 2048},
        {"key": "likes_count", "type": "integer", "default": 0},
        {"key": "comments_count", "type": "integer", "default": 0},
        {"key": "shares_count", "type": "integer", "default": 0},
        {"key": "created_at", "type": "string", "size": 64},
        {"key": "updated_at", "type": "string", "size": 64},
    ],
    "look_comments": [
        {"key": "id", "type": "string", "size": 64},
        {"key": "lookId", "type": "string", "size": 64},
        {"key": "post_id", "type": "string", "size": 64},
        {"key": "userId", "type": "string", "size": 64},
        {"key": "user_id", "type": "string", "size": 64},
        {"key": "user_name", "type": "string", "size": 255},
        {"key": "user_display_name", "type": "string", "size": 255},
        {"key": "user_username", "type": "string", "size": 255},
        {"key": "user_avatar", "type": "string", "size": 1024},
        {"key": "user_photo_url", "type": "string", "size": 1024},
        {"key": "comment", "type": "string", "size": 2048},
        {"key": "text", "type": "string", "size": 2048},
        {"key": "parent_comment_id", "type": "string", "size": 64},
        {"key": "createdAt", "type": "string", "size": 64},
        {"key": "created_at", "type": "string", "size": 64},
    ],
    "user_following": [
        {"key": "userId", "type": "string", "size": 64},
        {"key": "user_id", "type": "string", "size": 64},
        {"key": "targetUserId", "type": "string", "size": 64},
        {"key": "target_id", "type": "string", "size": 64},
        {"key": "uid", "type": "string", "size": 64},
        {"key": "displayName", "type": "string", "size": 255},
        {"key": "username", "type": "string", "size": 255},
        {"key": "photoURL", "type": "string", "size": 1024},
        {"key": "followedAt", "type": "string", "size": 64},
        {"key": "createdAt", "type": "string", "size": 64},
        {"key": "created_at", "type": "string", "size": 64},
    ],
    "user_followers": [
        {"key": "userId", "type": "string", "size": 64},
        {"key": "user_id", "type": "string", "size": 64},
        {"key": "followerId", "type": "string", "size": 64},
        {"key": "follower_id", "type": "string", "size": 64},
        {"key": "uid", "type": "string", "size": 64},
        {"key": "displayName", "type": "string", "size": 255},
        {"key": "username", "type": "string", "size": 255},
        {"key": "photoURL", "type": "string", "size": 1024},
        {"key": "followedAt", "type": "string", "size": 64},
        {"key": "createdAt", "type": "string", "size": 64},
        {"key": "created_at", "type": "string", "size": 64},
    ],
    "notifications": [
        {"key": "user_id", "type": "string", "size": 64},
        {"key": "userId", "type": "string", "size": 64},
        {"key": "recipient_id", "type": "string", "size": 64},
        {"key": "actor_id", "type": "string", "size": 64},
        {"key": "type", "type": "string", "size": 64},
        {"key": "title", "type": "string", "size": 255},
        {"key": "body", "type": "string", "size": 1024},
        {"key": "read", "type": "boolean", "default": False},
        {"key": "created_at", "type": "string", "size": 64},
    ],
    "user_blocked": [
        {"key": "userId", "type": "string", "size": 64},
        {"key": "user_id", "type": "string", "size": 64},
        {"key": "blockedUserId", "type": "string", "size": 64},
        {"key": "blocked_id", "type": "string", "size": 64},
        {"key": "createdAt", "type": "string", "size": 64},
        {"key": "created_at", "type": "string", "size": 64},
    ],
    "user_friends": [
        {"key": "userId", "type": "string", "size": 64},
        {"key": "user_id", "type": "string", "size": 64},
        {"key": "friendId", "type": "string", "size": 64},
        {"key": "friend_id", "type": "string", "size": 64},
        {"key": "createdAt", "type": "string", "size": 64},
        {"key": "created_at", "type": "string", "size": 64},
    ],
    "user_likes": [
        {"key": "userId", "type": "string", "size": 64},
        {"key": "user_id", "type": "string", "size": 64},
        {"key": "lookId", "type": "string", "size": 64},
        {"key": "post_id", "type": "string", "size": 64},
        {"key": "createdAt", "type": "string", "size": 64},
        {"key": "created_at", "type": "string", "size": 64},
    ],
    "tryon_refunds": [
        {"key": "charged_rupees", "type": "integer", "default": 0},
        {"key": "free_tryon", "type": "boolean", "default": False},
        {"key": "job_id", "type": "string", "size": 64},
        {"key": "user_id", "type": "string", "size": 64},
        {"key": "refunded_at", "type": "string", "size": 64},
    ],
    "tryon_jobs": [
        {"key": "job_id", "type": "string", "size": 64},
        {"key": "user_id", "type": "string", "size": 64},
        {"key": "status", "type": "string", "size": 64},
        {"key": "result_url", "type": "string", "size": 1024},
        {"key": "payload", "type": "string", "size": 8192},
        {"key": "created_at", "type": "string", "size": 64},
        {"key": "updated_at", "type": "string", "size": 64},
    ],
    "publicProfiles": [
        {"key": "uid", "type": "string", "size": 64},
        {"key": "displayName", "type": "string", "size": 255},
        {"key": "username", "type": "string", "size": 255},
        {"key": "photoURL", "type": "string", "size": 1024},
        {"key": "followersCount", "type": "integer", "default": 0},
        {"key": "followingCount", "type": "integer", "default": 0},
        {"key": "updatedAt", "type": "string", "size": 64},
        {"key": "created_at", "type": "string", "size": 64},
    ],
}


def align():
    db = get_appwrite_databases()
    db_id = appwrite_settings.DATABASE_ID
    logger.info("Aligning schema on database: %s", db_id)

    for col_id, attrs in COMPREHENSIVE_SCHEMAS.items():
        logger.info("Checking collection '%s'...", col_id)
        # 1. Fetch current attributes
        try:
            curr_resp = db.list_attributes(db_id, col_id)
            current_attrs = getattr(curr_resp, "attributes", None) or curr_resp.get("attributes", [])
        except AppwriteException as exc:
            logger.warning("Could not list attributes on %s: %s", col_id, exc)
            continue

        existing_map = {}
        for a in current_attrs:
            k = getattr(a, "key", "")
            existing_map[k] = a

        # 2. Make all existing required attributes non-required
        for k, a in existing_map.items():
            if getattr(a, "required", False):
                attr_type = getattr(a, "type", "string")
                logger.info("  Relaxing required constraint on '%s.%s' (%s)", col_id, k, attr_type)
                try:
                    if attr_type == "string":
                        db.update_string_attribute(db_id, col_id, k, required=False, default=None)
                    elif attr_type in ("integer", "int"):
                        db.update_integer_attribute(db_id, col_id, k, required=False, default=None)
                    elif attr_type in ("float", "double"):
                        db.update_float_attribute(db_id, col_id, k, required=False, default=None)
                    elif attr_type == "boolean":
                        db.update_boolean_attribute(db_id, col_id, k, required=False, default=None)
                except AppwriteException as exc:
                    logger.warning("  Could not update attribute %s.%s: %s", col_id, k, exc)

        # 3. Create missing attributes
        for spec in attrs:
            k = spec["key"]
            if k in existing_map:
                continue

            attr_type = spec["type"]
            size = spec.get("size", 255)
            default = spec.get("default")
            logger.info("  Adding missing attribute '%s.%s' (%s)", col_id, k, attr_type)
            try:
                if attr_type == "string":
                    db.create_string_attribute(db_id, col_id, k, size=size, required=False, default=default)
                elif attr_type == "integer":
                    db.create_integer_attribute(db_id, col_id, k, required=False, default=default)
                elif attr_type == "float":
                    db.create_float_attribute(db_id, col_id, k, required=False, default=default)
                elif attr_type == "boolean":
                    db.create_boolean_attribute(db_id, col_id, k, required=False, default=default)
            except AppwriteException as exc:
                if getattr(exc, "code", 0) != 409:
                    logger.warning("  Failed adding %s.%s: %s", col_id, k, exc)

    logger.info("Schema alignment completed successfully.")


if __name__ == "__main__":
    align()
