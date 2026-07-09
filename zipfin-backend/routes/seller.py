"""Seller Dashboard REST API (Phase 3).

Every seller capability goes through this router — the frontend never
touches seller Firestore collections directly. Requires a real Firebase
login (get_current_user): demo-anonymous sessions cannot be sellers.

M0 scope: identity/status only. Onboarding, products, analytics and API
keys arrive in later milestones on the same foundations
(SellerRepository + require_active_seller).
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from firebase_admin import firestore as firebase_firestore

from core.api import success_response
from models.schema import ApiResponse
from models.seller_schema import (
    ProductImportRequest,
    ProductPreview,
    SellerMeResponse,
    SellerOnboardRequest,
    SellerProduct,
    SellerProductCreate,
    SellerProfile,
    SellerProfileUpdateRequest,
    SellerStatusUpdateRequest,
    SellerProductUpdate,
    BulkOperationRequest,
    PopularProductMetric,
    ActivityEvent,
    SellerDashboardResponse,
    SellerIntegrationConnectRequest,
    SellerIntegrationResponse,
    SyncHistoryEvent,
)
import re
from services.admin_auth import require_admin
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.product_import import ProductImportService, get_product_import_service
from services.product_repository import SellerProductRepository, get_product_repository
from services.seller_auth import SellerContext, require_active_seller, require_seller
from services.seller_repository import (
    SellerAlreadyExistsError,
    SellerRepository,
    get_seller_repository,
)
from services.storage_provider import StorageProvider, get_storage_provider
from firebase_config import get_firestore_client

router = APIRouter(prefix="/seller", tags=["seller"])
logger = logging.getLogger(__name__)

MAX_LOGO_BYTES = 5 * 1024 * 1024
_LOGO_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}
# Profile edits (and logo upload) are blocked once an account is rejected or
# suspended — those are terminal admin states, not self-editable.
_EDITABLE_STATUSES = {"pending", "active"}


@router.get(
    "/me",
    response_model=ApiResponse[SellerMeResponse],
    status_code=status.HTTP_200_OK,
)
async def seller_me(
    current_user: AuthenticatedUser = Depends(get_current_user),
    repository: SellerRepository = Depends(get_seller_repository),
) -> ApiResponse[SellerMeResponse]:
    """Where the caller stands in the seller lifecycle.

    Never 403s: shoppers use this to decide whether to show onboarding,
    pending sellers to show the review banner.
    """
    record = await asyncio.to_thread(repository.get_seller, current_user.uid)

    if record is None:
        return success_response(
            message="Not a seller yet.",
            data=SellerMeResponse(is_seller=False, status=None, profile=None),
        )

    profile = SellerProfile.model_validate(record)
    return success_response(
        message="Seller profile found.",
        data=SellerMeResponse(
            is_seller=profile.status == "active",
            status=profile.status,
            profile=profile,
        ),
    )


@router.post(
    "/onboard",
    response_model=ApiResponse[SellerProfile],
    status_code=status.HTTP_201_CREATED,
)
async def onboard_seller(
    payload: SellerOnboardRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    repository: SellerRepository = Depends(get_seller_repository),
) -> ApiResponse[SellerProfile]:
    """Create a seller profile in status "pending" (never auto-activated).

    Requires a real Firebase login and accepted terms. One profile per uid.
    """
    data = {
        "store_name": payload.store_name.strip(),
        "contact_name": payload.contact_name.strip(),
        "email": payload.email.strip(),
        "phone": payload.phone.strip(),
        "website": (payload.website or "").strip() or None,
        "gst": (payload.gst or "").strip() or None,
        "brand_description": (payload.brand_description or "").strip() or None,
        "terms_accepted_at": firebase_firestore.SERVER_TIMESTAMP,
    }
    try:
        record = await asyncio.to_thread(repository.create_seller, current_user.uid, data)
    except SellerAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "A seller profile already exists for this account.",
                "details": {"code": "seller_exists"},
            },
        ) from exc

    logger.info("Seller onboarded (pending): uid=%s store=%s", current_user.uid, payload.store_name)
    return success_response(
        message="Seller application submitted and pending review.",
        data=SellerProfile.model_validate(record),
    )


@router.get(
    "/profile",
    response_model=ApiResponse[SellerProfile],
    status_code=status.HTTP_200_OK,
)
async def get_seller_profile(
    context: SellerContext = Depends(require_seller),
) -> ApiResponse[SellerProfile]:
    return success_response(
        message="Seller profile.",
        data=SellerProfile.model_validate(context.seller),
    )


@router.patch(
    "/profile",
    response_model=ApiResponse[SellerProfile],
    status_code=status.HTTP_200_OK,
)
async def update_seller_profile(
    payload: SellerProfileUpdateRequest,
    context: SellerContext = Depends(require_seller),
    repository: SellerRepository = Depends(get_seller_repository),
) -> ApiResponse[SellerProfile]:
    _require_editable(context)
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return success_response(
            message="No changes provided.",
            data=SellerProfile.model_validate(context.seller),
        )
    updated = await asyncio.to_thread(repository.update_seller, context.uid, changes)
    if updated is None:  # pragma: no cover - context guarantees existence
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seller not found.")
    return success_response(
        message="Seller profile updated.",
        data=SellerProfile.model_validate(updated),
    )


@router.post(
    "/profile/logo",
    response_model=ApiResponse[SellerProfile],
    status_code=status.HTTP_200_OK,
)
async def upload_seller_logo(
    file: UploadFile = File(...),
    context: SellerContext = Depends(require_seller),
    repository: SellerRepository = Depends(get_seller_repository),
    storage: StorageProvider = Depends(get_storage_provider),
) -> ApiResponse[SellerProfile]:
    _require_editable(context)
    extension = _LOGO_EXTENSIONS.get((file.content_type or "").lower())
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Logo must be a PNG, JPEG, or WebP image.",
        )
    data = await file.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Empty file.")
    if len(data) > MAX_LOGO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Logo must be 5 MB or smaller.",
        )

    url = await asyncio.to_thread(
        storage.upload_bytes,
        data,
        content_type=file.content_type or "image/png",
        folder="seller-logos",
        extension=extension,
    )
    updated = await asyncio.to_thread(
        repository.update_seller, context.uid, {"brand_logo_url": url}
    )
    if updated is None:  # pragma: no cover
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Seller not found.")
    return success_response(
        message="Brand logo updated.",
        data=SellerProfile.model_validate(updated),
    )


@router.patch(
    "/{uid}/status",
    response_model=ApiResponse[SellerProfile],
    status_code=status.HTTP_200_OK,
)
async def set_seller_status(
    uid: str,
    payload: SellerStatusUpdateRequest,
    admin: AuthenticatedUser = Depends(require_admin),
    repository: SellerRepository = Depends(get_seller_repository),
) -> ApiResponse[SellerProfile]:
    """Admin-only lifecycle transition (approve / reject / suspend)."""
    updated = await asyncio.to_thread(repository.set_seller_status, uid, payload.status)
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Seller not found.",
        )
    logger.info(
        "Admin %s set seller %s -> %s (reason=%s)",
        admin.uid,
        uid,
        payload.status,
        payload.reason or "",
    )
    return success_response(
        message=f"Seller status set to {payload.status}.",
        data=SellerProfile.model_validate(updated),
    )


@router.get(
    "",
    response_model=ApiResponse[list[SellerProfile]],
    status_code=status.HTTP_200_OK,
)
async def list_sellers(
    status: str | None = None,
    admin: AuthenticatedUser = Depends(require_admin),
    repository: SellerRepository = Depends(get_seller_repository),
) -> ApiResponse[list[SellerProfile]]:
    """Admin-only list of all seller profiles (optionally filtered by status)."""
    records = await asyncio.to_thread(repository.list_sellers, status=status)
    profiles = [SellerProfile.model_validate(rec) for rec in records]
    return success_response(
        message="Sellers fetched successfully.",
        data=profiles,
    )



@router.post(
    "/products/import",
    response_model=ApiResponse[ProductPreview],
    status_code=status.HTTP_200_OK,
)
async def import_product(
    payload: ProductImportRequest,
    context: SellerContext = Depends(require_active_seller),
    service: ProductImportService = Depends(get_product_import_service),
) -> ApiResponse[ProductPreview]:
    """Extract a product from a URL or images into the unified schema.

    Returns a preview only — nothing is saved until the seller approves via
    POST /seller/products. Estimated fields are listed in generated_fields.
    """
    preview = await asyncio.to_thread(service.import_preview, payload)
    return success_response(
        message="Product imported for review.",
        data=preview,
    )


@router.post(
    "/products",
    response_model=ApiResponse[SellerProduct],
    status_code=status.HTTP_201_CREATED,
)
async def create_product(
    payload: SellerProductCreate,
    context: SellerContext = Depends(require_active_seller),
    repository: SellerProductRepository = Depends(get_product_repository),
) -> ApiResponse[SellerProduct]:
    """Persist a seller-approved product (with any edits they made)."""
    record = await asyncio.to_thread(
        repository.create_product, context.uid, payload.model_dump()
    )
    logger.info("Seller %s created product %s", context.uid, record.get("id"))
    return success_response(
        message="Product saved.",
        data=SellerProduct.model_validate(record),
    )


@router.get(
    "/products",
    response_model=ApiResponse[list[SellerProduct]],
    status_code=status.HTTP_200_OK,
)
async def list_products(
    query: str | None = None,
    category: str | None = None,
    brand: str | None = None,
    status_filter: str | None = None,
    context: SellerContext = Depends(require_active_seller),
    repository: SellerProductRepository = Depends(get_product_repository),
) -> ApiResponse[list[SellerProduct]]:
    """List, search, and filter products owned by the active seller."""
    records = await asyncio.to_thread(
        repository.list_products,
        context.uid,
        query=query,
        category=category,
        brand=brand,
        status=status_filter,
    )
    return success_response(
        message="Products retrieved successfully.",
        data=[SellerProduct.model_validate(r) for r in records],
    )


@router.get(
    "/products/{product_id}",
    response_model=ApiResponse[SellerProduct],
    status_code=status.HTTP_200_OK,
)
async def get_product(
    product_id: str,
    context: SellerContext = Depends(require_active_seller),
    repository: SellerProductRepository = Depends(get_product_repository),
) -> ApiResponse[SellerProduct]:
    """Retrieve details of a single seller product."""
    record = await asyncio.to_thread(repository.get_product, product_id)
    if not record or record.get("seller_uid") != context.uid:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found or not owned by this seller.",
        )
    return success_response(
        message="Product details retrieved.",
        data=SellerProduct.model_validate(record),
    )


@router.patch(
    "/products/{product_id}",
    response_model=ApiResponse[SellerProduct],
    status_code=status.HTTP_200_OK,
)
async def update_product(
    product_id: str,
    payload: SellerProductUpdate,
    context: SellerContext = Depends(require_active_seller),
    repository: SellerProductRepository = Depends(get_product_repository),
) -> ApiResponse[SellerProduct]:
    """Update editable fields of an existing seller product."""
    try:
        record = await asyncio.to_thread(
            repository.update_product,
            product_id,
            context.uid,
            payload.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        if str(exc) == "concurrency_conflict":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This product was updated by another session. Please reload and try again.",
            )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found or not owned by this seller.",
        )
    return success_response(
        message="Product updated successfully.",
        data=SellerProduct.model_validate(record),
    )


@router.delete(
    "/products/{product_id}",
    response_model=ApiResponse[dict[str, bool]],
    status_code=status.HTTP_200_OK,
)
async def delete_product(
    product_id: str,
    context: SellerContext = Depends(require_active_seller),
    repository: SellerProductRepository = Depends(get_product_repository),
) -> ApiResponse[dict[str, bool]]:
    """Delete a seller product."""
    deleted = await asyncio.to_thread(repository.delete_product, product_id, context.uid)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found or not owned by this seller.",
        )
    return success_response(
        message="Product deleted successfully.",
        data={"deleted": True},
    )


@router.post(
    "/products/bulk",
    response_model=ApiResponse[dict[str, int]],
    status_code=status.HTTP_200_OK,
)
async def bulk_operation(
    payload: BulkOperationRequest,
    context: SellerContext = Depends(require_active_seller),
    repository: SellerProductRepository = Depends(get_product_repository),
) -> ApiResponse[dict[str, int]]:
    """Perform bulk archive, restore, or delete operations on seller products."""
    count = 0
    for product_id in payload.ids:
        if payload.operation == "delete":
            deleted = await asyncio.to_thread(repository.delete_product, product_id, context.uid)
            if deleted:
                count += 1
        elif payload.operation in ("archive", "restore"):
            status_val = "archived" if payload.operation == "archive" else "active"
            updated = await asyncio.to_thread(
                repository.update_product,
                product_id,
                context.uid,
                {"status": status_val},
            )
            if updated:
                count += 1
    return success_response(
        message=f"Bulk {payload.operation} completed.",
        data={"count": count},
    )


@router.post(
    "/products/{product_id}/duplicate",
    response_model=ApiResponse[SellerProduct],
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_product(
    product_id: str,
    context: SellerContext = Depends(require_active_seller),
    repository: SellerProductRepository = Depends(get_product_repository),
) -> ApiResponse[SellerProduct]:
    """Create a duplicate clone of a product with a modified title."""
    product = await asyncio.to_thread(repository.get_product, product_id)
    if not product or product.get("seller_uid") != context.uid:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found or not owned by this seller.",
        )
    
    cloned_data = {
        key: value
        for key, value in product.items()
        if key not in {"id", "seller_uid", "created_at", "updated_at", "updated_by"}
    }
    cloned_data["title"] = f"{cloned_data.get('title', '')} Copy"
    
    record = await asyncio.to_thread(
        repository.create_product, context.uid, cloned_data
    )
    return success_response(
        message="Product duplicated successfully.",
        data=SellerProduct.model_validate(record),
    )


@router.post(
    "/products/upload-image",
    response_model=ApiResponse[dict[str, str]],
    status_code=status.HTTP_201_CREATED,
)
async def upload_product_image(
    file: UploadFile = File(...),
    context: SellerContext = Depends(require_active_seller),
    storage: StorageProvider = Depends(get_storage_provider),
) -> ApiResponse[dict[str, str]]:
    """Upload a product image to storage and return the URL."""
    if file.content_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image format. Only JPEG, PNG, and WebP are allowed.",
        )
    
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image file size exceeds maximum limit of 5MB.",
        )
        
    extension = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
    }.get(file.content_type or "image/png", ".png")
    
    url = await asyncio.to_thread(
        storage.upload_bytes,
        data,
        content_type=file.content_type or "image/png",
        folder="seller-products",
        extension=extension,
    )
    return success_response(
        message="Product image uploaded successfully.",
        data={"url": url},
    )


@router.get(
    "/dashboard",
    response_model=ApiResponse[SellerDashboardResponse],
    status_code=status.HTTP_200_OK,
)
async def get_seller_dashboard(
    context: SellerContext = Depends(require_active_seller),
    repository: SellerProductRepository = Depends(get_product_repository),
    db = Depends(get_firestore_client),
) -> ApiResponse[SellerDashboardResponse]:
    """Get aggregated metrics and analytics for the active seller dashboard."""
    try:
        store_name = context.seller.get("store_name", "")
        normalized_store_name = re.sub(r"[^a-z0-9]", "", store_name.lower())
        
        # 1. Fetch seller's products
        products = await asyncio.to_thread(repository.list_products, context.uid, status="all")
        total_products = len(products)
        active_products = sum(1 for p in products if p.get("status") == "active")
        archived_products = sum(1 for p in products if p.get("status") == "archived")
        
        # 2. Fetch try-on count
        tryons_snap = await asyncio.to_thread(
            lambda: db.collection("tryon_events").where("seller_uid", "==", context.uid).get()
        )
        total_tryons = len(tryons_snap)
        
        # 3. Fetch size recommendations
        recs_snap = await asyncio.to_thread(
            lambda: db.collection("recommendation_generated_events").where("normalizedBrand", "==", normalized_store_name).get()
        )
        total_recs = len(recs_snap)
        
        # 4. Fetch size feedback
        feedback_snap = await asyncio.to_thread(
            lambda: db.collection("size_feedback").where("brand", "==", store_name).get()
        )
        feedback_count = len(feedback_snap)
        
        # 5. Populate product-level metrics for popular products
        tryon_counts = {}
        for snap in tryons_snap:
            doc = snap.to_dict() or {}
            p_id = doc.get("product_id")
            if p_id:
                tryon_counts[p_id] = tryon_counts.get(p_id, 0) + 1
                
        rec_counts = {}
        for snap in recs_snap:
            doc = snap.to_dict() or {}
            title = doc.get("productTitle", "").strip().lower()
            if title:
                rec_counts[title] = rec_counts.get(title, 0) + 1
                
        feedback_counts = {}
        feedback_positive = {}
        for snap in feedback_snap:
            doc = snap.to_dict() or {}
            p_id = doc.get("product_id")
            if p_id:
                feedback_counts[p_id] = feedback_counts.get(p_id, 0) + 1
                if doc.get("outcome") == "kept":
                    feedback_positive[p_id] = feedback_positive.get(p_id, 0) + 1

        popular_products = []
        for p in products:
            p_id = p.get("id")
            p_title = p.get("title", "")
            
            p_tryons = tryon_counts.get(p_id, 0)
            p_recs = rec_counts.get(p_title.strip().lower(), 0)
            p_feedbacks = feedback_counts.get(p_id, 0)
            
            p_pos = feedback_positive.get(p_id, 0)
            accuracy = (p_pos / p_feedbacks) * 100 if p_feedbacks > 0 else None
            
            popular_products.append(
                PopularProductMetric(
                    id=p_id,
                    title=p_title,
                    tryon_count=p_tryons,
                    recommendation_count=p_recs,
                    feedback_count=p_feedbacks,
                    accuracy=accuracy,
                )
            )
            
        popular_products.sort(key=lambda x: (x.tryon_count + x.recommendation_count + x.feedback_count), reverse=True)
        popular_products = popular_products[:5]
        
        # 6. Chronological events feed
        activity_events = []
        
        for p in products:
            p_id = p.get("id")
            p_title = p.get("title", "")
            
            # Product Created/Imported
            created_at = p.get("created_at")
            if created_at:
                activity_events.append(
                    ActivityEvent(
                        id=f"{p_id}_created",
                        type="product_created",
                        text=f"Product '{p_title}' was successfully created.",
                        timestamp=created_at,
                    )
                )
                
            # Product Edited
            updated_at = p.get("updated_at")
            if updated_at and updated_at != created_at:
                action_text = f"Product '{p_title}' details were updated."
                if p.get("status") == "archived":
                    action_text = f"Product '{p_title}' was archived."
                elif p.get("updated_by") and "Copy" in p_title:
                    action_text = f"Product '{p_title}' was duplicated."
                
                activity_events.append(
                    ActivityEvent(
                        id=f"{p_id}_updated_{updated_at}",
                        type="product_archived" if p.get("status") == "archived" else "product_edited",
                        text=action_text,
                        timestamp=updated_at,
                    )
                )
                
        # Feedback Events
        for snap in feedback_snap:
            doc = snap.to_dict() or {}
            outcome = doc.get("outcome", "kept")
            p_title = doc.get("product_title") or "garment"
            created_at = doc.get("created_at")
            
            ts_str = str(created_at) if created_at else ""
            if not ts_str or ts_str == "None":
                ts_str = doc.get("clientTimestamp") or ""
                
            activity_events.append(
                ActivityEvent(
                    id=f"{snap.id}_feedback",
                    type="feedback_received",
                    text=f"Received sizing feedback for '{p_title}': outcome was {outcome.replace('_', ' ')}.",
                    timestamp=ts_str,
                )
            )
            
        activity_events = [e for e in activity_events if e.timestamp]
        activity_events.sort(key=lambda x: x.timestamp, reverse=True)
        recent_activity = activity_events[:10]
        
        return success_response(
            message="Dashboard statistics retrieved successfully.",
            data=SellerDashboardResponse(
                total_products=total_products,
                active_products=active_products,
                archived_products=archived_products,
                total_tryons=total_tryons,
                total_recs=total_recs,
                feedback_count=feedback_count,
                popular_products=popular_products,
                recent_activity=recent_activity,
            )
        )
    except Exception as exc:
        logger.exception("Failed to aggregate seller dashboard: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve dashboard analytics.",
        )


from services.ecommerce_service import EcommerceService

def get_ecommerce_service(db = Depends(get_firestore_client)) -> EcommerceService:
    return EcommerceService(db)


@router.post(
    "/integration/connect",
    response_model=ApiResponse[SellerIntegrationResponse],
    status_code=status.HTTP_200_OK,
)
async def connect_integration(
    payload: SellerIntegrationConnectRequest,
    context: SellerContext = Depends(require_active_seller),
    service: EcommerceService = Depends(get_ecommerce_service),
) -> ApiResponse[SellerIntegrationResponse]:
    """Connect a Shopify, WooCommerce, or Generic REST store to ZipRIGHT."""
    try:
        await asyncio.to_thread(service.connect_store, context.uid, payload)
        status_res = await asyncio.to_thread(service.get_integration_status, context.uid)
        return success_response(
            message=f"Successfully connected to {payload.platform} store.",
            data=status_res,
        )
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err),
        )
    except Exception as exc:
        logger.exception("Failed to connect e-commerce integration: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to establish e-commerce connection.",
        )


@router.post(
    "/integration/disconnect",
    response_model=ApiResponse[dict[str, bool]],
    status_code=status.HTTP_200_OK,
)
async def disconnect_integration(
    context: SellerContext = Depends(require_active_seller),
    service: EcommerceService = Depends(get_ecommerce_service),
) -> ApiResponse[dict[str, bool]]:
    """Disconnect active e-commerce store integration."""
    disconnected = await asyncio.to_thread(service.disconnect_store, context.uid)
    if not disconnected:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No store integration found to disconnect.",
        )
    return success_response(
        message="Successfully disconnected store.",
        data={"disconnected": True},
    )


@router.get(
    "/integration/status",
    response_model=ApiResponse[SellerIntegrationResponse | None],
    status_code=status.HTTP_200_OK,
)
async def get_integration_status(
    context: SellerContext = Depends(require_active_seller),
    service: EcommerceService = Depends(get_ecommerce_service),
) -> ApiResponse[SellerIntegrationResponse | None]:
    """Retrieve integration connection state and last sync outcomes."""
    status_res = await asyncio.to_thread(service.get_integration_status, context.uid)
    return success_response(
        message="Integration status retrieved.",
        data=status_res,
    )


@router.post(
    "/integration/sync",
    response_model=ApiResponse[dict[str, int]],
    status_code=status.HTTP_200_OK,
)
async def trigger_manual_sync(
    context: SellerContext = Depends(require_active_seller),
    service: EcommerceService = Depends(get_ecommerce_service),
    repository: SellerProductRepository = Depends(get_product_repository),
) -> ApiResponse[dict[str, int]]:
    """Manually pull e-commerce store catalog items and normalize as products."""
    try:
        count = await asyncio.to_thread(service.trigger_sync, context.uid, repository)
        return success_response(
            message="Manual catalog synchronization completed successfully.",
            data={"synced_count": count},
        )
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err),
        )
    except Exception as exc:
        logger.exception("Failed to run store sync: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Sync failed. Check credentials and credentials configuration.",
        )


@router.get(
    "/integration/history",
    response_model=ApiResponse[list[SyncHistoryEvent]],
    status_code=status.HTTP_200_OK,
)
async def get_sync_history(
    context: SellerContext = Depends(require_active_seller),
    service: EcommerceService = Depends(get_ecommerce_service),
) -> ApiResponse[list[SyncHistoryEvent]]:
    """Retrieve previous catalog synchronization log streams."""
    history = await asyncio.to_thread(service.get_sync_history, context.uid)
    return success_response(
        message="Sync history retrieved successfully.",
        data=history,
    )


def _require_editable(context: SellerContext) -> None:
    if str(context.seller.get("status", "")) not in _EDITABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "This seller account cannot be edited.",
                "details": {"code": "seller_locked"},
            },
        )
