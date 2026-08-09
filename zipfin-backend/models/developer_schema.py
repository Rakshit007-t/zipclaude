from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class ApiKey(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    user_id: str
    name: str = Field(..., max_length=100)
    environment: Literal["test", "live"] = "test"
    prefix: str
    lookup_prefix: str  # First 16 chars for fast O(1) Firestore query
    hashed_key: str  # Salted PBKDF2 hash
    status: Literal["active", "revoked"] = "active"
    created_at: str
    last_used_at: str | None = None
    usage_count: int = 0


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    environment: Literal["test", "live"] = "test"


class ApiKeyCreateResponse(BaseModel):
    id: str
    name: str
    environment: Literal["test", "live"]
    raw_key: str  # Returned ONLY ONCE on creation!
    prefix: str
    created_at: str


class ApiKeyMetadataResponse(BaseModel):
    id: str
    name: str
    environment: Literal["test", "live"]
    prefix: str
    status: Literal["active", "revoked"]
    created_at: str
    last_used_at: str | None = None
    usage_count: int = 0


class TopEndpointMetric(BaseModel):
    endpoint: str
    count: int


class UsageAnalyticsResponse(BaseModel):
    time_range: Literal["24h", "7d", "30d"] = "24h"
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    avg_latency_ms: float = 0.0
    p95_latency_ms: float = 0.0
    gpu_time_seconds: float = 0.0
    credits_used: int = 0
    top_endpoints: list[TopEndpointMetric] = []
