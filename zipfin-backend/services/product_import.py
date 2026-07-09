"""Modular product import.

    ProductImportRequest
        -> ProductImportProvider (URL extractor | image analyzer | future VLM)
        -> ProductDraft (unified schema)
        -> enrichment (fills gaps, marks them generated)
        -> ProductPreview  -> seller approves -> save

Design goals (locked with product):
  * The chosen provider is never revealed to the API/frontend — callers see
    only the unified ProductDraft plus which fields were estimated.
  * A future Vision-AI provider (Qwen-VL / Gemma-Vision / InternVL) plugs in by
    implementing ProductImportProvider and being prepended to the registry —
    no route, schema, or frontend change.
  * Size charts and prices are NEVER fabricated (they drive real sizing/checkout);
    only descriptive attributes are estimated.
"""

from __future__ import annotations

import base64
import binascii
import io
import logging
from abc import ABC, abstractmethod
from typing import Callable

from fastapi import HTTPException, status

from models.seller_schema import ProductDraft, ProductImportRequest, ProductPreview
from services.storage_provider import StorageProvider, get_storage_provider

logger = logging.getLogger(__name__)

# Fields the enricher may estimate. size_chart / price / images / source_url are
# intentionally excluded — never invent measurements, prices, or photos.
ENRICHABLE_FIELDS = (
    "title",
    "description",
    "category",
    "gender",
    "fabric",
    "colors",
    "fit_type",
    "sleeve_type",
    "neck_type",
    "pattern",
    "tags",
)

_CATEGORY_KEYWORDS = {
    "tshirt": ("t-shirt", "tshirt", "tee", "polo"),
    "shirt": ("shirt", "button-down", "button down", "oxford"),
    "hoodie": ("hoodie", "hooded"),
    "sweatshirt": ("sweatshirt", "sweat shirt"),
    "jacket": ("jacket", "bomber", "windbreaker", "parka"),
    "dress": ("dress", "gown", "kurti"),
    "jeans": ("jeans", "denim"),
    "trousers": ("trouser", "pant", "chino", "jogger"),
    "shorts": ("shorts", "bermuda"),
    "skirt": ("skirt",),
}
_FIT_KEYWORDS = {
    "slim": ("slim", "tailored", "fitted", "skinny"),
    "oversized": ("oversized", "oversize", "boxy", "baggy"),
    "relaxed": ("relaxed", "loose"),
    "compression": ("compression", "muscle fit"),
    "regular": ("regular", "classic", "standard"),
}
_SLEEVE_KEYWORDS = {
    "sleeveless": ("sleeveless", "tank"),
    "short sleeve": ("short sleeve", "half sleeve", "short-sleeve"),
    "long sleeve": ("long sleeve", "full sleeve", "long-sleeve"),
}
_NECK_KEYWORDS = {
    "v-neck": ("v-neck", "v neck"),
    "polo": ("polo", "collar"),
    "hooded": ("hoodie", "hooded"),
    "crew neck": ("crew", "round neck", "crewneck"),
}
_FABRIC_KEYWORDS = {
    "denim": ("denim", "jeans"),
    "wool": ("wool", "merino"),
    "linen": ("linen",),
    "silk": ("silk",),
    "polyester": ("polyester", "poly"),
    "fleece": ("fleece",),
    "cotton": ("cotton", "jersey", "tee", "t-shirt"),
}
_GENDER_KEYWORDS = {
    "women": ("women", "woman", "female", "ladies", "her"),
    "men": ("men", "man", "male", "gents", "him"),
}
_PATTERN_KEYWORDS = {
    "striped": ("striped", "stripe", "stripes"),
    "checked": ("checked", "check", "plaid", "tartan", "checks"),
    "printed": ("printed", "print", "graphic"),
    "floral": ("floral", "flower", "flowers"),
    "solid": ("solid", "plain"),
}
_BASIC_PALETTE = {
    "black": (0, 0, 0),
    "white": (255, 255, 255),
    "gray": (128, 128, 128),
    "red": (200, 30, 30),
    "orange": (230, 140, 30),
    "yellow": (230, 220, 50),
    "green": (40, 160, 60),
    "blue": (40, 90, 200),
    "navy": (20, 30, 90),
    "purple": (120, 50, 160),
    "pink": (230, 130, 180),
    "brown": (110, 70, 40),
    "beige": (210, 190, 150),
}


