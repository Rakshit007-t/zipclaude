"""M2 — AI Product Import: provider interface, URL + image providers,
enrichment/generated-field marking, preview, and save-on-approve."""

from __future__ import annotations

import base64
import io

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from core.api import error_response
from models.seller_schema import ProductDraft, ProductImportRequest
from routes.seller import router as seller_router
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.product_import import (
    ImageImportProvider,
    ProductEnricher,
    ProductImportProvider,
    ProductImportService,
    UrlImportProvider,
    get_product_import_service,
)
from services.product_repository import SellerProductRepository, get_product_repository
from services.seller_auth import require_active_seller
from services.storage_provider import LocalStorageProvider

SELLER = AuthenticatedUser(uid="seller1", email="s@e.com")


class _FakeExtracted:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _png_bytes(color=(200, 30, 30)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color).save(buf, format="PNG")
    return buf.getvalue()


def _data_url(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode()


def _active_seller_client(fake_client, *, service=None) -> TestClient:
    from tests.conftest import FakeFirestore  # noqa: F401 (fixture type)

    app = FastAPI()
    app.add_exception_handler(
        HTTPException,
        lambda request, exc: error_response(status_code=exc.status_code, detail=exc.detail),
    )
    app.add_exception_handler(
        RequestValidationError,
        lambda request, exc: error_response(status_code=422, detail=exc.errors()),
    )
    app.include_router(seller_router)

    fake_client.seed("sellers", "seller1", {"status": "active", "store_name": "Crown"})
    repo = SellerProductRepository(client=fake_client)
    from services.seller_repository import SellerRepository, get_seller_repository

    app.dependency_overrides[get_current_user] = lambda: SELLER
    app.dependency_overrides[get_seller_repository] = lambda: SellerRepository(client=fake_client)
    app.dependency_overrides[get_product_repository] = lambda: repo
    if service is not None:
        app.dependency_overrides[get_product_import_service] = lambda: service
    return TestClient(app)


# --- Provider selection & interface ------------------------------------------


def test_service_selects_url_provider_and_hides_identity():
    def fake_fetch(url, requester):
        return _FakeExtracted(title="Nike Air Tee", brand="Nike", category="tshirt", url=url, image="http://img/1.png")

    service = ProductImportService(providers=[UrlImportProvider(extractor=fake_fetch)])
    preview = service.import_preview(ProductImportRequest(url="https://shop.example/p/1"))
    assert preview.product.title == "Nike Air Tee"
    assert preview.product.brand == "Nike"
    assert preview.product.images == ["http://img/1.png"]
    # provider identity must not leak
    assert not hasattr(preview, "provider")
    assert "provider" not in preview.model_dump()


def test_service_raises_when_no_provider_supports():
    service = ProductImportService(providers=[UrlImportProvider(extractor=lambda u, r: _FakeExtracted())])
    with pytest.raises(HTTPException) as exc:
        service.import_preview(ProductImportRequest(images=None, url=None))
    assert exc.value.status_code == 422


def test_future_vision_provider_plugs_in_ahead_of_image_analyzer():
    class VisionStub(ProductImportProvider):
        name = "vision"

        def supports(self, request):
            return bool(request.images)

        def extract(self, request):
            return ProductDraft(title="Vision Tee", brand="Acme", category="tshirt", gender="men")

    service = ProductImportService(providers=[VisionStub(), ImageImportProvider()])
    preview = service.import_preview(ProductImportRequest(images=[_data_url(_png_bytes())]))
    assert preview.product.title == "Vision Tee"  # vision won over the lightweight analyzer


# --- URL import ---------------------------------------------------------------


def test_url_import_marks_missing_fields_generated():
    def fake_fetch(url, requester):
        return _FakeExtracted(title="Slim Fit Cotton Shirt", brand="Zara", category="shirt", url=url, image="http://img/x.png")

    service = ProductImportService(providers=[UrlImportProvider(extractor=fake_fetch)])
    preview = service.import_preview(ProductImportRequest(url="https://zara.example/p"))
    # extracted fields are NOT in generated_fields
    assert "brand" not in preview.generated_fields
    assert "title" not in preview.generated_fields
    # inferred-from-title fields ARE marked generated
    assert preview.product.fit_type == "slim"
    assert "fit_type" in preview.generated_fields
    assert "gender" in preview.generated_fields  # defaulted to unisex
    assert preview.product.gender == "unisex"


def test_url_import_never_fabricates_size_chart_or_price():
    def fake_fetch(url, requester):
        return _FakeExtracted(title="Tee", brand="Acme", category="tshirt", url=url, image="http://i/x.png")

    service = ProductImportService(providers=[UrlImportProvider(extractor=fake_fetch)])
    preview = service.import_preview(ProductImportRequest(url="https://acme.example/p"))
    assert preview.product.size_chart is None
    assert "size_chart" not in preview.generated_fields
    assert "price" not in preview.generated_fields


# --- Image import -------------------------------------------------------------


def test_image_import_stores_images_and_reads_colors(tmp_path):
    storage = LocalStorageProvider(directory=tmp_path)
    provider = ImageImportProvider(storage=storage)
    service = ProductImportService(providers=[provider])
    preview = service.import_preview(ProductImportRequest(images=[_data_url(_png_bytes((200, 30, 30)))]))
    assert len(preview.product.images) == 1 and preview.product.images[0].endswith(".png")
    assert "red" in preview.product.colors  # measured, real
    assert "colors" not in preview.generated_fields  # colors were extracted, not generated
    # descriptive fields are estimated & flagged
    assert "category" in preview.generated_fields or preview.product.category == ""
    assert "gender" in preview.generated_fields


def test_image_import_rejects_undecodable_data(tmp_path):
    provider = ImageImportProvider(storage=LocalStorageProvider(directory=tmp_path))
    service = ProductImportService(providers=[provider])
    with pytest.raises(HTTPException) as exc:
        service.import_preview(ProductImportRequest(images=["data:image/png;base64,@@notbase64@@"]))
    assert exc.value.status_code == 422


# --- Enricher unit ------------------------------------------------------------


def test_enricher_leaves_populated_fields_untouched():
    draft = ProductDraft(title="Tee", brand="Acme", category="tshirt", fit_type="oversized", gender="women")
    preview = ProductEnricher().enrich(draft)
    assert preview.product.fit_type == "oversized"
    assert "fit_type" not in preview.generated_fields
    assert "gender" not in preview.generated_fields


# --- Routes: preview + save ---------------------------------------------------


def test_import_route_returns_preview_without_saving(fake_client):
    service = ProductImportService(
        providers=[UrlImportProvider(extractor=lambda u, r: _FakeExtracted(title="Tee", brand="Acme", category="tshirt", url=u, image="http://i/x.png"))]
    )
    client = _active_seller_client(fake_client, service=service)
    resp = client.post("/seller/products/import", json={"url": "https://acme.example/p"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["product"]["brand"] == "Acme"
    assert isinstance(data["generated_fields"], list)
    # nothing persisted
    assert fake_client.collections.get("seller_products", {}) == {}


def test_create_route_persists_approved_product(fake_client):
    client = _active_seller_client(fake_client)
    body = {
        "title": "Crown Oversized Tee",
        "brand": "Crown",
        "category": "tshirt",
        "colors": ["black"],
        "gender": "unisex",
        "generated_fields": ["gender"],
    }
    resp = client.post("/seller/products", json=body)
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["id"] and data["seller_uid"] == "seller1"
    assert data["status"] == "active"
    assert data["generated_fields"] == ["gender"]
    assert len(fake_client.collections["seller_products"]) == 1


def test_create_route_requires_title(fake_client):
    client = _active_seller_client(fake_client)
    resp = client.post("/seller/products", json={"brand": "Crown", "category": "tshirt"})
    assert resp.status_code == 422


def test_import_requires_active_seller(fake_client):
    # pending seller cannot import
    fake_client.seed("sellers", "seller1", {"status": "pending"})
    from services.seller_repository import SellerRepository, get_seller_repository

    app = FastAPI()
    app.add_exception_handler(
        HTTPException,
        lambda request, exc: error_response(status_code=exc.status_code, detail=exc.detail),
    )
    app.include_router(seller_router)
    app.dependency_overrides[get_current_user] = lambda: SELLER
    app.dependency_overrides[get_seller_repository] = lambda: SellerRepository(client=fake_client)
    resp = TestClient(app).post("/seller/products/import", json={"url": "https://x.example/p"})
    assert resp.status_code == 403
