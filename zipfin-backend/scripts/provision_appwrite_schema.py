"""Appwrite Schema & Storage Bucket Provisioning Script.

Declares and initializes all collections, strict attributes, indexes, and storage buckets
required by the ZipRIGHT application.
"""

from __future__ import annotations

import logging
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from appwrite.client import Client
from appwrite.exception import AppwriteException
from appwrite.permission import Permission
from appwrite.role import Role
from appwrite.services.databases import Databases
from appwrite.services.storage import Storage

from appwrite_config import appwrite_settings, get_appwrite_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


COLLECTION_SCHEMAS: dict[str, list[dict[str, Any]]] = {
    "users": [
        {"key": "email", "type": "string", "size": 255, "required": False},
        {"key": "displayName", "type": "string", "size": 255, "required": False},
        {"key": "walletBalanceRupees", "type": "integer", "required": False, "default": 0},
        {"key": "usage", "type": "string", "size": 2048, "required": False},
        {"key": "gender", "type": "string", "size": 32, "required": False},
        {"key": "height", "type": "float", "required": False},
        {"key": "weight", "type": "float", "required": False},
        {"key": "uid", "type": "string", "size": 64, "required": False},
        {"key": "updatedAt", "type": "string", "size": 64, "required": False},
    ],
    "user_following": [
        {"key": "userId", "type": "string", "size": 64, "required": True},
        {"key": "targetUserId", "type": "string", "size": 64, "required": True},
        {"key": "createdAt", "type": "string", "size": 64, "required": False},
    ],
    "user_followers": [
        {"key": "userId", "type": "string", "size": 64, "required": True},
        {"key": "followerId", "type": "string", "size": 64, "required": True},
        {"key": "createdAt", "type": "string", "size": 64, "required": False},
    ],
    "user_blocked": [
        {"key": "userId", "type": "string", "size": 64, "required": True},
        {"key": "blockedUserId", "type": "string", "size": 64, "required": True},
        {"key": "createdAt", "type": "string", "size": 64, "required": False},
    ],
    "user_friends": [
        {"key": "userId", "type": "string", "size": 64, "required": True},
        {"key": "friendId", "type": "string", "size": 64, "required": True},
        {"key": "createdAt", "type": "string", "size": 64, "required": False},
    ],
    "user_likes": [
        {"key": "userId", "type": "string", "size": 64, "required": True},
        {"key": "lookId", "type": "string", "size": 64, "required": True},
        {"key": "createdAt", "type": "string", "size": 64, "required": False},
    ],
    "looks": [
        {"key": "userId", "type": "string", "size": 64, "required": True},
        {"key": "imageUrl", "type": "string", "size": 1024, "required": True},
        {"key": "caption", "type": "string", "size": 1000, "required": False},
        {"key": "likesCount", "type": "integer", "required": False, "default": 0},
        {"key": "createdAt", "type": "string", "size": 64, "required": False},
    ],
    "look_comments": [
        {"key": "lookId", "type": "string", "size": 64, "required": True},
        {"key": "userId", "type": "string", "size": 64, "required": True},
        {"key": "comment", "type": "string", "size": 1000, "required": True},
        {"key": "createdAt", "type": "string", "size": 64, "required": False},
    ],
    "conversations": [
        {"key": "participants", "type": "string", "size": 1024, "required": False},
        {"key": "lastMessage", "type": "string", "size": 1000, "required": False},
        {"key": "updatedAt", "type": "string", "size": 64, "required": False},
    ],
    "chat_messages": [
        {"key": "conversationId", "type": "string", "size": 64, "required": True},
        {"key": "senderId", "type": "string", "size": 64, "required": True},
        {"key": "text", "type": "string", "size": 2048, "required": True},
        {"key": "createdAt", "type": "string", "size": 64, "required": False},
    ],
    "sellers": [
        {"key": "storeName", "type": "string", "size": 255, "required": True},
        {"key": "ownerUid", "type": "string", "size": 64, "required": True},
        {"key": "platform", "type": "string", "size": 64, "required": False},
        {"key": "status", "type": "string", "size": 32, "required": False},
        {"key": "createdAt", "type": "string", "size": 64, "required": False},
    ],
    "seller_products": [
        {"key": "seller_uid", "type": "string", "size": 64, "required": True},
        {"key": "title", "type": "string", "size": 255, "required": True},
        {"key": "price", "type": "float", "required": True},
        {"key": "images", "type": "string", "size": 4096, "required": False},
        {"key": "brand", "type": "string", "size": 128, "required": False},
        {"key": "status", "type": "string", "size": 32, "required": False},
    ],
    "seller_integrations": [
        {"key": "seller_uid", "type": "string", "size": 64, "required": True},
        {"key": "platform", "type": "string", "size": 64, "required": True},
        {"key": "credentials", "type": "string", "size": 4096, "required": False},
        {"key": "status", "type": "string", "size": 32, "required": False},
    ],
    "orders": [
        {"key": "order_id", "type": "string", "size": 64, "required": True},
        {"key": "user_id", "type": "string", "size": 64, "required": True},
        {"key": "seller_uid", "type": "string", "size": 64, "required": False},
        {"key": "payment_order_id", "type": "string", "size": 128, "required": False},
        {"key": "status", "type": "string", "size": 64, "required": True},
        {"key": "amount", "type": "float", "required": True},
        {"key": "created_at", "type": "string", "size": 64, "required": False},
    ],
    "tryon_events": [
        {"key": "user_id", "type": "string", "size": 64, "required": True},
        {"key": "product_image_url", "type": "string", "size": 1024, "required": False},
        {"key": "product_id", "type": "string", "size": 64, "required": False},
        {"key": "seller_uid", "type": "string", "size": 64, "required": False},
        {"key": "brand", "type": "string", "size": 128, "required": False},
        {"key": "timestamp", "type": "string", "size": 64, "required": False},
    ],
    "tryon_refunds": [
        {"key": "charged_rupees", "type": "integer", "required": False, "default": 0},
        {"key": "free_tryon", "type": "boolean", "required": False, "default": False},
        {"key": "refunded_at", "type": "string", "size": 64, "required": False},
    ],
    "fit_profiles": [
        {"key": "user_id", "type": "string", "size": 64, "required": True},
        {"key": "measurements", "type": "string", "size": 4096, "required": False},
        {"key": "updated_at", "type": "string", "size": 64, "required": False},
    ],
    "recent_scans": [
        {"key": "user_id", "type": "string", "size": 64, "required": True},
        {"key": "scan_data", "type": "string", "size": 4096, "required": False},
        {"key": "created_at", "type": "string", "size": 64, "required": False},
    ],
    "request_rate_limits": [
        {"key": "key", "type": "string", "size": 255, "required": True},
        {"key": "count", "type": "integer", "required": False, "default": 0},
        {"key": "reset_at", "type": "float", "required": True},
    ],
    "developer_api_keys": [
        {"key": "key_id", "type": "string", "size": 64, "required": True},
        {"key": "hashed_key", "type": "string", "size": 255, "required": True},
        {"key": "seller_uid", "type": "string", "size": 64, "required": True},
        {"key": "name", "type": "string", "size": 128, "required": False},
        {"key": "status", "type": "string", "size": 32, "required": False},
    ],
    "posts": [
        {"key": "user_id", "type": "string", "size": 64, "required": True},
        {"key": "user_display_name", "type": "string", "size": 255, "required": False},
        {"key": "user_username", "type": "string", "size": 255, "required": False},
        {"key": "type", "type": "string", "size": 64, "required": False},
        {"key": "caption", "type": "string", "size": 2048, "required": False},
        {"key": "media_url", "type": "string", "size": 1024, "required": False},
        {"key": "thumbnail_url", "type": "string", "size": 1024, "required": False},
        {"key": "tags", "type": "string", "size": 1024, "required": False},
        {"key": "linked_product_ids", "type": "string", "size": 1024, "required": False},
        {"key": "likes_count", "type": "integer", "required": False, "default": 0},
        {"key": "comments_count", "type": "integer", "required": False, "default": 0},
        {"key": "shares_count", "type": "integer", "required": False, "default": 0},
        {"key": "created_at", "type": "string", "size": 64, "required": False},
    ],
    "tryon_jobs": [
        {"key": "job_id", "type": "string", "size": 64, "required": True},
        {"key": "user_id", "type": "string", "size": 64, "required": True},
        {"key": "status", "type": "string", "size": 64, "required": False},
        {"key": "result_url", "type": "string", "size": 1024, "required": False},
        {"key": "created_at", "type": "string", "size": 64, "required": False},
        {"key": "updated_at", "type": "string", "size": 64, "required": False},
        {"key": "payload", "type": "string", "size": 4096, "required": False},
    ],
    "notifications": [
        {"key": "user_id", "type": "string", "size": 64, "required": True},
        {"key": "type", "type": "string", "size": 64, "required": False},
        {"key": "title", "type": "string", "size": 255, "required": False},
        {"key": "body", "type": "string", "size": 1024, "required": False},
        {"key": "read", "type": "boolean", "required": False, "default": False},
        {"key": "created_at", "type": "string", "size": 64, "required": False},
    ],
    "publicProfiles": [
        {"key": "uid", "type": "string", "size": 64, "required": True},
        {"key": "displayName", "type": "string", "size": 255, "required": False},
        {"key": "followersCount", "type": "integer", "required": False, "default": 0},
        {"key": "followingCount", "type": "integer", "required": False, "default": 0},
        {"key": "updatedAt", "type": "string", "size": 64, "required": False},
    ],
    "seller_sync_history": [
        {"key": "seller_uid", "type": "string", "size": 64, "required": True},
        {"key": "platform", "type": "string", "size": 64, "required": False},
        {"key": "status", "type": "string", "size": 64, "required": False},
        {"key": "synced_at", "type": "string", "size": 64, "required": False},
    ],
    "reports": [
        {"key": "target_id", "type": "string", "size": 64, "required": True},
        {"key": "reason", "type": "string", "size": 1024, "required": False},
        {"key": "created_at", "type": "string", "size": 64, "required": False},
    ],
    "health_probe": [
        {"key": "status", "type": "string", "size": 32, "required": False},
    ],
}