class ProductImportProvider(ABC):
    """One extraction strategy. Registry order = priority."""

    name: str = "provider"

    @abstractmethod
    def supports(self, request: ProductImportRequest) -> bool:
        """True when this provider can handle the request."""

    @abstractmethod
    def extract(self, request: ProductImportRequest) -> ProductDraft:
        """Produce a (possibly partial) unified draft. Blocking is fine —
        the service runs providers in a worker thread."""


class UrlImportProvider(ProductImportProvider):
    """Reuses the existing URL extractor (same path as /extract-product)."""

    name = "url"

    def __init__(self, extractor: Callable[[str, str], object] | None = None) -> None:
        self._extractor = extractor

    def supports(self, request: ProductImportRequest) -> bool:
        return request.has_url()

    def extract(self, request: ProductImportRequest) -> ProductDraft:
        from services.product_providers import get_provider_for_url, validate_product_url

        normalized = validate_product_url(request.url or "")
        extractor = self._extractor
        if extractor is None:
            provider = get_provider_for_url(normalized)
            extractor = provider.fetch
        extracted = extractor(normalized, "seller-import")

        image = getattr(extracted, "image", None)
        return ProductDraft(
            title=str(getattr(extracted, "title", "") or ""),
            brand=str(getattr(extracted, "brand", "") or ""),
            category=str(getattr(extracted, "category", "") or ""),
            price=getattr(extracted, "price", None),
            images=[image] if image else [],
            size_chart=getattr(extracted, "size_chart", None),
            fit_type=str(getattr(extracted, "fit_hint", "") or ""),
            pattern=str(getattr(extracted, "pattern", "") or ""),
            source_url=str(getattr(extracted, "url", "") or normalized),
        )


class ImageImportProvider(ProductImportProvider):
    """Lightweight, no-VLM image analysis: stores the images and measures
    dominant colors. Everything else is left for the enricher to estimate.

    A future Vision-AI provider implements the same interface and is placed
    ahead of this one in the registry — this stays as the always-available
    fallback.
    """

    name = "image"

    def __init__(self, storage: StorageProvider | None = None) -> None:
        self._storage = storage or get_storage_provider()

    def supports(self, request: ProductImportRequest) -> bool:
        return bool(request.images)

    def extract(self, request: ProductImportRequest) -> ProductDraft:
        image_urls: list[str] = []
        colors: list[str] = []
        for data_url in request.images or []:
            raw, ext, content_type = _decode_image(data_url)
            if raw is None:
                continue
            url = self._storage.upload_bytes(
                raw, content_type=content_type, folder="seller-products", extension=ext
            )
            image_urls.append(url)
            if not colors:
                colors = _dominant_color_names(raw)
        if not image_urls:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="No valid images could be read.",
            )
        return ProductDraft(images=image_urls, colors=colors)


class ProductEnricher:
    """Fills empty descriptive fields with keyword-inferred estimates and
    records exactly which fields were generated."""

    def enrich(self, draft: ProductDraft) -> ProductPreview:
        text = " ".join(
            part for part in (draft.title, draft.description, " ".join(draft.tags)) if part
        ).lower()
        generated: list[str] = []

        for field in ENRICHABLE_FIELDS:
            if not _is_empty(getattr(draft, field)):
                continue
            value = self._infer(field, text, draft)
            if _is_empty(value):
                continue
            setattr(draft, field, value)
            generated.append(field)

        return ProductPreview(product=draft, generated_fields=generated)

    def _infer(self, field: str, text: str, draft: ProductDraft):
        if field == "category":
            return _match_keyword(text, _CATEGORY_KEYWORDS)
        if field == "fit_type":
            return _match_keyword(text, _FIT_KEYWORDS) or "regular"
        if field == "sleeve_type":
            return _match_keyword(text, _SLEEVE_KEYWORDS)
        if field == "neck_type":
            return _match_keyword(text, _NECK_KEYWORDS)
        if field == "fabric":
            return _match_keyword(text, _FABRIC_KEYWORDS)
        if field == "gender":
            return _match_keyword(text, _GENDER_KEYWORDS) or "unisex"
        if field == "pattern":
            return _match_keyword(text, _PATTERN_KEYWORDS) or "solid"
        if field == "tags":
            tags = [draft.brand.lower()] if draft.brand else []
            tags += [t for t in (draft.category, draft.fit_type, draft.pattern, draft.gender) if t]
            tags += draft.colors[:2]
            return list(dict.fromkeys(t for t in tags if t)) or []
        if field == "title":
            bits = [b for b in (draft.brand, " ".join(draft.colors[:1]), draft.category) if b]
            return " ".join(bits).strip().title() or "Untitled Product"
        if field == "description":
            descriptor = " ".join(
                b for b in (draft.fit_type, draft.fabric, draft.category) if b
            ).strip()
            return f"A {descriptor} from {draft.brand}.".strip() if descriptor or draft.brand else ""
        return None


