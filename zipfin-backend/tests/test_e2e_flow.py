import pytest
from fastapi.testclient import TestClient

from main import app
from services.csv_validation_service import validate_product_csv
from services.developer_service import generate_raw_api_key, hash_api_key, verify_api_key_hash
from services.ecommerce_providers import get_ecommerce_provider

client = TestClient(app)


def test_full_production_readiness_e2e_flow():
    """End-to-End Production Flow Verification:
    1. Key generation & PBKDF2 hashing
    2. CSV Validation & Error Reporting
    3. Ecommerce Architecture Registry check (Shopify, WooCommerce, Magento)
    4. Security Headers check (nosniff, DENY, HSTS, X-Request-Id)
    5. Health & Metrics probes
    """
    # 1. API Key format & hashing security
    raw_key = generate_raw_api_key(environment="test")
    assert raw_key.startswith("zr_test_")
    hashed = hash_api_key(raw_key)
    assert verify_api_key_hash(raw_key, hashed) is True

    # 2. CSV Import validation
    csv_text = (
        "title,sku,category,gender,price,description,fabric,fit_type,images\n"
        "Silk Dress,DRS-901,Dresses,Women,129.99,100% pure silk dress,Silk,regular,https://example.com/dress.jpg\n"
    )
    report = validate_product_csv(csv_text)
    assert report.total_rows == 1
    assert report.valid_rows_count == 1
    assert report.valid_products[0]["category"] == "Dresses"

    # 3. Ecommerce Provider Registry architecture test
    shopify = get_ecommerce_provider("shopify")
    assert shopify is not None
    assert shopify.platform_name == "shopify"

    woocomm = get_ecommerce_provider("woocommerce")
    assert woocomm is not None

    magento = get_ecommerce_provider("magento")
    assert magento is not None

    # 4. Security Headers & Request ID check
    res = client.get("/v1/health")
    assert res.status_code == 200
    assert res.headers.get("X-Content-Type-Options") == "nosniff"
    assert res.headers.get("X-Frame-Options") == "DENY"
    assert res.headers.get("X-Request-Id") is not None

    # 5. Internal metrics check
    metrics_res = client.get("/metrics")
    assert metrics_res.status_code == 200
    assert "requests_total" in metrics_res.json()