def provision_database(databases: Databases, db_id: str) -> None:
    """Create the database if it doesn't already exist."""
    try:
        databases.get(database_id=db_id)
        logger.info("Database '%s' already exists.", db_id)
    except AppwriteException:
        logger.info("Creating database '%s'...", db_id)
        databases.create(database_id=db_id, name="ZipRIGHT Staging Database")
        logger.info("Database '%s' created successfully.", db_id)


def provision_collections(databases: Databases, db_id: str) -> None:
    """Create collections and their attributes."""
    for col_id, attributes in COLLECTION_SCHEMAS.items():
        try:
            databases.get_collection(database_id=db_id, collection_id=col_id)
            logger.info("Collection '%s' already exists.", col_id)
        except AppwriteException:
            logger.info("Creating collection '%s'...", col_id)
            databases.create_collection(
                database_id=db_id,
                collection_id=col_id,
                name=col_id.replace("_", " ").title(),
                permissions=[
                    Permission.read(Role.users()),
                    Permission.create(Role.users()),
                    Permission.update(Role.users()),
                    Permission.delete(Role.users()),
                ],
                document_security=True,
            )
            time.sleep(0.5)

        # Create attributes
        for attr in attributes:
            key = attr["key"]
            attr_type = attr["type"]
            required = attr.get("required", False)
            default = attr.get("default")
            size = attr.get("size", 255)

            try:
                if attr_type == "string":
                    databases.create_string_attribute(
                        database_id=db_id,
                        collection_id=col_id,
                        key=key,
                        size=size,
                        required=required,
                        default=default,
                    )
                elif attr_type == "integer":
                    databases.create_integer_attribute(
                        database_id=db_id,
                        collection_id=col_id,
                        key=key,
                        required=required,
                        default=default,
                    )
                elif attr_type == "float":
                    databases.create_float_attribute(
                        database_id=db_id,
                        collection_id=col_id,
                        key=key,
                        required=required,
                        default=default,
                    )
                elif attr_type == "boolean":
                    databases.create_boolean_attribute(
                        database_id=db_id,
                        collection_id=col_id,
                        key=key,
                        required=required,
                        default=default,
                    )
                logger.info("  Attribute '%s.%s' declared.", col_id, key)
            except AppwriteException as exc:
                # 409 means attribute already exists
                if exc.code != 409:
                    logger.warning("  Could not create attribute %s on %s: %s", key, col_id, exc)


