import math
from typing import Any, Generic, Literal, TypeVar

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    model_config = ConfigDict(populate_by_name=True)

    is_valid: bool = Field(
        ...,
        serialization_alias="isValid",
        validation_alias=AliasChoices("isValid", "is_valid"),
    )
    message: str
    data: T | None = None


class ApiErrorResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    is_valid: Literal[False] = Field(
        default=False,
        serialization_alias="isValid",
        validation_alias=AliasChoices("isValid", "is_valid"),
    )
    message: str
    data: Any | None = None


class EmailAuthRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=320)
    password: str = Field(..., min_length=6, max_length=128)


class AuthUser(BaseModel):
    id: str
    email: str


class AuthSession(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str


class AuthResult(BaseModel):
    user: AuthUser
    session: AuthSession | None = None
    needs_email_verification: bool = False


class AccessStatusResponse(BaseModel):
    is_admin: bool
    is_seller: bool


class NormalizedProduct(BaseModel):
    id: str = Field(default="", min_length=1, max_length=128)
    title: str = Field(..., min_length=1, max_length=500)
    brand: str = Field(..., min_length=1, max_length=120)
    category: str = Field(..., min_length=1, max_length=120)
    price: str | None = Field(default=None, max_length=120)
    image: str | None = Field(default=None, max_length=2000)
    url: str = Field(..., min_length=1, max_length=2048)
    source: Literal["link", "amazon", "flipkart"] = "link"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    fit_hint: str | None = Field(default=None, max_length=40)
    size_chart: dict[str, float] | None = None
    available_sizes: list[str] | None = None
    size_format: str | None = Field(default=None, max_length=40)


class SizeEngineProfile(BaseModel):
    base_size: Literal["XS", "S", "M", "L", "XL", "XXL"] = "M"
    fit_preference: Literal["slim", "regular", "relaxed", "loose", "baggy"] = "regular"
    chest: float | None = Field(default=None, gt=0, le=300)
    waist: float | None = Field(default=None, gt=0, le=300)
    shoulders: float | None = Field(default=None, gt=0, le=300)
    hips: float | None = Field(default=None, gt=0, le=300)
    legs: float | None = Field(default=None, gt=0, le=300)
    bust: float | None = Field(default=None, gt=0, le=300)


class SizeEngineRequest(BaseModel):
    product: NormalizedProduct
    profile: SizeEngineProfile


class SizeEngineResponse(BaseModel):
    size: str
    confidence: float
    risk: str
    reason: str


class PredictSizeMeasurements(BaseModel):
    chest: float | None = Field(default=None, gt=0, le=300)
    waist: float | None = Field(default=None, gt=0, le=300)
    shoulders: float | None = Field(default=None, gt=0, le=300)
    arms: float | None = Field(default=None, gt=0, le=300)
    legs: float | None = Field(default=None, gt=0, le=300)
    torso: float | None = Field(default=None, gt=0, le=300)
    hips: float | None = Field(default=None, gt=0, le=300)
    bust: float | None = Field(default=None, gt=0, le=300)


class PredictSizeRequest(BaseModel):
    link: str = Field(..., min_length=1, max_length=2048)
    height: float = Field(..., gt=0, le=300)
    measurements: PredictSizeMeasurements | None = None
    product: NormalizedProduct | None = None
    base_size: Literal["XS", "S", "M", "L", "XL", "XXL"] | None = None
    fit_preference: Literal["slim", "regular", "relaxed", "loose", "baggy"] = "regular"


class PredictSizeResponse(BaseModel):
    size: str
    confidence: float
    risk: str | None = None
    reason: str | None = None


class SmartFitScanRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    front_image: str | None = Field(
        default=None,
        validation_alias=AliasChoices("front_image", "frontImage"),
    )
    side_image: str | None = Field(
        default=None,
        validation_alias=AliasChoices("side_image", "sideImage"),
    )
    height: float | None = Field(
        default=None,
        validation_alias=AliasChoices("height", "heightCm"),
    )

    @field_validator("front_image", "side_image", mode="before")
    @classmethod
    def normalize_image_field(cls, value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        if isinstance(value, dict):
            for key in ("base64", "data", "data_url", "dataUrl", "value", "url", "uri"):
                nested_value = value.get(key)
                if isinstance(nested_value, str):
                    normalized = nested_value.strip()
                    if normalized:
                        return normalized
            return None
        raise ValueError("scan image must be a base64 string")

    @field_validator("height", mode="before")
    @classmethod
    def normalize_height_field(cls, value: Any) -> float | None:
        if value is None:
            return None
        if isinstance(value, bool):
            raise ValueError("height must be numeric")
        if isinstance(value, (int, float)):
            numeric_value = float(value)
        elif isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                return None
            try:
                numeric_value = float(normalized)
            except ValueError as exc:
                raise ValueError("height must be numeric") from exc
        else:
            raise ValueError("height must be numeric")

        if not math.isfinite(numeric_value):
            raise ValueError("height must be finite")
        return numeric_value


class SmartFitScanMeasurements(BaseModel):
    chest: float = Field(..., gt=0, le=300)
    waist: float = Field(..., gt=0, le=300)
    shoulders: float = Field(..., gt=0, le=300)
    arms: float | None = Field(default=None, gt=0, le=300)
    legs: float | None = Field(default=None, gt=0, le=300)
    torso: float | None = Field(default=None, gt=0, le=300)
    hips: float | None = Field(default=None, gt=0, le=300)
    bust: float | None = Field(default=None, gt=0, le=300)
    confidence: float = Field(..., ge=0.0, le=1.0)


class SmartFitScanResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    is_valid: bool = Field(
        ...,
        serialization_alias="isValid",
        validation_alias=AliasChoices("isValid", "is_valid"),
    )
    message: str | None = None
    measurements: SmartFitScanMeasurements | None = None


class ExtractProductRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)


class ExtractProductResponse(BaseModel):
    id: str = ""
    title: str = ""
    brand: str = ""
    category: str = ""
    price: str | None = None
    image: str | None = None
    url: str = ""
    source: Literal["link", "amazon", "flipkart"] = "link"
    confidence: float = 0.0
    fit_hint: str | None = None
    size_chart: dict[str, float] | None = None
    available_sizes: list[str] | None = None
    size_format: str | None = None
    error_code: str | None = None
    error_message: str | None = None

class RecentScan(BaseModel):
    url: str
    title: str
    brand: str
    image: str
    timestamp: str

class RecentScansResponse(BaseModel):
    scans: list[RecentScan]


class AvatarCreateResponse(BaseModel):
    user_id: str
    public_path: str
    embedding: list[float]


class TryOnImageRequest(BaseModel):
    user_id: str = Field(
        ...,
        min_length=3,
        max_length=100,
        pattern=r"^[A-Za-z0-9_-]+$",
    )
    product_image_url: str = Field(default="", max_length=2048)
    cloth_type: Literal["upper_body", "lower_body", "dress", "auto"] = "auto"
    quality: Literal["fast", "hd", "2k"] = "hd"
    # Optional base64 data URL of a person photo; used instead of the stored
    # avatar when provided (e.g. a fresh camera capture).
    person_image: str | None = Field(default=None, max_length=15_000_000)
    # Optional base64 data URL of the garment photo; used instead of
    # product_image_url (e.g. an uploaded garment picture).
    garment_image: str | None = Field(default=None, max_length=15_000_000)


class TryOnImageResponse(BaseModel):
    tryon_image: str
    engine: Literal["catvton", "catvton_cloud", "overlay"] = "overlay"


class TryOnJobCreateResponse(BaseModel):
    job_id: str


class TryOnJobStatusResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running", "done", "failed"]
    progress: int = Field(..., ge=0, le=100)
    stage: str = ""
    engine: str | None = None
    tryon_image: str | None = None
    error: str | None = None


class WalletTopUpRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    amount_rupees: int = Field(
        ...,
        ge=1,
        le=100_000,
        serialization_alias="amountRupees",
        validation_alias=AliasChoices("amountRupees", "amount_rupees"),
    )


class WalletTopUpResponse(BaseModel):
    wallet_balance_rupees: int = Field(serialization_alias="walletBalanceRupees")


class ProfileMeasurements(BaseModel):
    """Measurements accepted from the Fit Profile client, in centimetres."""

    model_config = ConfigDict(extra="forbid")

    chest: float | None = Field(default=None, gt=0, le=300)
    waist: float | None = Field(default=None, gt=0, le=300)
    shoulders: float | None = Field(default=None, gt=0, le=300)
    arms: float | None = Field(default=None, gt=0, le=300)
    legs: float | None = Field(default=None, gt=0, le=300)
    torso: float | None = Field(default=None, gt=0, le=300)
    hips: float | None = Field(default=None, gt=0, le=300)
    bust: float | None = Field(default=None, gt=0, le=300)
    confidence: float | None = Field(default=None, ge=0, le=1)


class ProfileUpsertRequest(BaseModel):
    """Validated profile payload used by the web Fit Profile and legacy clients."""

    model_config = ConfigDict(extra="forbid")

    # Legacy API fields remain supported for existing integrations.
    brand: str | None = Field(default=None, max_length=100)
    size: str | None = Field(default=None, max_length=50)
    fit: str | None = Field(default=None, max_length=50)

    username: str | None = Field(default=None, max_length=50)
    displayName: str | None = Field(default=None, max_length=100)
    photoURL: str | None = Field(default=None, max_length=2048)
    onboardingCompleted: bool | None = None
    fitProfileCompleted: bool | None = None

    profileId: str | None = Field(default=None, min_length=1, max_length=180)
    profileName: str | None = Field(default=None, min_length=1, max_length=100)
    gender: str | None = Field(default=None, min_length=1, max_length=40)
    preferredBrand: str | None = Field(default=None, min_length=1, max_length=100)
    usualSize: Literal["XS", "S", "M", "L", "XL", "XXL"] | None = None
    baseSize: Literal["XS", "S", "M", "L", "XL", "XXL"] | None = None
    height: float | None = Field(default=None, gt=50, le=300)
    weight: float | None = Field(default=None, gt=10, le=500)
    bodyShape: str | None = Field(default=None, min_length=1, max_length=80)
    shoulderType: str | None = Field(default=None, min_length=1, max_length=80)
    fitPreference: Literal["slim", "regular", "relaxed", "loose"] | None = None
    selectedProfileId: str | None = Field(default=None, min_length=1, max_length=180)
    selectedProfile: str | None = Field(default=None, min_length=1, max_length=180)
    recommendationPreferences: dict[str, Any] | None = None
    measurements: ProfileMeasurements | None = None
    smartFit: ProfileMeasurements | None = None
    fitProfiles: list[dict[str, Any]] | None = Field(default=None, max_length=20)


class ProfileResponse(BaseModel):
    id: str
    email: str
    username: str | None = None
    displayName: str | None = None
    photoURL: str | None = None
    onboardingCompleted: bool = False
    fitProfileCompleted: bool = False
    brand: str | None = None
    size: str | None = None
    fit: str | None = None
    fitProfiles: list[dict[str, Any]] | None = None


class GarmentAnchorProfile(BaseModel):
    width_scale: float = Field(default=1.15, gt=0.1, le=4.0)
    height_scale: float = Field(default=1.35, gt=0.1, le=5.0)
    y_offset: float = Field(default=0.18, ge=-1.0, le=1.0)
    z_offset: float = Field(default=0.0, ge=-2.0, le=2.0)
    smoothing: float = Field(default=0.35, ge=0.0, le=0.95)


class GarmentCreateRequest(BaseModel):
    sku: str = Field(
        ...,
        min_length=2,
        max_length=100,
        pattern=r"^[A-Za-z0-9._-]+$",
    )
    name: str = Field(..., min_length=2, max_length=120)
    category: str = Field(..., min_length=2, max_length=50)
    preview_image_url: str | None = None
    asset_url: str | None = None
    texture_image_url: str | None = None
    scale_multiplier: float = Field(default=1.0, gt=0.1, le=10.0)
    anchor_profile: GarmentAnchorProfile = Field(default_factory=GarmentAnchorProfile)


class GarmentResponse(GarmentCreateRequest):
    garment_id: str
    created_at: str


class LiveTryOnSessionCreateRequest(BaseModel):
    user_id: str = Field(
        ...,
        min_length=3,
        max_length=100,
        pattern=r"^[A-Za-z0-9_-]+$",
    )
    garment_id: str = Field(..., min_length=3, max_length=100)
    platform: Literal["android", "ios", "react-native", "flutter", "unity", "web"] = (
        "android"
    )
    frame_width: int = Field(default=1080, gt=0, le=10000)
    frame_height: int = Field(default=1920, gt=0, le=10000)
    camera_fov_degrees: float = Field(default=60.0, ge=20.0, le=160.0)


class LiveTryOnSessionResponse(BaseModel):
    session_id: str
    user_id: str
    garment: GarmentResponse
    render_mode: Literal["client_ar_overlay"]
    tracking_target: Literal["upper_body"]
    recommended_landmarks: list[str]
    websocket_path: str
    created_at: str


class PoseLandmark(BaseModel):
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)
    z: float = Field(default=0.0, ge=-5.0, le=5.0)
    visibility: float = Field(default=1.0, ge=0.0, le=1.0)


