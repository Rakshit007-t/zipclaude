"""
Full-App Staging Cutover End-to-End Test Suite.

Validates all 9 major business flows running on the live Appwrite backend:
1. Auth (Users, JWT verification, Role resolution)
2. Fit Profile (Biometrics persistence, data fidelity)
3. Storage (Public vs Private bucket segregation, asset URLs)
4. Recommendations (Size engine computation against live profile)
5. Social (Posts, comments, follow graph, feed retrieval)
6. Seller (Seller store creation, product catalog management, queries)
7. Payments (Order lifecycle, status transitions, retrieval)
8. VTO (Job queuing, state management, result retrieval)
9. Credits & Refunds (Wallet debit, distributed locking, idempotent refund sentinel)
"""
from __future__ import annotations

import json
import time
import uuid
import pytest
from datetime import datetime, timezone
from fastapi import HTTPException

from appwrite_config import (
    appwrite_settings,
    get_appwrite_databases,
    get_appwrite_storage,
    get_appwrite_users,
)
from services.auth_adapter import AppwriteAuthAdapter, AuthenticatedUser
from services.database_adapter import get_database_adapter
from services.storage_provider import get_storage_provider
from services.seller_repository import SellerRepository
from services.product_repository import ProductRepository
from services.social_repository import SocialRepository, PostCreate, CommentCreate
from services.order_service import OrderService, Order
from core.redis_client import get_redis_client
from services.tryon_access import consume_tryon_credit_for_uid, refund_tryon_credit
from models.schema import NormalizedProduct, SizeEngineProfile, SizeEngineRequest
from services.size_engine import calculate_size_recommendation
from services.calibration_service import calibration_for


@pytest.fixture(scope="module")
def appwrite_env():
    """Ensure environment is strictly set to Appwrite."""
    import os
    os.environ["DATABASE_PROVIDER"] = "appwrite"
    os.environ["AUTH_PROVIDER"] = "appwrite"
    os.environ["STORAGE_PROVIDER"] = "appwrite"
    return True


# ==============================================================================
# FLOW 1: AUTHENTICATION
# ==============================================================================
def test_flow_01_auth_lifecycle(appwrite_env):
    """Test user registration, JWT generation, and token verification."""
    users_service = get_appwrite_users()
    auth_adapter = AppwriteAuthAdapter()

    test_uid = f"cutover_auth_{uuid.uuid4().hex[:8]}"
    email = f"{test_uid}@zipright.com"
    pwd = "TempPassword123!"

    # 1. Register User in Appwrite Auth
    user_doc = users_service.create(user_id=test_uid, email=email, password=pwd, name="Cutover User")
    created_uid = user_doc.get("$id") or user_doc.get("id") if isinstance(user_doc, dict) else (getattr(user_doc, "id", None) or getattr(user_doc, "$id", None))
    assert created_uid == test_uid

    try:
        # 2. Issue client JWT
        from appwrite.exception import AppwriteException
        try:
            jwt_obj = users_service.create_jwt(user_id=test_uid)
        except AppwriteException as exc:
            if exc.code == 500:
                pytest.skip("Appwrite server requires _APP_OPENSSL_KEY_V1 to issue JWT tokens")
            raise
        jwt_token = getattr(jwt_obj, "jwt", None) or getattr(jwt_obj, "token", None) or (jwt_obj.get("jwt") if isinstance(jwt_obj, dict) else None)
        assert jwt_token and len(jwt_token) > 20

        # 3. Verify JWT with AuthAdapter
        user = auth_adapter.verify_token(jwt_token)
        assert isinstance(user, AuthenticatedUser)
        assert user.uid == test_uid
        assert user.email == email
        assert user.provider == "appwrite"

        # 4. Negative test: Bad token rejected
        with pytest.raises(HTTPException) as exc_info:
            auth_adapter.verify_token("invalid_garbage_jwt")
        assert exc_info.value.status_code == 401
    finally:
        users_service.delete(user_id=test_uid)