class ProductImportService:
    """Selects the first supporting provider, extracts, then enriches."""

    def __init__(
        self,
        providers: list[ProductImportProvider] | None = None,
        enricher: ProductEnricher | None = None,
    ) -> None:
        # Order = priority. A future VisionAIProvider goes ahead of the
        # lightweight ImageImportProvider here — the only change needed.
        self._providers = providers if providers is not None else [
            UrlImportProvider(),
            ImageImportProvider(),
        ]
        self._enricher = enricher or ProductEnricher()

    def import_preview(self, request: ProductImportRequest) -> ProductPreview:
        provider = next((p for p in self._providers if p.supports(request)), None)
        if provider is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Provide a product URL or at least one image to import.",
            )
        try:
            draft = provider.extract(request)
        except HTTPException:
            raise
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            ) from exc
        except Exception as exc:
            logger.exception("Product import failed (provider=%s).", provider.name)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not import this product. Try another source.",
            ) from exc
        return self._enricher.enrich(draft)


_SERVICE: ProductImportService | None = None


def get_product_import_service() -> ProductImportService:
    """FastAPI dependency; override in tests via app.dependency_overrides."""
    global _SERVICE
    if _SERVICE is None:
        _SERVICE = ProductImportService()
    return _SERVICE


# --- helpers -----------------------------------------------------------------


def _is_empty(value) -> bool:
    return value is None or value == "" or value == []


def _match_keyword(text: str, table: dict[str, tuple[str, ...]]) -> str:
    for label, needles in table.items():
        if any(needle in text for needle in needles):
            return label
    return ""


def _decode_image(data_url: str) -> tuple[bytes | None, str, str]:
    value = (data_url or "").strip()
    content_type = "image/png"
    if value.startswith("data:"):
        header, _, encoded = value.partition(",")
        if ";base64" not in header:
            return None, ".png", content_type
        content_type = header[5:].split(";")[0] or "image/png"
        value = encoded
    try:
        raw = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        return None, ".png", content_type
    ext = {"image/jpeg": ".jpg", "image/webp": ".webp"}.get(content_type, ".png")
    return raw, ext, content_type


def _dominant_color_names(image_bytes: bytes, count: int = 2) -> list[str]:
    try:
        from PIL import Image

        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image.thumbnail((64, 64))
        quantized = image.quantize(colors=max(count, 3), method=Image.FASTOCTREE)
        palette = quantized.getpalette() or []
        ranked = sorted(quantized.getcolors() or [], reverse=True)
        names: list[str] = []
        for _freq, index in ranked:
            rgb = tuple(palette[index * 3 : index * 3 + 3])
            if len(rgb) < 3:
                continue
            name = _nearest_color_name(rgb)
            if name not in names:
                names.append(name)
            if len(names) >= count:
                break
        return names
    except Exception as exc:
        logger.debug("Dominant color extraction failed: %s", exc)
        return []


def _nearest_color_name(rgb: tuple[int, int, int]) -> str:
    best_name, best_dist = "black", float("inf")
    for name, ref in _BASIC_PALETTE.items():
        dist = sum((int(a) - int(b)) ** 2 for a, b in zip(rgb, ref))
        if dist < best_dist:
            best_name, best_dist = name, dist
    return best_name
