from __future__ import annotations

import re
from abc import ABC, abstractmethod
import requests
from bs4 import BeautifulSoup


class BaseEcommerceProvider(ABC):
    @abstractmethod
    def test_connection(self) -> bool:
        """Verify endpoint connectivity and token authentication validity."""
        pass

    @abstractmethod
    def fetch_products(self) -> list[dict]:
        """Fetch raw products listing from the integration."""
        pass

    @abstractmethod
    def normalize_product(self, raw_data: dict) -> dict:
        """Translate raw provider format to ZipRIGHT standard draft product."""
        pass


class ShopifyProvider(BaseEcommerceProvider):
    def __init__(self, store_url: str, credentials: dict[str, str]) -> None:
        self.store_url = store_url.rstrip("/")
        self.access_token = credentials.get("access_token", "")

    def _get_headers(self) -> dict[str, str]:
        return {
            "X-Shopify-Access-Token": self.access_token,
            "Content-Type": "application/json",
        }

    def test_connection(self) -> bool:
        url = f"{self.store_url}/admin/api/2023-07/shop.json"
        try:
            resp = requests.get(url, headers=self._get_headers(), timeout=10)
            return resp.status_code == 200
        except Exception:
            return False

    def fetch_products(self) -> list[dict]:
        url = f"{self.store_url}/admin/api/2023-07/products.json"
        resp = requests.get(url, headers=self._get_headers(), timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(f"Shopify fetch failed with code {resp.status_code}")
        return resp.json().get("products", [])

    def normalize_product(self, raw_data: dict) -> dict:
        # Strip HTML description
        desc_html = raw_data.get("body_html", "")
        desc_text = BeautifulSoup(desc_html, "html.parser").get_text() if desc_html else ""

        # Price resolver
        price = "0"
        variants = raw_data.get("variants", [])
        if variants:
            price = f"₹{variants[0].get('price', '0')}"

        # Images resolver
        images = [img.get("src") for img in raw_data.get("images", []) if img.get("src")]

        # Sizing mapping from variants
        size_chart = {}
        for var in variants:
            sz = var.get("title", "").strip().upper()
            if sz:
                # Default mock measurements for M5 sync mapping tests
                size_chart[sz] = 100

        # Tags resolver
        raw_tags = raw_data.get("tags", "")
        tags = [t.strip() for t in raw_tags.split(",") if t.strip()] if isinstance(raw_tags, str) else []

        return {
            "title": raw_data.get("title", "Shopify Product"),
            "description": desc_text.strip(),
            "brand": raw_data.get("vendor") or "Shopify Brand",
            "category": raw_data.get("product_type") or "Clothing",
            "gender": "unisex",
            "price": price,
            "images": images,
            "size_chart": size_chart if size_chart else None,
            "tags": tags,
        }


class WooCommerceProvider(BaseEcommerceProvider):
    def __init__(self, store_url: str, credentials: dict[str, str]) -> None:
        self.store_url = store_url.rstrip("/")
        self.consumer_key = credentials.get("consumer_key", "")
        self.consumer_secret = credentials.get("consumer_secret", "")

    def _get_auth(self) -> tuple[str, str]:
        return (self.consumer_key, self.consumer_secret)

    def test_connection(self) -> bool:
        url = f"{self.store_url}/wp-json/wc/v3/system_status"
        try:
            resp = requests.get(url, auth=self._get_auth(), timeout=10)
            return resp.status_code == 200
        except Exception:
            return False

    def fetch_products(self) -> list[dict]:
        url = f"{self.store_url}/wp-json/wc/v3/products"
        resp = requests.get(url, auth=self._get_auth(), timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(f"WooCommerce fetch failed with code {resp.status_code}")
        return resp.json()

    def normalize_product(self, raw_data: dict) -> dict:
        desc_html = raw_data.get("description", "")
        desc_text = BeautifulSoup(desc_html, "html.parser").get_text() if desc_html else ""

        # Price resolver
        price = f"₹{raw_data.get('price', '0')}"

        # Images resolver
        images = [img.get("src") for img in raw_data.get("images", []) if img.get("src")]

        # Sizes resolver from WooCommerce Attributes
        size_chart = {}
        for attr in raw_data.get("attributes", []):
            if attr.get("name", "").strip().lower() == "size":
                for sz in attr.get("options", []):
                    sz_clean = sz.strip().upper()
                    if sz_clean:
                        size_chart[sz_clean] = 100

        # Categories
        categories = raw_data.get("categories", [])
        category = categories[0].get("name") if categories else "Clothing"

        return {
            "title": raw_data.get("name", "WooCommerce Product"),
            "description": desc_text.strip(),
            "brand": "WooCommerce Store",
            "category": category,
            "gender": "unisex",
            "price": price,
            "images": images,
            "size_chart": size_chart if size_chart else None,
            "tags": [],
        }


class GenericRestProvider(BaseEcommerceProvider):
    def __init__(self, store_url: str, credentials: dict[str, str]) -> None:
        self.endpoint_url = store_url.rstrip("/")
        self.api_key = credentials.get("api_key", "")

    def _get_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def test_connection(self) -> bool:
        try:
            resp = requests.get(self.endpoint_url, headers=self._get_headers(), timeout=10)
            # Ensure it is a valid list response or OK status
            return resp.status_code in (200, 201)
        except Exception:
            return False

    def fetch_products(self) -> list[dict]:
        resp = requests.get(self.endpoint_url, headers=self._get_headers(), timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(f"REST endpoint failed with code {resp.status_code}")
        data = resp.json()
        return data if isinstance(data, list) else data.get("products", [])

    def normalize_product(self, raw_data: dict) -> dict:
        # Standard schema mapping for generic products
        images = raw_data.get("images", [])
        if isinstance(images, str):
            images = [images]

        size_chart = {}
        for sz in raw_data.get("sizes", []):
            sz_clean = str(sz).strip().upper()
            if sz_clean:
                size_chart[sz_clean] = 100

        return {
            "title": raw_data.get("title") or raw_data.get("name") or "REST Product",
            "description": raw_data.get("description", "").strip(),
            "brand": raw_data.get("brand") or "Generic Brand",
            "category": raw_data.get("category") or "Clothing",
            "gender": raw_data.get("gender") or "unisex",
            "price": f"₹{raw_data.get('price', '0')}",
            "images": images,
            "size_chart": size_chart if size_chart else None,
            "tags": raw_data.get("tags", []),
        }
