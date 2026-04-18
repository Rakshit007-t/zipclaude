from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field, HttpUrl

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    success: Literal[True] = True
    message: str
    data: T


class ApiError(BaseModel):
    message: str
    status_code: int
    details: Any | None = None


class ApiErrorResponse(BaseModel):
    success: Literal[False] = False
    error: ApiError


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


class SizeEngineRequest(BaseModel):
    chest: int = Field(..., gt=0, le=200)
    waist_cm: int | None = Field(default=None, gt=0, le=200)
    hip_cm: int | None = Field(default=None, gt=0, le=250)
    fit: str = Field(default="regular", min_length=3, max_length=20)
    brand: str = Field(default="generic", min_length=1, max_length=50)
    range: str = Field(..., min_length=1, max_length=50)
    category: str | None = Field(default=None, max_length=50)


class SizeEngineResponse(BaseModel):
    size: str
    confidence: float
    risk: str
    reason: str


class ExtractProductRequest(BaseModel):
    url: HttpUrl


class ExtractProductResponse(BaseModel):
    title: str = ""
    brand: str = ""
    category: str = ""
    price: str = ""
    image: str = ""

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
    product_image_url: HttpUrl


class TryOnImageResponse(BaseModel):
    tryon_image: str


class ProfileUpsertRequest(BaseModel):
    brand: str | None = Field(default=None, max_length=100)
    size: str | None = Field(default=None, max_length=50)
    fit: str | None = Field(default=None, max_length=50)


class ProfileResponse(ProfileUpsertRequest):
    id: str
    email: str


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
    preview_image_url: HttpUrl | None = None
    asset_url: HttpUrl | None = None
    texture_image_url: HttpUrl | None = None
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