class LiveTryOnFrameRequest(BaseModel):
    session_id: str = Field(..., min_length=3, max_length=100)
    frame_width: int = Field(..., gt=0, le=10000)
    frame_height: int = Field(..., gt=0, le=10000)
    landmarks: dict[str, PoseLandmark] = Field(..., min_length=2)


class GarmentTransform(BaseModel):
    anchor_x: float
    anchor_y: float
    anchor_z: float
    width_px: float
    width_scale: float = Field(default=1.15, gt=0.1, le=4.0)
    height_scale: float = Field(default=1.35, gt=0.1, le=5.0)
    y_offset: float = Field(default=0.18, ge=-1.0, le=1.0)
    z_offset: float = Field(default=0.0, ge=-2.0, le=2.0)
    smoothing: float = Field(default=0.35, ge=0.0, le=0.95)


class GarmentCreateRequest(BaseModel):
    sku: str = Field(
        ...,
        min_length=2,
        max_length=100,
        pattern=r"^[A-Za-z0-9._-]+$",
    )
    name: str = Field(..., min_length=2, max_length=120)
    category: str = Field(..., min_length=2, max_length=50)
    preview_image_url: str | None = None
    asset_url: str | None = None
    texture_image_url: str | None = None
    scale_multiplier: float = Field(default=1.0, gt=0.1, le=10.0)
    anchor_profile: GarmentAnchorProfile = Field(default_factory=GarmentAnchorProfile)


