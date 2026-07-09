# ZipRIGHT Storefront Integration — Developer Guide

> **M6 — E-commerce Integration Foundation**  
> Version 1.0.0 · ZipRIGHT API

---

## Overview

ZipRIGHT provides a **JavaScript Widget SDK** that any e-commerce merchant can embed into their storefront to give shoppers:

| Feature | Description |
|---|---|
| **Find My Size** | AI size recommendation modal — no login required |
| **Virtual Try-On** | Opens the full ZipRIGHT Try-On experience in a new tab |

The SDK communicates exclusively with the **Public Integration API** — a set of unauthenticated endpoints that sit in front of all existing ZipRIGHT services.

```
Merchant Storefront
      │
      ▼ (zipright-widget.js)
  ZipRIGHT Widget SDK
      │
      ▼ (HTTPS / REST)
  Public Integration API  (no auth required)
      │
      ├── Size Engine
      ├── Product Catalog
      └── Integration Config
```

---

## Quick Start (2 minutes)

### Step 1 — Connect your store

Log into the ZipRIGHT Seller Dashboard and create an integration for your store URL (e.g. `https://my-store.myshopify.com`). After saving, copy the **Product ID** from each product you want to enable.

### Step 2 — Add the SDK to your page

```html
<!-- Before </body> -->
<script src="https://sdk.zipright.ai/zipright-widget.js"></script>
```

### Step 3 — Mount a button for each product

```html
<!-- Container where the button will appear -->
<div id="zr-size-btn"></div>

<script>
ZipRightWidget.init({
  storeUrl:     "https://my-store.myshopify.com",  // your registered store URL
  apiBase:      "https://api.zipright.ai",           // ZipRIGHT backend
  productId:    "abc123firestore",                   // Firestore product document ID
  buttonTarget: "#zr-size-btn",
});
</script>
```

That's it. The SDK injects the **✨ Find My Size** button, handles the modal, calls the API, and shows the recommendation — zero backend work required on your side.

---

## Architecture

### Merchant Website → SDK → Public API → Existing Services

The merchant website knows nothing about which services run behind the Public API. This decoupling means:

- New AI models can replace existing ones without changing the SDK or the merchant's code.
- Product identifiers are stable Firestore document IDs — not fragile titles or SKUs.
- The SDK has zero third-party dependencies.

---

## Public API Reference

Base URL: `https://api.zipright.ai`

All responses follow the envelope:
```json
{ "isValid": true, "message": "...", "data": { ... } }
```

---

### `GET /public/widget-config`

SDK initialisation. Returns store metadata.

**Query params**

| Param | Required | Description |
|---|---|---|
| `store_url` | ✅ | Registered store URL |

**Response**
```json
{
  "isValid": true,
  "data": {
    "seller_uid": "uid_abc",
    "store_name": "ThreadCo Studio",
    "store_url": "https://threadco.example.com",
    "zipright_app_url": "https://zipright.ai"
  }
}
```

---

### `GET /public/integration/products`

List all active products for a store. Use this to build a client-side product ID map.

**Query params**

| Param | Required | Description |
|---|---|---|
| `store_url` | ✅ | Registered store URL |
| `limit` | ❌ | Max results (default 50) |

**Response**
```json
{
  "isValid": true,
  "data": [
    {
      "id": "abc123",
      "title": "Relaxed Everyday Tee",
      "brand": "ThreadCo Studio",
      "category": "T-Shirt",
      "price": "₹1,299",
      "images": ["https://..."],
      "available_sizes": ["XS", "S", "M", "L", "XL"]
    }
  ]
}
```

---

### `GET /public/integration/product`

Resolve a single product. Prefer `product_id` (stable) over `product_title`.

**Query params**

| Param | Required | Description |
|---|---|---|
| `store_url` | ✅ | Registered store URL |
| `product_id` | preferred | Firestore document ID |
| `product_title` | fallback | Title match (exact → substring) |

> **Important**: When `product_id` is supplied and not found, the API returns **HTTP 404** immediately and does _not_ fall back to title search. This prevents accidental cross-product matches.

---

### `POST /public/integration/recommendation`

Compute a size recommendation for a shopper.

