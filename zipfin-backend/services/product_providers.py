from __future__ import annotations

import hashlib
import os
import threading
import time
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlparse

from fastapi import HTTPException, status

from models.schema import ExtractProductResponse
from services.product_extractor import extract_product_details, normalize_product_url

DEFAULT_CACHE_TTL_SECONDS = 300
NOT_FOUND_MARKERS = {"", "not found", "unknown", "n/a", "-"}
PLACEHOLDER_TITLES = {
    "",
    "en",
    "en in",
    "in",
    "kids",
    "man",
    "men",
    "new",
    "sale",
    "women",
}


class ProductProvider(Protocol):
    def supports(self, url: str) -> bool: ...

    def fetch(self, url: str, requester_id: str) -> ExtractProductResponse: ...


@dataclass
class _CacheEntry:
    expires_at: float
    payload: ExtractProductResponse


_provider_cache: dict[str, _CacheEntry] = {}
_provider_cache_lock = threading.Lock()


def validate_product_url(url: str) -> str:
    try:
        parsed = urlparse(url)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "Invalid product URL.",
                "details": {"code": "invalid_url"},
            },
        ) from exc

    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "Invalid product URL.",
                "details": {"code": "invalid_url"},
            },
        )

    return normalize_product_url(url)


class LinkPasteProvider:
    def supports(self, url: str) -> bool:
        return True

    def fetch(self, url: str, requester_id: str) -> ExtractProductResponse:
        cached = _get_cache(url)
        if cached is not None:
            return cached

        extracted = extract_product_details(url, requester_id=requester_id)
        normalized = _normalize_extracted(url, extracted)
        _set_cache(url, normalized)
        return normalized


class AmazonProvider:
    def supports(self, url: str) -> bool:
        host = (urlparse(url).hostname or "").lower()
        return "amazon." in host or host.endswith("amzn.to")

    def fetch(self, url: str, requester_id: str) -> ExtractProductResponse:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail={
                "message": "Amazon provider is not enabled in this phase.",
                "details": {"code": "provider_not_enabled", "provider": "amazon"},
            },
        )


class FlipkartProvider:
    def supports(self, url: str) -> bool:
        host = (urlparse(url).hostname or "").lower()
        return "flipkart.com" in host

    def fetch(self, url: str, requester_id: str) -> ExtractProductResponse:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail={
                "message": "Flipkart provider is not enabled in this phase.",
                "details": {"code": "provider_not_enabled", "provider": "flipkart"},
            },
        )


def get_provider_for_url(url: str) -> ProductProvider:
    return LinkPasteProvider()


def _normalize_extracted(url: str, extracted: ExtractProductResponse) -> ExtractProductResponse:
    title = _clean(extracted.title)
    brand = _clean(extracted.brand)
    category = _clean(extracted.category)
    image = _clean(extracted.image)
    price = _clean(extracted.price)

    if _looks_like_placeholder_title(title):
        title = ""

    source = _source_from_url(url)
    confidence = _compute_confidence(title=title, brand=brand, category=category, image=image, price=price)
    product_id = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]

    return ExtractProductResponse(
        id=product_id,
        title=title,
        brand=brand,
        category=category,
        price=price or None,
        image=image or None,
        url=url,
        source=source,
        confidence=confidence,
        fit_hint=extracted.fit_hint,
        size_chart=extracted.size_chart,
        available_sizes=extracted.available_sizes,
        size_format=extracted.size_format,
    )


def _clean(value: str | None) -> str:
    text = str(value or "").strip()
    if text.lower() in NOT_FOUND_MARKERS:
        return ""
    return text


def _source_from_url(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    if "amazon." in host or host.endswith("amzn.to"):
        return "amazon"
    if "flipkart.com" in host:
        return "flipkart"
    return "link"


def _compute_confidence(*, title: str, brand: str, category: str, image: str, price: str) -> float:
    present = sum(bool(value) for value in (title, brand, category, image, price))
    return min(1.0, max(0.35, present / 5))


def _looks_like_placeholder_title(title: str) -> bool:
    normalized = " ".join(title.lower().split())
    return normalized in PLACEHOLDER_TITLES


def _get_cache(url: str) -> ExtractProductResponse | None:
    with _provider_cache_lock:
        entry = _provider_cache.get(url)
        if entry is None:
            return None
        if time.time() >= entry.expires_at:
            _provider_cache.pop(url, None)
            return None
        return entry.payload


def _set_cache(url: str, payload: ExtractProductResponse) -> None:
    ttl = _get_cache_ttl_seconds()
    with _provider_cache_lock:
        _provider_cache[url] = _CacheEntry(expires_at=time.time() + ttl, payload=payload)


def _get_cache_ttl_seconds() -> int:
    raw = os.getenv("PRODUCT_CACHE_TTL_SECONDS", "").strip()
    if not raw:
        return DEFAULT_CACHE_TTL_SECONDS
    try:
        parsed = int(raw)
        return parsed if parsed > 0 else DEFAULT_CACHE_TTL_SECONDS
    except ValueError:
        return DEFAULT_CACHE_TTL_SECONDS