class GarmentResponse(GarmentCreateRequest):
    garment_id: str
    created_at: str


class LiveTryOnSessionCreateRequest(BaseModel):
    user_id: str = Field(
        ...,
        min_length=3,
        max_length=100,
        pattern=r"^[A-Za-z0-9_-]+$",
    )
    garment_id: str = Field(..., min_length=3, max_length=100)
    platform: Literal["android", "ios", "react-native", "flutter", "unity", "web"] = (
        "android"
    )
    frame_width: int = Field(default=1080, gt=0, le=10000)
    frame_height: int = Field(default=1920, gt=0, le=10000)
    camera_fov_degrees: float = Field(default=60.0, ge=20.0, le=160.0)


class LiveTryOnSessionResponse(BaseModel):
    session_id: str
    user_id: str
    garment: GarmentResponse
    render_mode: Literal["client_ar_overlay"]
    tracking_target: Literal["upper_body"]
    recommended_landmarks: list[str]
    websocket_path: str
    created_at: str


class PoseLandmark(BaseModel):
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)
    z: float = Field(default=0.0, ge=-5.0, le=5.0)
    visibility: float = Field(default=1.0, ge=0.0, le=1.0)


class LiveTryOnFrameRequest(BaseModel):
    session_id: str = Field(..., min_length=3, max_length=100)
    frame_width: int = Field(..., gt=0, le=10000)
    frame_height: int = Field(..., gt=0, le=10000)
    landmarks: dict[str, PoseLandmark] = Field(..., min_length=2)


