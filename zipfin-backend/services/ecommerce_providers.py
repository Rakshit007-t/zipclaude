from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any
from pydantic import BaseModel, ConfigDict


class IntegrationCredentials(BaseModel):
    model_config = ConfigDict(extra="ignore")
    store_url: str
    api_key: str | None = None
    access_token: str | None = None
    secret_key: str | None = None


class BaseEcommerceProvider(ABC):
    """Abstract base class for all external ecommerce platform integrations."""

    def __init__(self, store_url: str = "", credentials: dict[str, Any] | None = None) -> None:
        self.store_url = store_url
        self.credentials = credentials or {}

    @property
    @abstractmethod
    def platform_name(self) -> str:
        pass

    def validate_credentials(self, credentials: IntegrationCredentials | dict | None = None) -> bool:
        return True

    def test_connection(self) -> bool:
        return True

    def fetch_products(
        self, credentials: IntegrationCredentials | dict | None = None, page: int = 1, limit: int = 50
    ) -> list[dict[str, Any]]:
        return []

    def normalize_product(self, raw_product: dict[str, Any]) -> dict[str, Any]:
        return raw_product

    def sync_inventory(self, credentials: IntegrationCredentials | dict | None = None) -> dict[str, int]:
        return {"synced_count": 0}


class ShopifyProvider(BaseEcommerceProvider):
    @property
    def platform_name(self) -> str:
        return "shopify"

    def test_connection(self) -> bool:
        import requests
        token = self.credentials.get("access_token") if isinstance(self.credentials, dict) else None
        store = self.store_url.rstrip("/")
        if not store.startswith("http"):
            store = f"https://{store}"
        url = f"{store}/admin/api/2023-10/shop.json"
        try:
            resp = requests.get(url, headers={"X-Shopify-Access-Token": token or ""})
            return resp.status_code == 200
        except Exception:
            return False

    def validate_credentials(self, credentials: Any = None) -> bool:
        creds = credentials or self.credentials
        store = getattr(credentials, "store_url", None) or self.store_url
        token = getattr(credentials, "access_token", None) or (creds.get("access_token") if isinstance(creds, dict) else None)
        return bool(store and token)

    def fetch_products(self, credentials: Any = None, page: int = 1, limit: int = 50) -> list[dict[str, Any]]:
        import requests
        creds = credentials or self.credentials
        token = creds.get("access_token") if isinstance(creds, dict) else None
        store = self.store_url.rstrip("/")
        if not store.startswith("http"):
            store = f"https://{store}"

        url = f"{store}/admin/api/2023-10/products.json"
        resp = requests.get(url, headers={"X-Shopify-Access-Token": token or ""})
        if not resp.ok:
            return []
        data = resp.json()
        return data.get("products", [])

    def normalize_product(self, p: dict[str, Any]) -> dict[str, Any]:
        images = [img["src"] for img in p.get("images", []) if isinstance(img, dict) and "src" in img]
        variants = p.get("variants", [])
        price = variants[0].get("price") if variants and isinstance(variants[0], dict) else None

        return {
            "title": p.get("title", ""),
            "description": p.get("body_html") or "",
            "brand": p.get("vendor") or "Shopify vendor",
            "category": p.get("product_type") or "clothing",
            "gender": "Unisex",
            "fabric": "Cotton",
            "colors": [],
            "images": images,
            "size_chart": {"M": 100},
            "fit_type": "regular",
            "sleeve_type": "",
            "neck_type": "",
            "pattern": "",
            "tags": [t.strip() for t in p.get("tags", "").split(",") if t.strip()],
            "price": f"₹{price}" if price else None,
            "status": "active",
        }


class WooCommerceProvider(BaseEcommerceProvider):
    @property
    def platform_name(self) -> str:
        return "woocommerce"

    def test_connection(self) -> bool:
        import requests
        creds = self.credentials if isinstance(self.credentials, dict) else {}
        ck = creds.get("consumer_key")
        cs = creds.get("consumer_secret")
        store = self.store_url.rstrip("/")
        if not store.startswith("http"):
            store = f"https://{store}"
        url = f"{store}/wp-json/wc/v3/system_status"
        try:
            resp = requests.get(url, auth=(ck or "", cs or ""))
            return resp.status_code == 200
        except Exception:
            return False

    def validate_credentials(self, credentials: Any = None) -> bool:
        creds = credentials or self.credentials
        store = getattr(credentials, "store_url", None) or self.store_url
        return bool(store)

    def fetch_products(self, credentials: Any = None, page: int = 1, limit: int = 50) -> list[dict[str, Any]]:
        import requests
        creds = self.credentials if isinstance(self.credentials, dict) else {}
        ck = creds.get("consumer_key")
        cs = creds.get("consumer_secret")
        store = self.store_url.rstrip("/")
        if not store.startswith("http"):
            store = f"https://{store}"

        url = f"{store}/wp-json/wc/v3/products"
        resp = requests.get(url, auth=(ck or "", cs or ""))
        if not resp.ok:
            return []
        return resp.json()

    def normalize_product(self, p: dict[str, Any]) -> dict[str, Any]:
        images = [img["src"] for img in p.get("images", []) if isinstance(img, dict) and "src" in img]
        cats = [c["name"] for c in p.get("categories", []) if isinstance(c, dict) and "name" in c]
        price = p.get("price")

        return {
            "title": p.get("name", ""),
            "description": p.get("description") or "",
            "brand": "WooCommerce Store",
            "category": cats[0] if cats else "apparel",
            "gender": "Unisex",
            "fabric": "Cotton",
            "colors": [],
            "images": images,
            "size_chart": {"L": 100},
            "fit_type": "regular",
            "sleeve_type": "",
            "neck_type": "",
            "pattern": "",
            "tags": [],
            "price": f"₹{price}" if price else None,
            "status": "active",
        }


class MagentoProvider(BaseEcommerceProvider):
    @property
    def platform_name(self) -> str:
        return "magento"


class GenericRestProvider(BaseEcommerceProvider):
    @property
    def platform_name(self) -> str:
        return "generic_rest"


# Provider Registry
_PROVIDERS: dict[str, BaseEcommerceProvider] = {
    "shopify": ShopifyProvider(),
    "woocommerce": WooCommerceProvider(),
    "magento": MagentoProvider(),
    "generic_rest": GenericRestProvider(),
}


def get_ecommerce_provider(platform: str) -> BaseEcommerceProvider | None:
    return _PROVIDERS.get(platform.lower().strip())
