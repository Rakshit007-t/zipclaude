"""Pydantic models for the Seller domain (Phase 3).

Kept separate from models/schema.py so the frozen shopper-facing schemas are
never touched. All seller functionality is backend-REST: the frontend never
reads or writes seller Firestore collections directly.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SellerStatus = Literal["pending", "active", "rejected", "suspended"]

SELLER_STATUSES: tuple[str, ...] = ("pending", "active", "rejected", "suspended")
# Transitions an admin may drive; "pending" is the system-set initial state.
ADMIN_SETTABLE_STATUSES = ("active", "rejected", "suspended")


def _looks_like_email(value: str) -> bool:
    stripped = value.strip()
    return "@" in stripped and "." in stripped.split("@")[-1]


class SellerProfile(BaseModel):
    """Public shape of a sellers/{uid} document.

    extra="ignore" is a deliberate security boundary, not just tidiness:
    future/internal Firestore fields (bank details, verification documents,
    KYC state) can be stored on the seller doc without ever leaking into this
    public response. Adding a *public* field later is an additive, non-
    breaking change (a new optional field) — the endpoint contract is
    unchanged and older clients ignore fields they don't model.
    """

    model_config = ConfigDict(extra="ignore")

    uid: str
    status: SellerStatus = "pending"
    store_name: str = Field(default="", max_length=200)
    contact_name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=254)
    phone: str = Field(default="", max_length=32)
    website: str | None = Field(default=None, max_length=2048)
    gst: str | None = Field(default=None, max_length=32)
    brand_logo_url: str | None = Field(default=None, max_length=2048)
    brand_description: str | None = Field(default=None, max_length=2000)
    terms_accepted_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class SellerOnboardRequest(BaseModel):
    """Business info + terms acceptance. Unknown/future fields are ignored."""

    model_config = ConfigDict(extra="ignore")

    store_name: str = Field(..., min_length=1, max_length=200)
    contact_name: str = Field(..., min_length=1, max_length=120)
    email: str = Field(..., min_length=3, max_length=254)
    phone: str = Field(..., min_length=3, max_length=32)
    website: str | None = Field(default=None, max_length=2048)
    gst: str | None = Field(default=None, max_length=32)
    brand_description: str | None = Field(default=None, max_length=2000)
    terms_accepted: bool = Field(...)

    @field_validator("email")
    @classmethod
    def _validate_email(cls, value: str) -> str:
        if not _looks_like_email(value):
            raise ValueError("A valid business email is required.")
        return value.strip()

    @field_validator("terms_accepted")
    @classmethod
    def _require_terms(cls, value: bool) -> bool:
        if not value:
            raise ValueError("You must accept the seller terms to continue.")
        return value


class SellerProfileUpdateRequest(BaseModel):
    """Partial edit of the editable profile fields.

    Status, uid, timestamps and the logo (uploaded via its own endpoint) are
    intentionally absent — a profile edit can never change lifecycle state.
    Only fields the client actually sends are applied.
    """

    model_config = ConfigDict(extra="ignore")

    store_name: str | None = Field(default=None, min_length=1, max_length=200)
    contact_name: str | None = Field(default=None, min_length=1, max_length=120)
    email: str | None = Field(default=None, min_length=3, max_length=254)
    phone: str | None = Field(default=None, min_length=3, max_length=32)
    website: str | None = Field(default=None, max_length=2048)
    gst: str | None = Field(default=None, max_length=32)
    brand_description: str | None = Field(default=None, max_length=2000)

    @field_validator("email")
    @classmethod
    def _validate_email(cls, value: str | None) -> str | None:
        if value is not None and not _looks_like_email(value):
            raise ValueError("A valid business email is required.")
        return value.strip() if isinstance(value, str) else value


class SellerStatusUpdateRequest(BaseModel):
    """Admin-only lifecycle transition."""

    status: Literal["active", "rejected", "suspended"]
    reason: str | None = Field(default=None, max_length=500)


class ProductDraft(BaseModel):
    """Unified product schema — the single shape every import provider emits.

    Deliberately provider-agnostic: whether a field came from the URL
    extractor, the lightweight image analyzer, or a future Vision-AI model is
    invisible here. All fields optional so a partial extraction is valid; the
    enricher fills gaps and records them in ProductPreview.generated_fields.
    """

    model_config = ConfigDict(extra="ignore")

    title: str = Field(default="", max_length=500)
    description: str = Field(default="", max_length=4000)
    brand: str = Field(default="", max_length=200)
    category: str = Field(default="", max_length=120)
    gender: str = Field(default="", max_length=40)
    fabric: str = Field(default="", max_length=120)
    colors: list[str] = Field(default_factory=list)
    images: list[str] = Field(default_factory=list)
    size_chart: dict[str, float] | None = None
    fit_type: str = Field(default="", max_length=60)
    sleeve_type: str = Field(default="", max_length=60)
    neck_type: str = Field(default="", max_length=60)
    pattern: str = Field(default="", max_length=120)
    tags: list[str] = Field(default_factory=list)
    price: str | None = Field(default=None, max_length=120)
    source_url: str | None = Field(default=None, max_length=2048)
    updated_by: str | None = Field(default=None, max_length=120)


class ProductImportRequest(BaseModel):
    """Import from a product URL OR uploaded image data URLs (exactly one)."""

    model_config = ConfigDict(extra="ignore")

    url: str | None = Field(default=None, max_length=2048)
    images: list[str] | None = Field(default=None, max_length=6)

    @field_validator("images")
    @classmethod
    def _drop_empty_images(cls, value: list[str] | None) -> list[str] | None:
        if not value:
            return None
        cleaned = [item for item in value if isinstance(item, str) and item.strip()]
        return cleaned or None

    def has_url(self) -> bool:
        return bool(self.url and self.url.strip())


class ProductPreview(BaseModel):
    """Draft returned for seller review before anything is saved.

    generated_fields lists the field names the system estimated (vs read from
    the source), so the UI can badge them "generated". The producing provider
    is intentionally NOT exposed.
    """

    product: ProductDraft
    generated_fields: list[str] = Field(default_factory=list)


class SellerProductCreate(ProductDraft):
    """Seller-approved product to persist (may include their edits)."""

    # Required on save (overrides ProductDraft's optional default) — a product
    # cannot be listed without a title.
    title: str = Field(..., min_length=1, max_length=500)
    generated_fields: list[str] = Field(default_factory=list)
    status: Literal["active", "draft"] = "active"

    @field_validator("title")
    @classmethod
    def _require_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("A product title is required to save.")
        return value.strip()


class SellerProduct(BaseModel):
    """Stored shape of a seller_products/{id} document."""

    model_config = ConfigDict(extra="ignore")

    id: str
    seller_uid: str
    title: str = ""
    description: str = ""
    brand: str = ""
    category: str = ""
    gender: str = ""
    fabric: str = ""
    colors: list[str] = Field(default_factory=list)
    images: list[str] = Field(default_factory=list)
    size_chart: dict[str, float] | None = None
    fit_type: str = ""
    sleeve_type: str = ""
    neck_type: str = ""
    pattern: str = ""
    tags: list[str] = Field(default_factory=list)
    price: str | None = None
    source_url: str | None = None
    generated_fields: list[str] = Field(default_factory=list)
    status: str = "active"
    created_at: str | None = None
    updated_at: str | None = None
    updated_by: str | None = None


class SellerProductUpdate(ProductDraft):
    """Optional edits to patch an existing seller product.

    Includes expected_updated_at for concurrency/overwrite safety checks.
    """
    title: str | None = Field(default=None, min_length=1, max_length=500)
    generated_fields: list[str] | None = None
    status: Literal["active", "draft", "archived"] | None = None
    expected_updated_at: str | None = None


class BulkOperationRequest(BaseModel):
    """A list of product IDs and the action to perform on all of them."""
    ids: list[str]
    operation: Literal["delete", "archive", "restore"]


class SellerMeResponse(BaseModel):
    """Answer to "am I a seller, and where am I in the lifecycle?".

    is_seller is true only for status == "active" — pending/rejected/
    suspended sellers have a profile but no seller capabilities yet.
    """

    is_seller: bool
    status: SellerStatus | None = None
    profile: SellerProfile | None = None


class PopularProductMetric(BaseModel):
    id: str
    title: str
    tryon_count: int
    recommendation_count: int
    feedback_count: int
    accuracy: float | None = None


class ActivityEvent(BaseModel):
    id: str
    type: str  # e.g. "product_created", "product_edited", "product_archived", "feedback_received"
    text: str
    timestamp: str


class SellerDashboardResponse(BaseModel):
    total_products: int
    active_products: int
    archived_products: int
    total_tryons: int
    total_recs: int
    feedback_count: int
    popular_products: list[PopularProductMetric]
    recent_activity: list[ActivityEvent]


class SellerIntegrationConnectRequest(BaseModel):
    platform: str
    store_url: str
    credentials: dict[str, str]


class SellerIntegrationResponse(BaseModel):
    platform: str
    store_url: str
    connected_at: str
    last_sync_at: str | None = None
    last_sync_status: str | None = None


class SyncHistoryEvent(BaseModel):
    event_id: str
    platform: str
    started_at: str
    completed_at: str | None = None
    status: str
    products_synced_count: int
    error_message: str | None = None