class GarmentTransform(BaseModel):
    anchor_x: float
    anchor_y: float
    anchor_z: float
    width_px: float
    height_px: float
    rotation_degrees: float
    confidence: float


class LiveTryOnFrameResponse(BaseModel):
    session_id: str
    garment_id: str
    tracking_status: Literal["tracked", "partial", "lost"]
    missing_landmarks: list[str]
    transform: GarmentTransform | None


# --- Future-Proof Database Models ---

class UserRecord(BaseModel):
    uid: str
    email: str
    emailVerified: bool = False
    username: str
    displayName: str = ""
    photoURL: str | None = None
    onboardingCompleted: bool = False
    fitProfileCompleted: bool = False
    primaryProfileId: str | None = None
    createdAt: str | None = None
    updatedAt: str | None = None


class FitProfileRecord(BaseModel):
    profileId: str
    userId: str
    profileName: str
    gender: str = ""
    preferredBrand: str = ""
    usualSize: str = "M"
    baseSize: str = "M"
    height: float = 0.0
    weight: float = 0.0
    bodyShape: str | None = None
    shoulderType: str | None = None
    fitPreference: str = "regular"
    measurements: dict[str, float] = Field(default_factory=dict)
    smartFit: dict[str, float] = Field(default_factory=dict)
    isPrimary: bool = True
    createdAt: str | None = None
    updatedAt: str | None = None