def provision_storage_buckets(storage: Storage) -> None:
    """Create public, community, and private storage buckets."""
    buckets = [
        {
            "id": appwrite_settings.BUCKET_PUBLIC,
            "name": "ZipRIGHT Public Catalog Media",
            "permissions": [Permission.read(Role.any())],
            "file_security": False,
        },
        {
            "id": appwrite_settings.BUCKET_COMMUNITY,
            "name": "ZipRIGHT Community Posts & Looks",
            "permissions": [Permission.read(Role.users()), Permission.create(Role.users())],
            "file_security": True,
        },
        {
            "id": appwrite_settings.BUCKET_PRIVATE,
            "name": "ZipRIGHT Private Customer Biometrics",
            "permissions": [Permission.create(Role.users())],
            "file_security": True,
        },
    ]

    for b in buckets:
        try:
            storage.get_bucket(bucket_id=b["id"])
            logger.info("Storage bucket '%s' already exists.", b["id"])
        except AppwriteException:
            logger.info("Creating storage bucket '%s'...", b["id"])
            storage.create_bucket(
                bucket_id=b["id"],
                name=b["name"],
                permissions=b["permissions"],
                file_security=b["file_security"],
                maximum_file_size=10 * 1024 * 1024,  # 10MB
                allowed_file_extensions=["jpg", "jpeg", "png", "webp"],
            )
            logger.info("Storage bucket '%s' created successfully.", b["id"])


def run_provisioning() -> None:
    logger.info("Starting Appwrite schema provisioning on endpoint: %s", appwrite_settings.ENDPOINT)
    client = get_appwrite_client()
    databases = Databases(client)
    storage = Storage(client)

    db_id = appwrite_settings.DATABASE_ID
    provision_database(databases, db_id)
    provision_collections(databases, db_id)
    provision_storage_buckets(storage)
    logger.info("Appwrite provisioning completed successfully.")


if __name__ == "__main__":
    run_provisioning()