**Request body**
```json
{
  "store_url":      "https://my-store.example.com",
  "product_id":     "abc123",
  "height":         175,
  "weight":         72,
  "base_size":      "M",
  "fit_preference": "regular",
  "chest":          96,
  "waist":          82
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `store_url` | string | ✅ | Must be registered in ZipRIGHT |
| `product_id` | string | preferred | Firestore document ID |
| `product_title` | string | fallback | If `product_id` unavailable |
| `height` | float | ✅ | cm, 1–300 |
| `weight` | float | ✅ | kg, 1–500 |
| `base_size` | enum | ❌ | XS/S/M/L/XL/XXL (default M) |
| `fit_preference` | enum | ❌ | slim/regular/relaxed/loose/baggy (default regular) |
| `chest` | float | ❌ | cm |
| `waist` | float | ❌ | cm |
| `shoulders` | float | ❌ | cm |
| `hips` | float | ❌ | cm |
| `legs` | float | ❌ | cm |
| `bust` | float | ❌ | cm |

**Response**
```json
{
  "isValid": true,
  "data": {
    "size": "L",
    "confidence": 87,
    "risk": "low",
    "reason": "Your chest measurement (96cm) places you firmly in size L based on ThreadCo's size chart."
  }
}
```

---

## SDK Reference

### `ZipRightWidget.init(config)`

| Option | Type | Required | Description |
|---|---|---|---|
| `storeUrl` | string | ✅ | Your registered store URL |
| `apiBase` | string | ✅ | ZipRIGHT API base URL |
| `productId` | string | preferred | Stable Firestore document ID |
| `productTitle` | string | fallback | Product title |
| `buttonTarget` | string \| HTMLElement | ❌ | CSS selector or element to mount the button |
| `ziprightAppUrl` | string | ❌ | Override ZipRIGHT app URL (default: zipright.ai) |

Returns a `ZipRightWidgetInstance`.

---

### `instance.renderButton(container)`

Manually append the Find My Size button to a DOM element.

```js
var inst = ZipRightWidget.init({ storeUrl, apiBase, productId });
inst.renderButton(document.getElementById('my-container'));
```

---

### `instance.preload()`

Pre-fetches product data in the background so the modal opens faster.

```js
var inst = ZipRightWidget.init({ ... });
inst.preload();   // called automatically when buttonTarget is set
```

---

### `instance._open()` / `instance._close()`

Programmatically open or close the modal.

```js
// Custom trigger (e.g. triggered from your own UI button)
var inst = ZipRightWidget.init({ storeUrl, apiBase, productId });
document.getElementById('my-btn').addEventListener('click', function() {
  inst._open();
});
```

---

## Auto-Init via Data Attributes

For simple integrations, configure the SDK entirely through HTML data attributes on the `<script>` tag:

```html
<script
  src="https://sdk.zipright.ai/zipright-widget.js"
  data-store-url="https://my-store.myshopify.com"
  data-api-base="https://api.zipright.ai"
  data-product-id="abc123firestore"
  data-button-target="#zr-size-btn"
></script>
```

Supported attributes:

| Attribute | Description |
|---|---|
| `data-store-url` | Registered store URL |
| `data-api-base` | API base URL |
| `data-product-id` | Firestore product ID |
| `data-product-title` | Product title (fallback) |
| `data-button-target` | CSS selector for button mount |
| `data-app-url` | Override ZipRIGHT app URL |

---

## Virtual Try-On Integration

When the shopper clicks **Try On in ZipRIGHT**, the SDK opens the ZipRIGHT application in a new tab with query parameters pre-filled:

```
https://zipright.ai/recommendation?
  source=widget
  &store_url=<encoded>
  &product_id=<encoded>
  &recommended_size=<size>
```

The ZipRIGHT app reads these parameters and pre-fills the recommendation context so the shopper can proceed directly to Virtual Try-On without re-entering information.

> **Design Decision**: The Virtual Try-On is deliberately _not_ embedded inside the widget modal. Embedding the full CatVTON pipeline inside an iframe adds significant complexity and increases page weight for merchants. Launching the ZipRIGHT app in a new tab keeps the merchant page lightweight while offering the full experience.

---

## Firestore Collections

| Collection | Purpose |
|---|---|
| `seller_integrations` | Store URL → seller UID mapping |
| `seller_products` | Product catalog per seller |
| `sellers` | Seller profile & branding |

---

## Security Notes

- All Public API endpoints are **unauthenticated** by design — they serve shopper browsers directly.
- Product data returned is read-only and filtered to active (non-archived) products.
- Store URL matching uses exact-first → fallback-strip → substring scan to handle protocol variations (`http://` vs `https://`) without exposing internal data.
- No customer measurements are stored. The recommendation is computed on-the-fly and returned in the API response only.

---

## Adding Future Platforms

The provider interface in `routes/seller_integrations.py` is designed for new platform adapters:

```python
class IntegrationProvider(Protocol):
    def sync_products(self, config: dict) -> list[NormalizedProduct]: ...
    def get_product(self, external_id: str, config: dict) -> NormalizedProduct: ...
```

To add a new platform (e.g. Magento):
1. Create `services/integrations/magento_provider.py` implementing `IntegrationProvider`.
2. Register it in `PROVIDER_MAP` in `services/integrations/__init__.py`.
3. No changes to the public API or SDK are needed.

---

## Changelog

| Version | Date | Notes |
|---|---|---|
| 1.0.0 | 2026-07-07 | Initial release — Public API, Widget SDK, Example Integration |