class RecommendationHistoryRecord(BaseModel):
    id: str
    userId: str
    profileId: str | None = None
    productUrl: str
    productTitle: str = ""
    brand: str = ""
    category: str = ""
    recommendedSize: str
    confidence: float = 0.0
    reasoning: str | None = None
    createdAt: str | None = None


class PostRecord(BaseModel):
    id: str
    userId: str
    type: Literal["reel", "look", "image", "vto"] = "look"
    mediaUrl: str
    thumbnailUrl: str | None = None
    caption: str = ""
    tags: list[str] = Field(default_factory=list)
    taggedProducts: list[str] = Field(default_factory=list)
    likeCount: int = 0
    commentCount: int = 0
    createdAt: str | None = None


class FollowerRecord(BaseModel):
    id: str
    followerUid: str
    followingUid: str
    createdAt: str | None = None


class MessageRecord(BaseModel):
    id: str
    chatId: str
    senderUid: str
    recipientUid: str
    text: str
    mediaUrl: str | None = None
    read: bool = False
    createdAt: str | None = None


class NotificationRecord(BaseModel):
    id: str
    userId: str
    type: str
    title: str
    body: str
    data: dict[str, Any] = Field(default_factory=dict)
    read: bool = False
    createdAt: str | None = None


class AvatarRecord(BaseModel):
    id: str
    userId: str
    status: Literal["processing", "ready", "failed"] = "ready"
    frontImageUrl: str | None = None
    sideImageUrl: str | None = None
    avatarModelUrl: str | None = None
    embedding: list[float] = Field(default_factory=list)
    createdAt: str | None = None