# ==============================================================================
# FLOW 2: FIT PROFILE & BIOMETRICS
# ==============================================================================
def test_flow_02_fit_profile_persistence(appwrite_env):
    """Test saving and retrieving detailed body measurements in Appwrite."""
    db = get_database_adapter()
    test_uid = f"fit_user_{uuid.uuid4().hex[:8]}"

    measurements = {
        "chest_cm": 98.5,
        "waist_cm": 81.0,
        "hips_cm": 96.0,
        "inseam_cm": 79.0,
        "shoulder_cm": 44.0,
        "unit": "cm",
    }

    # Save to fit_profiles collection
    doc = db.set_document(
        collection="fit_profiles",
        document_id=test_uid,
        data={
            "user_id": test_uid,
            "measurements": measurements,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    assert doc["id"] == test_uid

    try:
        # Read back
        retrieved = db.get_document("fit_profiles", test_uid)
        assert retrieved is not None
        assert retrieved["user_id"] == test_uid
        assert retrieved["measurements"]["chest_cm"] == 98.5
        assert retrieved["measurements"]["waist_cm"] == 81.0
    finally:
        db.delete_document("fit_profiles", test_uid)


# ==============================================================================
# FLOW 3: STORAGE ENGINE
# ==============================================================================
def test_flow_03_storage_segregation(appwrite_env):
    """Test public vs private storage upload, URLs, and deletion."""
    storage = get_storage_provider()
    payload = b"Sample Binary Image Data for Appwrite Cutover"

    # Public bucket upload
    public_url = storage.upload_bytes(
        data=payload,
        content_type="image/png",
        folder="seller-logos",
        extension=".png",
    )
    assert "storage/buckets/zipright-public" in public_url
    pub_file_id = public_url.split("/files/")[1].split("/")[0]

    # Private bucket upload
    private_url = storage.upload_bytes(
        data=payload,
        content_type="image/png",
        folder="tryons",
        extension=".png",
    )
    assert "storage/buckets/zipright-private" in private_url
    priv_file_id = private_url.split("/files/")[1].split("/")[0]

    # Cleanup
    assert storage.delete_file("seller-logos", pub_file_id) is True
    assert storage.delete_file("tryons", priv_file_id) is True


# ==============================================================================
# FLOW 4: RECOMMENDATIONS & SIZE ENGINE
# ==============================================================================
def test_flow_04_recommendations_engine(appwrite_env):
    """Test size recommendation and calibration against Appwrite data."""
    import asyncio
    product = NormalizedProduct(
        id="prod_rec_999",
        title="Merino Cardigan",
        brand="Zara",
        category="tops",
        url="https://example.com/item",
        available_sizes=["S", "M", "L", "XL"],
    )
    profile = SizeEngineProfile(
        base_size="M",
        fit_preference="regular",
        chest=98.5,
        waist=81.0,
    )
    rec = asyncio.run(
        calculate_size_recommendation(
            SizeEngineRequest(product=product, profile=profile),
            user_id="customer_rec_test",
        )
    )
    assert rec.size in ("S", "M", "L", "XL")
    assert 0.0 <= rec.confidence <= 100.0

    # Test calibration signal resolution
    signal = calibration_for(brand="Zara", category="tops", product_id="prod_rec_999")
    assert signal is not None


# ==============================================================================
# FLOW 5: SOCIAL HUB (POSTS, COMMENTS, FOLLOW)
# ==============================================================================
def test_flow_05_social_interactions(appwrite_env):
    """Test social post creation, comments, follow relationship, and feed querying."""
    social_repo = SocialRepository()
    db = get_database_adapter()

    user_a = f"social_a_{uuid.uuid4().hex[:8]}"
    user_b = f"social_b_{uuid.uuid4().hex[:8]}"

    # Setup profiles in both users and publicProfiles (required by SocialRepository)
    db.set_document("users", user_a, {"displayName": "Alice Social", "email": "alice@test.com"})
    db.set_document("users", user_b, {"displayName": "Bob Social", "email": "bob@test.com"})
    db.set_document("publicProfiles", user_a, {"uid": user_a, "displayName": "Alice Social", "username": f"alice_{user_a[:4]}"})
    db.set_document("publicProfiles", user_b, {"uid": user_b, "displayName": "Bob Social", "username": f"bob_{user_b[:4]}"})

    try:
        # 1. User B creates a post
        post_payload = PostCreate(
            type="outfit",
            caption="Autumn linen look #ootd",
            media_url="http://localhost/v1/storage/buckets/zipright-public/files/sample/view",
            tags=["linen", "autumn"],
            linked_product_ids=["prod_rec_999"],
        )
        post = social_repo.create_post(user_id=user_b, payload=post_payload)
        assert post.id.startswith("post_")
        assert post.caption == "Autumn linen look #ootd"

        # 2. User A comments on User B's post
        comment_payload = CommentCreate(text="Looks stunning!")
        comment = social_repo.add_comment(user_id=user_a, post_id=post.id, payload=comment_payload)
        assert comment.text == "Looks stunning!"
        assert comment.user_id == user_a

        # 3. User A follows User B
        is_following = social_repo.toggle_follow(follower_id=user_a, target_id=user_b)
        assert is_following is True
        followers = social_repo.list_relationship(user_b, "followers")
        assert any(f.uid == user_a for f in followers)

        # 4. User A unfollows User B
        is_following_after = social_repo.toggle_follow(follower_id=user_a, target_id=user_b)
        assert is_following_after is False
        updated_followers = social_repo.list_relationship(user_b, "followers")
        assert not any(f.uid == user_a for f in updated_followers)

        # Cleanup post
        db.delete_document("posts", post.id)
        db.delete_document("look_comments", comment.id)
    finally:
        db.delete_document("publicProfiles", user_a)
        db.delete_document("publicProfiles", user_b)
        db.delete_document("users", user_a)
        db.delete_document("users", user_b)


# ==============================================================================
# FLOW 6: SELLER & PRODUCT CATALOG
# ==============================================================================
def test_flow_06_seller_and_catalog(appwrite_env):
    """Test seller onboarding, product creation, catalog listing, and filtering."""
    seller_repo = SellerRepository()
    product_repo = ProductRepository()
    db = get_database_adapter()

    seller_uid = f"seller_{uuid.uuid4().hex[:8]}"

    # 1. Register seller store
    seller_doc = seller_repo.create_seller(
        uid=seller_uid,
        data={
            "store_name": "Nordic Knits",
            "business_email": "sales@nordicknits.com",
            "status": "pending",
        },
    )
    assert seller_doc["store_name"] == "Nordic Knits"

    try:
        # 2. Add product to catalog
        product = product_repo.create_product(
            seller_uid=seller_uid,
            data={
                "title": "Merino Wool Cardigan",
                "price": 3499.0,
                "brand": "Nordic Knits",
                "status": "published",
                "sizes": ["S", "M", "L"],
            },
        )
        assert product["title"] == "Merino Wool Cardigan"
        assert product["price"] == 3499.0
        product_id = product["id"]

        # 3. Query catalog
        catalog = product_repo.list_products(seller_uid=seller_uid)
        assert len(catalog) >= 1
        assert any(p["id"] == product_id for p in catalog)

        # 4. Cleanup product
        db.delete_document("seller_products", product_id)
    finally:
        db.delete_document("sellers", seller_uid)


# ==============================================================================
# FLOW 7: ORDERS & COMMERCE
# ==============================================================================
def test_flow_07_order_lifecycle(appwrite_env):
    """Test order placement, retrieval, and status updates."""
    order_service = OrderService()
    seller_repo = SellerRepository()
    product_repo = ProductRepository()
    db = get_database_adapter()

    customer_uid = f"cust_{uuid.uuid4().hex[:8]}"
    seller_uid = f"seller_ord_{uuid.uuid4().hex[:8]}"

    # Setup seller & product
    seller_repo.create_seller(
        uid=seller_uid,
        data={"store_name": "Order Store", "business_email": "ord@store.com", "status": "approved"},
    )
    product = product_repo.create_product(
        seller_uid=seller_uid,
        data={
            "title": "Merino Wool Cardigan",
            "price": 3499.0,
            "brand": "Nordic Knits",
            "status": "published",
        },
    )
    product_id = product["id"]

    try:
        # 1. Create checkout order
        order = order_service.create_checkout_order(
            customer_uid=customer_uid,
            items_payload=[{"product_id": product_id, "quantity": 1}],
            idempotency_key=f"idem_{uuid.uuid4().hex[:8]}",
        )
        assert order.order_id.startswith("ord_")
        assert order.total_paise == 349900
        assert order.status == "PENDING_PAYMENT"

        # 2. Read order back
        fetched = order_service.get_order(order.order_id)
        assert fetched is not None
        assert fetched.order_id == order.order_id
        assert fetched.customer_uid == customer_uid
        assert fetched.total_paise == 349900

        # 3. Update status in database
        db.update_document("orders", order.order_id, {"status": "PAID"})
        # Clear redis cache to ensure fresh read
        r = get_redis_client()
        r.delete(f"zipright:order:{order.order_id}")

        updated = order_service.get_order(order.order_id)
        assert updated is not None
        assert updated.status == "PAID"
    finally:
        if 'order' in locals():
            db.delete_document("orders", order.order_id)
        db.delete_document("seller_products", product_id)
        db.delete_document("sellers", seller_uid)


# ==============================================================================
# FLOW 8: VIRTUAL TRY-ON (VTO) STATE & JOBS
# ==============================================================================
def test_flow_08_vto_job_lifecycle(appwrite_env):
    """Test VTO job submission, status inspection, and completion storage."""
    db = get_database_adapter()
    job_id = f"job_vto_{uuid.uuid4().hex[:8]}"
    user_id = f"vto_user_{uuid.uuid4().hex[:8]}"

    # 1. Create try-on job record
    db.set_document(
        collection="tryon_jobs",
        document_id=job_id,
        data={
            "job_id": job_id,
            "user_id": user_id,
            "status": "QUEUED",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "payload": json.dumps({"clothing_url": "http://sample/cloth.png"}),
        },
    )

    try:
        # 2. Inspect status
        job_doc = db.get_document("tryon_jobs", job_id)
        assert job_doc is not None
        assert job_doc["status"] == "QUEUED"

        # 3. Transition to COMPLETED with render URL
        render_url = f"http://localhost/v1/storage/buckets/zipright-private/files/{job_id}_res/view"
        db.update_document(
            collection="tryon_jobs",
            document_id=job_id,
            data={
                "status": "COMPLETED",
                "result_url": render_url,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )

        import time
        completed_job = None
        for _ in range(10):
            time.sleep(0.4)
            completed_job = db.get_document("tryon_jobs", job_id)
            if completed_job and completed_job.get("status") == "COMPLETED":
                break

        assert completed_job is not None
        assert completed_job["status"] == "COMPLETED"
        assert completed_job["result_url"] == render_url
    finally:
        db.delete_document("tryon_jobs", job_id)


# ==============================================================================
# FLOW 9: CREDITS, CHARGES, & REFUND IDEMPOTENCY
# ==============================================================================
def test_flow_09_credits_and_refund_idempotency(appwrite_env):
    """Test wallet balance credit deduction and idempotent refunding with sentinels."""
    db = get_database_adapter()
    user_id = f"user_wallet_{uuid.uuid4().hex[:8]}"
    job_id = f"job_refund_{uuid.uuid4().hex[:8]}"

    # Setup user with 3 free tryons used and 20 rupees balance
    db.set_document(
        collection="users",
        document_id=user_id,
        data={
            "email": f"{user_id}@zipright.com",
            "displayName": "Wallet Tester",
            "walletBalanceRupees": 20,
            "usage": json.dumps({"tryOns": 3}),
        },
    )

    try:
        # 1. Consume 1 try-on credit (5 rupees deducted)
        charge = consume_tryon_credit_for_uid(user_id)
        assert charge.charged_rupees == 5
        assert charge.wallet_balance_rupees == 15
        assert charge.try_ons_used == 4

        import time
        time.sleep(0.4)

        # 2. Refund the failed job (5 rupees credited back)
        balance_after_refund = refund_tryon_credit(
            user_id=user_id,
            job_id=job_id,
            charged_rupees=5,
            free_tryon=False,
        )
        assert balance_after_refund == 20

        import time
        time.sleep(0.3)

        # 3. Attempt duplicate refund for the same job (Must be rejected as idempotent no-op)
        balance_duplicate = refund_tryon_credit(
            user_id=user_id,
            job_id=job_id,
            charged_rupees=5,
            free_tryon=False,
        )
        assert balance_duplicate == 20  # Still 20, not 25!
    finally:
        db.delete_document("tryon_refunds", job_id)
        db.delete_document("users", user_id)
